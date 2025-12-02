import { tabStates } from './state_store.js';
import { marked } from '../libs/marked.esm.js';

let elements = {};

export function initUI() {
    elements = {
        resultsArea: document.getElementById('resultsArea'),
        intentContent: document.getElementById('intentContent'),
        summaryContent: document.getElementById('summaryContent'),
        loading: document.getElementById('loading'),
        loadingText: document.querySelector('#loading span'),
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

export function updateUI(tabId, currentTabId, options = { flash: true }) {
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
        elements.intentContent.innerHTML = marked.parse(state.intent || "");
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
        const previousSummary = elements.summaryContent.innerHTML;
        const newSummary = marked.parse(state.summary || "");

        if (previousSummary !== newSummary) {
            elements.summaryContent.innerHTML = newSummary;
            // Apply flash effect if it's an update (not first load) AND flash is requested
            if (previousSummary && options.flash) {
                elements.summaryContent.classList.remove('flash-update');
                void elements.summaryContent.offsetWidth; // Trigger reflow
                elements.summaryContent.classList.add('flash-update');
            }
        }
    } else {
        elements.resultsArea.style.display = 'none';
    }

    // Loading
    if (state.loading) {
        elements.loading.style.display = 'flex';
        elements.loadingText.textContent = state.statusMessage || "処理中...";
    } else {
        elements.loading.style.display = 'none';
    }
}
