document.addEventListener('DOMContentLoaded', () => {
  // Load saved values
  chrome.storage.local.get([
    'openaiBaseUrl',
    'openaiApiKey',
    'openaiModel'
  ], (items) => {
    // Default values for LM Studio
    if (!items.openaiBaseUrl) {
      document.getElementById('openaiBaseUrl').value = "http://localhost:1234/v1";
    } else {
      document.getElementById('openaiBaseUrl').value = items.openaiBaseUrl;
    }

    if (items.openaiApiKey) document.getElementById('openaiApiKey').value = items.openaiApiKey;

    if (!items.openaiModel) {
      document.getElementById('openaiModel').value = "local-model";
    } else {
      document.getElementById('openaiModel').value = items.openaiModel;
    }
  });

  // Save values
  document.getElementById('saveBtn').addEventListener('click', () => {
    const openaiBaseUrl = document.getElementById('openaiBaseUrl').value;
    const openaiApiKey = document.getElementById('openaiApiKey').value;
    const openaiModel = document.getElementById('openaiModel').value;

    chrome.storage.local.set({
      llmProvider: 'openai', // Force provider to openai compatible
      openaiBaseUrl,
      openaiApiKey,
      openaiModel
    }, () => {
      const status = document.getElementById('status');
      status.textContent = '設定を保存しました。';
      setTimeout(() => {
        status.textContent = '';
      }, 2000);
    });
  });
});
