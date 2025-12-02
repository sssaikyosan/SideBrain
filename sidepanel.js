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

    // Initialize
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            currentTabId = tabs[0].id;
            handleTabChange(currentTabId);
        }
    });

    // Listen for tab updates
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'loading' && changeInfo.url) {
            // Reset state for this tab on navigation
            resetTabState(tabId);
            if (tabId === currentTabId) updateUI(tabId, currentTabId);
        }

        if (changeInfo.status === 'complete') {
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

    async function startAnalysisLoop(tabId, expectedUrl) {
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
            state.statusMessage = "ページを分析中...";
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
                    const searchResultData = await performBrowserSearch([nextStep.query]);
                    const searchResultsText = searchResultData.text;
                    state.searchHistory.push(nextStep.query);

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

                    // Append Reference Links
                    // Extract existing references from current summary if any
                    let existingRefs = "";
                    let contentWithoutRefs = newSummary;
                    const refSplit = newSummary.split("\n### 参照リンク\n");
                    if (refSplit.length > 1) {
                        contentWithoutRefs = refSplit[0];
                        existingRefs = refSplit[1];
                    }

                    // Also check state.summary for previous refs if LLM removed them (it shouldn't but just in case)
                    // Actually, updateSummary prompt asks to update summary, so it might rewrite everything.
                    // We should maintain a separate list of references in state or extract them from previous state.summary
                    // Simpler approach: Extract from previous state.summary before update

                    // Let's use a more robust approach:
                    // We will append new links to the end.
                    // If the LLM preserved the old links, great. If not, we might lose them if we don't handle it carefully.
                    // Since we instructed LLM NOT to output links, newSummary shouldn't have them.
                    // But we want to keep "old" links that were in state.summary?
                    // The user wants to "add to" the list, not delete old ones.

                    // 1. Get existing links from state.summary (before update)
                    const oldSummary = state.summary || "";
                    const oldRefSplit = oldSummary.split("\n### 参照リンク\n");
                    let allLinks = [];
                    if (oldRefSplit.length > 1) {
                        // Parse existing links
                        const lines = oldRefSplit[1].split('\n');
                        lines.forEach(line => {
                            const match = line.match(/- \[(.*?)\]\((.*?)\)/);
                            if (match) {
                                allLinks.push({ title: match[1], url: match[2] });
                            }
                        });
                    }

                    // 2. Add new links
                    if (searchResultData.items && searchResultData.items.length > 0) {
                        searchResultData.items.forEach(item => {
                            // Avoid duplicates
                            if (!allLinks.some(link => link.url === item.url)) {
                                allLinks.push({ title: item.title, url: item.url });
                            }
                        });
                    }

                    // 3. Reconstruct summary
                    // newSummary is the fresh content from LLM (without links)
                    // We assume LLM strictly followed instruction and didn't output links.
                    // If LLM did output links despite instruction, we might have duplication if we are not careful,
                    // but we removed the instruction so it should be fine.

                    let finalSummary = newSummary;
                    if (allLinks.length > 0) {
                        finalSummary += "\n\n### 参照リンク\n";
                        allLinks.forEach(link => {
                            finalSummary += `- [${link.title}](${link.url})\n`;
                        });
                    }

                    state.summary = finalSummary;

                    state.loading = false; // 一旦完了
                    updateUI(tabId, currentTabId);

                } else {
                    // No search needed immediately, but we continue loop
                    if (!state.summary) {
                        state.summary = "追加の情報を収集中です...";
                        updateUI(tabId, currentTabId);
                    }
                    state.loading = false;
                    updateUI(tabId, currentTabId);
                }

                // Reset nextStep for the next iteration
                nextStep = null;

                // Wait before next iteration (e.g. 15s)
                for (let i = 0; i < 15; i++) {
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
                console.error(err);
                state.error = err.message;
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
