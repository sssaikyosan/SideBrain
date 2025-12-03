export async function getConfig() {
    return new Promise((resolve) => {
        chrome.storage.local.get([
            'openaiBaseUrl',
            'openaiApiKey',
            'openaiModel',
            'debugMode'
        ], (items) => {
            if (!items.openaiBaseUrl) items.openaiBaseUrl = 'http://localhost:1234/v1';
            if (!items.openaiModel) items.openaiModel = 'local-model';
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
