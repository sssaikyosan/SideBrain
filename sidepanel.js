import { getConfig, validateConfig } from './modules/config.js';
import { getPageContent, performBrowserSearch } from './modules/browser_service.js';
import { inferIntentAndQueries, decideNextStep, updateSummary } from './modules/analysis_logic.js';
import { tabStates, resetTabState, deleteTabState, getTabState, interruptAnalysis } from './modules/state_store.js';
import { initUI, updateUI } from './modules/ui_controller.js';

document.addEventListener('DOMContentLoaded', () => {
    const uiElements = initUI();
    let currentTabId = null;

    uiElements.toggleIntentBtn.addEventListener('click', () => {
        if (!currentTabId) return;
        const state = getTabState(currentTabId);
        if (!state) return;

        state.intentVisible = !state.intentVisible;
        updateUI(currentTabId, currentTabId);
    });

    uiElements.toggleRefsBtn.addEventListener('click', () => {
        if (!currentTabId) return;
        const state = getTabState(currentTabId);
        if (!state) return;

        state.refsVisible = !state.refsVisible;
        updateUI(currentTabId, currentTabId);
    });

    // Initialize
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            currentTabId = tabs[0].id;
            handleTabChange(currentTabId);
        }
    });

    // Listen for tab updates
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        // URL changed (covers both standard navigation and SPA)
        if (changeInfo.url) {
            // Reset state for this tab on navigation
            resetTabState(tabId);
            if (tabId === currentTabId) updateUI(tabId, currentTabId);
        }

        // Start analysis if loading is complete OR if URL changed while already complete (SPA)
        if (changeInfo.status === 'complete' || (changeInfo.url && tab.status === 'complete')) {
            // Start analysis if not already running or if reset
            const state = getTabState(tabId);
            // Only start if it's the current tab
            if (tabId === currentTabId && (!state || !state.isAnalyzing)) {
                startAnalysisLoop(tabId, tab.url);
            }
        }
    });

    // Listen for tab activation
    chrome.tabs.onActivated.addListener((activeInfo) => {
        currentTabId = activeInfo.tabId;

        // Interrupt all other tabs
        for (const tid in tabStates) {
            if (parseInt(tid) !== currentTabId) {
                interruptAnalysis(tid);
            }
        }

        updateUI(currentTabId, currentTabId);

        // If no state exists for this tab (e.g. first visit since panel open), start analysis
        // We need to check if the tab is loaded.
        chrome.tabs.get(currentTabId, (tab) => {
            if (tab.status === 'complete') {
                const state = getTabState(currentTabId);
                // Start if no state, OR if not analyzing (this covers resuming)
                if (!state || !state.isAnalyzing) {
                    startAnalysisLoop(currentTabId, tab.url);
                }
            }
        });
    });

    // Listen for tab removal to clean up memory
    chrome.tabs.onRemoved.addListener((tabId) => {
        deleteTabState(tabId);
    });

    function handleTabChange(tabId) {
        if (!getTabState(tabId)) {
            chrome.tabs.get(tabId, (tab) => {
                if (tab && tab.url) {
                    resetTabState(tabId);
                    startAnalysisLoop(tabId, tab.url);
                }
            });
        } else {
            updateUI(tabId, currentTabId);
        }
    }

    async function verifyContentChange(tabId, expectedUrl, originalContent, analysisId) {
        // Wait 2 seconds to allow for dynamic content loading
        await new Promise(r => setTimeout(r, 2000));

        const state = getTabState(tabId);
        // If analysisId changed (e.g. user navigated again or another reset happened), abort.
        if (!state || state.analysisId !== analysisId) return;

        try {
            const newPageData = await getPageContent(tabId, expectedUrl);

            // Check if content changed
            if (newPageData.content !== originalContent) {
                console.log(`[Content Change Detected] Resetting analysis for tab ${tabId}`);

                // Reset state
                resetTabState(tabId);

                // Update UI to show restarting status
                const newState = getTabState(tabId);
                newState.statusMessage = "ページ内容の変化を検知。再分析します...";
                updateUI(tabId, currentTabId);

                // Restart analysis
                startAnalysisLoop(tabId, expectedUrl, true);
            }
        } catch (e) {
            console.warn("Content verification failed:", e);
        }
    }

    async function startAnalysisLoop(tabId, expectedUrl, isRetry = false) {
        // Initialize state if needed
        if (!getTabState(tabId)) resetTabState(tabId);

        const state = getTabState(tabId);

        // Renew AbortController if it was aborted (e.g. by interruption)
        if (state.abortController.signal.aborted) {
            state.abortController = new AbortController();
        }

        const myAnalysisId = state.analysisId;
        const signal = state.abortController.signal;

        state.isAnalyzing = true;
        state.loading = true;
        state.error = null;

        // Check status to determine initial message
        if (state.intent) {
            state.statusMessage = "分析を継続します...";
        } else {
            state.statusMessage = isRetry ? "ページ内容の変化を検知。再分析します..." : "ページを分析中...";
        }
        updateUI(tabId, currentTabId);

        let config;

        try {
            // 1. Initial Setup
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            config = await getConfig();
            validateConfig(config);

            // If we don't have an intent yet, we need to fetch page content and infer it.
            if (!state.intent) {
                state.statusMessage = "ページ内容を取得中...";
                updateUI(tabId, currentTabId);
                const pageData = await getPageContent(tabId, expectedUrl);

                // Start background verification for content changes ONLY if not a retry
                if (!isRetry) {
                    verifyContentChange(tabId, expectedUrl, pageData.content, myAnalysisId);
                }

                // 2. Initial Intent Inference
                state.statusMessage = "ユーザーの意図を推論中...";
                updateUI(tabId, currentTabId);
                const intentData = await inferIntentAndQueries(pageData, config, signal);

                if (state.analysisId !== myAnalysisId) return; // Stop if reset happened

                state.intent = intentData.intent;
                // Save initial query to state so we can resume if interrupted here
                if (intentData.query) {
                    state.nextQuery = intentData.query;
                }
                updateUI(tabId, currentTabId);
            }

            // 3. Continuous Loop
            // If resuming, we need to decide next step again or continue from where we left off.
            let nextStep = null;

            // If we have a pending query in state (from initial inference or previous loop), use it
            if (state.nextQuery) {
                nextStep = { shouldSearch: true, query: state.nextQuery };
                state.nextQuery = null; // Clear it after picking it up
            }

            while (state.analysisId === myAnalysisId) {
                if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

                // Determine next query if not already determined
                if (!nextStep) {
                    // Check search count limit (Initial + 2 updates = 3 searches max)
                    if (state.searchCount >= 3) {
                        state.loading = false;
                        state.statusMessage = "分析完了";
                        updateUI(tabId, currentTabId);
                        break; // Exit loop
                    }

                    // If resuming and we have no history/summary, we MUST search.
                    // decideNextStep might return false if it thinks we have nothing.
                    // Let's force it to search if history is empty.
                    if (state.searchHistory.length === 0 && !state.summary) {
                        nextStep = { shouldSearch: true, query: state.intent };
                    } else {
                        state.statusMessage = "次の調査ステップを検討中...";
                        updateUI(tabId, currentTabId);
                        nextStep = await decideNextStep(state.intent, state.summary, state.searchHistory, config, true, signal);
                    }
                }

                if (state.analysisId !== myAnalysisId) return;

                if (nextStep.shouldSearch && nextStep.query) {
                    state.loading = true;
                    state.statusMessage = `検索中: ${nextStep.query}`;
                    updateUI(tabId, currentTabId);

                    // Perform Search
                    const searchResultData = await performBrowserSearch([nextStep.query], config, (msg) => {
                        state.statusMessage = msg;
                        updateUI(tabId, currentTabId);
                    });
                    const searchResultsText = searchResultData.text;
                    state.searchHistory.push(nextStep.query);
                    state.searchCount++; // Increment search count

                    if (state.analysisId !== myAnalysisId) return;

                    // Update Summary
                    state.statusMessage = "情報を要約中...";
                    updateUI(tabId, currentTabId);

                    // Use streaming only for the first summary generation
                    const onSummaryUpdate = !state.summary ? (partialSummary) => {
                        state.summary = partialSummary;
                        updateUI(tabId, currentTabId, { flash: false });
                    } : undefined;

                    let newSummary = await updateSummary(state.summary, searchResultsText, state.intent, config, signal, onSummaryUpdate);

                    // Update References
                    if (!state.references) state.references = [];
                    if (searchResultData.items && searchResultData.items.length > 0) {
                        searchResultData.items.forEach(item => {
                            if (!state.references.some(ref => ref.url === item.url)) {
                                state.references.push(item);
                            }
                        });
                    }

                    state.summary = newSummary;

                    state.loading = false; // 一旦完了
                    updateUI(tabId, currentTabId);

                } else {
                    // No search needed, analysis complete
                    state.loading = false;
                    state.statusMessage = "分析完了";
                    updateUI(tabId, currentTabId);
                    break; // Exit loop
                }

                // Reset nextStep for the next iteration
                nextStep = null;

                // Wait before next iteration (e.g. 1s)
                // Removed long wait as requested
                for (let i = 0; i < 1; i++) {
                    if (state.analysisId !== myAnalysisId || signal.aborted) return;
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('Analysis aborted for tab', tabId);
                return;
            }
            if (state.analysisId === myAnalysisId) {
                // Show friendly message for known errors
                if (err.message === 'このページは分析できません。' ||
                    err.message === 'タブが見つかりません。' ||
                    err.message.includes('分析できません') ||
                    err.message.includes('Cannot access contents') ||
                    err.message.includes('Extension context invalidated') ||
                    err.message.includes('Missing host permission') ||
                    err.message.includes('The extensions gallery cannot be scripted')
                ) {
                    // Don't log error for unsupported pages, just stop loading
                    state.loading = false;
                    state.statusMessage = "分析対象外のページです";
                } else {
                    console.error(err);
                    state.error = err.message;
                }
                state.loading = false;
                updateUI(tabId, currentTabId);
            }
        } finally {
            if (state.analysisId === myAnalysisId) {
                state.isAnalyzing = false;
            }
        }
    }
});
