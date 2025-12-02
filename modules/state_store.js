export const tabStates = {};

export function resetTabState(tabId) {
    if (tabStates[tabId]) {
        tabStates[tabId].analysisId++; // Invalidate previous loop
        if (tabStates[tabId].abortController) {
            tabStates[tabId].abortController.abort();
        }
    }
    tabStates[tabId] = {
        intent: "",
        summary: "",
        searchHistory: [],
        isAnalyzing: false,
        analysisId: (tabStates[tabId]?.analysisId || 0) + 1,
        intentVisible: false,
        error: null,
        loading: false,
        statusMessage: "待機中...",
        abortController: new AbortController(),
        nextQuery: null,
        searchCount: 0
    };
}

export function getTabState(tabId) {
    return tabStates[tabId];
}

export function deleteTabState(tabId) {
    if (tabStates[tabId]) {
        tabStates[tabId].analysisId++;
        delete tabStates[tabId];
    }
}

export function interruptAnalysis(tabId) {
    if (tabStates[tabId]) {
        if (tabStates[tabId].abortController) {
            tabStates[tabId].abortController.abort();
        }
        tabStates[tabId].isAnalyzing = false;
        tabStates[tabId].loading = false;
        tabStates[tabId].statusMessage = "一時停止中";
    }
}
