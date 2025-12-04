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
        toggleIcon: document.getElementById('toggleIcon'),
        toggleRefsBtn: document.getElementById('toggleRefsBtn'),
        toggleRefsIcon: document.getElementById('toggleRefsIcon'),
        refsContent: document.getElementById('refsContent')
    };

    elements.settingsBtn.addEventListener('click', () => {
        if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.openOptionsPage) {
            browser.runtime.openOptionsPage();
        } else {
            chrome.runtime.openOptionsPage();
        }
    });

    return elements;
}

function sanitizeHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const allowedTags = new Set([
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li',
        'blockquote', 'pre', 'code', 'a', 'strong', 'em', 'del', 'b', 'i',
        'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'span', 'div'
    ]);
    const allowedAttributes = new Set(['href', 'title', 'target', 'rel', 'src', 'alt', 'class', 'id']);

    // Remove dangerous tags completely
    const forbiddenTags = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'link', 'meta'];
    forbiddenTags.forEach(tag => {
        const elements = doc.body.querySelectorAll(tag);
        elements.forEach(el => el.remove());
    });

    // Walk through all elements
    const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    const nodesToUnwrap = [];

    let currentNode = walker.nextNode();
    while (currentNode) {
        const tagName = currentNode.tagName.toLowerCase();
        if (!allowedTags.has(tagName)) {
            nodesToUnwrap.push(currentNode);
        } else {
            // Check attributes
            const attrs = Array.from(currentNode.attributes);
            attrs.forEach(attr => {
                if (!allowedAttributes.has(attr.name)) {
                    currentNode.removeAttribute(attr.name);
                } else if (['href', 'src'].includes(attr.name)) {
                    // Sanitize URLs
                    if (/^\s*javascript:/i.test(attr.value)) {
                        currentNode.removeAttribute(attr.name);
                    }
                }
            });
        }
        currentNode = walker.nextNode();
    }

    // Unwrap disallowed tags (keep content)
    nodesToUnwrap.reverse().forEach(node => {
        const parent = node.parentNode;
        if (parent) {
            while (node.firstChild) {
                parent.insertBefore(node.firstChild, node);
            }
            parent.removeChild(node);
        }
    });

    return doc.body.innerHTML;
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
        renderer.link = function ({ href, title, text }) {
            let linkHref = href;
            let linkTitle = title;
            let linkText = text;

            if (typeof href === 'object' && href !== null) {
                linkHref = href.href;
                linkTitle = href.title;
                linkText = href.text;
            }

            // Disable auto-linking for raw URLs
            if (linkText === linkHref || linkText === decodeURI(linkHref)) {
                return linkText;
            }

            return `<a href="${linkHref}" title="${linkTitle || ''}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
        };
        marked.setOptions({ renderer: renderer });

        // Intent
        elements.intentContent.innerHTML = sanitizeHTML(marked.parse(state.intent || ""));
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
            elements.summaryContent.innerHTML = sanitizeHTML(newSummary);
        }

        // References
        if (state.references && state.references.length > 0) {
            let refsHtml = "<ul>";
            state.references.forEach(ref => {
                refsHtml += `<li><a href="${ref.url}" target="_blank" rel="noopener noreferrer">${ref.title}</a></li>`;
            });
            refsHtml += "</ul>";
            elements.refsContent.innerHTML = refsHtml;
            elements.toggleRefsBtn.parentElement.style.display = 'block';

            if (state.refsVisible) {
                elements.refsContent.style.display = 'block';
                elements.toggleRefsIcon.textContent = '▲';
                elements.toggleRefsBtn.style.borderRadius = '8px 8px 0 0';
            } else {
                elements.refsContent.style.display = 'none';
                elements.toggleRefsIcon.textContent = '▼';
                elements.toggleRefsBtn.style.borderRadius = '8px';
            }
        } else {
            elements.toggleRefsBtn.parentElement.style.display = 'none';
        }

        // Add click listeners to all links in resultsArea to ensure they open in new tab
        const links = elements.resultsArea.querySelectorAll('a');
        links.forEach(link => {
            if (link.dataset.listenerAttached === 'true') return;

            link.addEventListener('click', (e) => {
                e.preventDefault();
                const url = link.getAttribute('href');
                if (url) {
                    browser.tabs.create({ url: url });
                }
            });

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
