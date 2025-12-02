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

    const apiKeyContainer = document.getElementById('apiKeyContainer');
    const showApiKeyCheckbox = document.getElementById('showApiKey');

    if (items.openaiApiKey) {
      document.getElementById('openaiApiKey').value = items.openaiApiKey;
      showApiKeyCheckbox.checked = true;
      apiKeyContainer.style.display = 'block';
    } else {
      showApiKeyCheckbox.checked = false;
      apiKeyContainer.style.display = 'none';
    }

    if (!items.openaiModel) {
      document.getElementById('openaiModel').value = "local-model";
    } else {
      document.getElementById('openaiModel').value = items.openaiModel;
    }
  });

  // Toggle API Key visibility
  document.getElementById('showApiKey').addEventListener('change', (e) => {
    const apiKeyContainer = document.getElementById('apiKeyContainer');
    if (e.target.checked) {
      apiKeyContainer.style.display = 'block';
    } else {
      apiKeyContainer.style.display = 'none';
      // Optional: Clear API key when unchecked? No, user might just want to hide it.
      // But if they uncheck, maybe they mean "don't use it".
      // For now, just hide.
    }
  });

  // Save values
  document.getElementById('saveBtn').addEventListener('click', () => {
    const openaiBaseUrl = document.getElementById('openaiBaseUrl').value;
    let openaiApiKey = document.getElementById('openaiApiKey').value;
    const openaiModel = document.getElementById('openaiModel').value;
    const showApiKey = document.getElementById('showApiKey').checked;

    if (!showApiKey) {
      openaiApiKey = '';
    }

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
