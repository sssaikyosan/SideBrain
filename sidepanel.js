import { getConfig, validateConfig } from './modules/config.js';
import { getPageContent, performBrowserSearch } from './modules/browser_service.js';
import { inferIntentAndQueries, decideNextStep, updateSummary } from './modules/analysis_logic.js';
import { tabStates, resetTabState, deleteTabState, getTabState } from './modules/state_store.js';
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
            if (!state || !state.isAnalyzing) {
                startAnalysisLoop(tabId, tab.url);
            }
        }
    });

    // Listen for tab activation
    chrome.tabs.onActivated.addListener((activeInfo) => {
        currentTabId = activeInfo.tabId;
        updateUI(currentTabId, currentTabId);

        // If no state exists for this tab (e.g. first visit since panel open), start analysis
        // We need to check if the tab is loaded.
        chrome.tabs.get(currentTabId, (tab) => {
            if (tab.status === 'complete') {
                if (!getTabState(currentTabId)) {
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
        const myAnalysisId = state.analysisId;

        state.isAnalyzing = true;
        state.loading = true;
        state.error = null;
        updateUI(tabId, currentTabId);

        let config;

        try {
            // 1. Initial Setup
            config = await getConfig();
            validateConfig(config);
            const pageData = await getPageContent(tabId, expectedUrl);

            // 2. Initial Intent Inference
            const intentData = await inferIntentAndQueries(pageData, config);

            if (state.analysisId !== myAnalysisId) return; // Stop if reset happened

            state.intent = intentData.intent;
            updateUI(tabId, currentTabId);

            let nextStep = null;
            if (intentData.query) {
                nextStep = { shouldSearch: true, query: intentData.query };
            }

            // 3. Continuous Loop
            while (state.analysisId === myAnalysisId) {
                // Determine next query if not already determined
                if (!nextStep) {
                    nextStep = await decideNextStep(state.intent, state.summary, state.searchHistory, config, true);
                }

                if (state.analysisId !== myAnalysisId) return;

                if (nextStep.shouldSearch && nextStep.query) {
                    state.loading = true;
                    updateUI(tabId, currentTabId);

                    // Perform Search
                    const searchResults = await performBrowserSearch([nextStep.query]);
                    state.searchHistory.push(nextStep.query);

                    if (state.analysisId !== myAnalysisId) return;

                    // Update Summary
                    state.summary = await updateSummary(state.summary, searchResults, state.intent, config);
                    state.loading = false;
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
                    if (state.analysisId !== myAnalysisId) return;
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

        } catch (err) {
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
