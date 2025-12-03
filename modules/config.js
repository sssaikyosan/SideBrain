export async function getConfig() {
    return new Promise((resolve) => {
        chrome.storage.local.get([
            'openaiBaseUrl',
            'openaiApiKey',
            'openaiModel',
            'maxContextSize',
            'maxSearchResultSize',
            'maxSearchPages',
            'minSearchInterval',
            'maxSearchesPerWindow',
            'timeWindow',
            'burstCooldown',
            'debugMode'
        ], (items) => {
            if (!items.openaiBaseUrl) items.openaiBaseUrl = 'http://localhost:1234/v1';
            if (!items.openaiModel) items.openaiModel = 'local-model';
            if (!items.maxContextSize) items.maxContextSize = 15000;
            if (!items.maxSearchResultSize) items.maxSearchResultSize = 5000;
            if (!items.maxSearchPages) items.maxSearchPages = 3;

            // Rate Limiting Defaults
            if (!items.minSearchInterval) items.minSearchInterval = 3000;
            if (!items.maxSearchesPerWindow) items.maxSearchesPerWindow = 15;
            if (!items.timeWindow) items.timeWindow = 180000;
            if (!items.burstCooldown) items.burstCooldown = 120000;
            if (items.debugMode === undefined) items.debugMode = true; // Default to true for now
            items.llmProvider = 'openai';
            resolve(items);
        });
    });
}

export function validateConfig(config) {
    if (!config.openaiBaseUrl) {
        throw new Error('Base URLが設定されていません。');
    }
}
