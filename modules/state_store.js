export const tabStates = {};

export function resetTabState(tabId) {
    if (tabStates[tabId]) {
        tabStates[tabId].analysisId++; // Invalidate previous loop
    }
    tabStates[tabId] = {
        intent: "",
        summary: "",
        searchHistory: [],
        isAnalyzing: false,
        analysisId: (tabStates[tabId]?.analysisId || 0) + 1,
        intentVisible: false,
        error: null,
        loading: false
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
