import { tabStates } from './state_store.js';

let elements = {};

export function initUI() {
    elements = {
        resultsArea: document.getElementById('resultsArea'),
        intentContent: document.getElementById('intentContent'),
        summaryContent: document.getElementById('summaryContent'),
        loading: document.getElementById('loading'),
        errorDiv: document.getElementById('error'),
        errorMsg: document.getElementById('errorMsg'),
        settingsBtn: document.getElementById('settingsBtn'),
        toggleIntentBtn: document.getElementById('toggleIntentBtn'),
        toggleIcon: document.getElementById('toggleIcon')
    };

    elements.settingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    return elements;
}

export function updateUI(tabId, currentTabId) {
    // Only update UI if the target tab is the currently active one
    if (tabId !== currentTabId) return;

    const state = tabStates[tabId];
    if (!state) {
        // Empty state
        elements.resultsArea.style.display = 'none';
        elements.loading.style.display = 'none';
        elements.errorDiv.style.display = 'none';
        return;
    }

    // Error
    if (state.error) {
        elements.errorMsg.textContent = state.error;
        elements.errorDiv.style.display = 'block';
        elements.loading.style.display = 'none';
        elements.resultsArea.style.display = 'none';
        return;
    } else {
        elements.errorDiv.style.display = 'none';
    }

    // Content
    if (state.intent || state.summary) {
        elements.resultsArea.style.display = 'block';

        // Intent
        elements.intentContent.innerHTML = marked(state.intent);
        if (state.intentVisible) {
            elements.intentContent.style.display = 'block';
            elements.toggleIcon.textContent = '▲';
            elements.toggleIntentBtn.style.borderRadius = '8px 8px 0 0';
        } else {
            elements.intentContent.style.display = 'none';
            elements.toggleIcon.textContent = '▼';
            elements.toggleIntentBtn.style.borderRadius = '8px';
        }

        // Summary
        elements.summaryContent.innerHTML = marked(state.summary);
    } else {
        elements.resultsArea.style.display = 'none';
    }

    // Loading
    if (state.loading) {
        elements.loading.style.display = 'flex';
    } else {
        elements.loading.style.display = 'none';
    }
}

function marked(text) {
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^\s*-\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    html = html.replace(/\n/g, '<br>');
    return html;
}
