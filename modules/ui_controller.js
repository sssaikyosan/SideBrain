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

        // Configure marked to open links in new tab
        const renderer = new marked.Renderer();
        const originalLinkRenderer = renderer.link;
        renderer.link = function ({ href, title, text }) {
            // marked v5+ passes an object as the first argument
            // However, older versions or different builds might pass arguments directly.
            // Let's handle both cases or just stick to standard signature if we are sure about version.
            // The imported marked.esm.js seems to be a recent version.
            // Let's try to be robust.
            let linkHref = href;
            let linkTitle = title;
            let linkText = text;

            // If the first argument is an object (token), extract properties
            if (typeof href === 'object' && href !== null) {
                linkHref = href.href;
                linkTitle = href.title;
                linkText = href.text;
            }

            // Disable auto-linking for raw URLs in text
            // If the link text is exactly the same as the href (or very similar), it's likely an autolink.
            // We want to keep explicit markdown links [text](url) but disable raw http://...
            if (linkText === linkHref || linkText === decodeURI(linkHref)) {
                return linkText;
            }

            return `<a href="${linkHref}" title="${linkTitle || ''}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
        };
        marked.setOptions({ renderer: renderer });

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

        // Add click listeners to all links in resultsArea to ensure they open in new tab
        const links = elements.resultsArea.querySelectorAll('a');
        links.forEach(link => {
            // Check if listener is already attached
            if (link.dataset.listenerAttached === 'true') return;

            link.addEventListener('click', (e) => {
                e.preventDefault();
                const url = link.getAttribute('href');
                if (url) {
                    chrome.tabs.create({ url: url });
                }
            });

            // Mark as attached
            link.dataset.listenerAttached = 'true';
        });
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
