document.addEventListener('DOMContentLoaded', () => {
  // Load saved values
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
    'burstCooldown'
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

    if (!items.maxContextSize) {
      document.getElementById('maxContextSize').value = 15000;
    } else {
      document.getElementById('maxContextSize').value = items.maxContextSize;
    }

    if (!items.maxSearchResultSize) {
      document.getElementById('maxSearchResultSize').value = 5000;
    } else {
      document.getElementById('maxSearchResultSize').value = items.maxSearchResultSize;
    }

    if (!items.maxSearchPages) {
      document.getElementById('maxSearchPages').value = 3;
    } else {
      document.getElementById('maxSearchPages').value = items.maxSearchPages;
    }

    // Rate Limiting
    document.getElementById('minSearchInterval').value = (items.minSearchInterval || 3000) / 1000;
    document.getElementById('maxSearchesPerWindow').value = items.maxSearchesPerWindow || 15;
    document.getElementById('timeWindow').value = (items.timeWindow || 180000) / 60000;
    document.getElementById('burstCooldown').value = (items.burstCooldown || 120000) / 60000;
  });

  // Toggle API Key visibility
  document.getElementById('showApiKey').addEventListener('change', (e) => {
    const apiKeyContainer = document.getElementById('apiKeyContainer');
    if (e.target.checked) {
      apiKeyContainer.style.display = 'block';
    } else {
      apiKeyContainer.style.display = 'none';
    }
  });

  // Toggle Advanced Settings
  const toggleAdvancedSettingsBtn = document.getElementById('toggleAdvancedSettingsBtn');
  const advancedSettings = document.getElementById('advanced-settings');

  toggleAdvancedSettingsBtn.addEventListener('click', () => {
    if (advancedSettings.style.display === 'none') {
      advancedSettings.style.display = 'block';
      toggleAdvancedSettingsBtn.textContent = '▼ 詳細設定';
    } else {
      advancedSettings.style.display = 'none';
      toggleAdvancedSettingsBtn.textContent = '▶ 詳細設定';
    }
  });

  // Save values
  document.getElementById('saveBtn').addEventListener('click', () => {
    const openaiBaseUrl = document.getElementById('openaiBaseUrl').value;
    let openaiApiKey = document.getElementById('openaiApiKey').value;
    const openaiModel = document.getElementById('openaiModel').value;
    const showApiKey = document.getElementById('showApiKey').checked;
    const maxContextSize = parseInt(document.getElementById('maxContextSize').value, 10) || 15000;
    const maxSearchResultSize = parseInt(document.getElementById('maxSearchResultSize').value, 10) || 5000;
    const maxSearchPages = parseInt(document.getElementById('maxSearchPages').value, 10) || 3;

    // Rate Limiting
    const minSearchInterval = (parseFloat(document.getElementById('minSearchInterval').value) || 3) * 1000;
    const maxSearchesPerWindow = parseInt(document.getElementById('maxSearchesPerWindow').value, 10) || 15;
    const timeWindow = (parseFloat(document.getElementById('timeWindow').value) || 3) * 60000;
    const burstCooldown = (parseFloat(document.getElementById('burstCooldown').value) || 2) * 60000;

    if (!showApiKey) {
      openaiApiKey = '';
    }

    chrome.storage.local.set({
      llmProvider: 'openai', // Force provider to openai compatible
      openaiBaseUrl,
      openaiApiKey,
      openaiModel,
      maxContextSize,
      maxSearchResultSize,
      maxSearchPages,
      minSearchInterval,
      maxSearchesPerWindow,
      timeWindow,
      burstCooldown
    }, () => {
      const status = document.getElementById('status');
      status.textContent = '設定を保存しました。';
      setTimeout(() => {
        status.textContent = '';
      }, 2000);
    });
  });
});
