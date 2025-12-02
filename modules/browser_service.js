export async function getPageContent(tabId, expectedUrl) {
    // If tabId is provided, use it. Otherwise query active tab.
    let tab;
    if (tabId) {
        try {
            tab = await chrome.tabs.get(tabId);
        } catch (e) {
            throw new Error('タブが見つかりません');
        }
    } else {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = tabs[0];
    }

    if (!tab) throw new Error('タブが見つかりません。');
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
        throw new Error('このページは分析できません。');
    }

    // Retry loop to ensure we get the content of the expected URL
    for (let i = 0; i < 10; i++) {
        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const clone = document.body.cloneNode(true);
                const scripts = clone.querySelectorAll('script, style, noscript, iframe, svg');
                scripts.forEach(s => s.remove());
                const metaDesc = document.querySelector('meta[name="description"]');
                return {
                    content: clone.innerText.replace(/\s+/g, ' ').trim(),
                    title: document.title,
                    description: metaDesc ? metaDesc.content : '',
                    url: window.location.href
                };
            }
        });

        if (result && result[0] && result[0].result) {
            const data = result[0].result;
            // If expectedUrl is provided, verify it matches.
            // We check if the current page URL contains the expected URL or starts with it.
            if (!expectedUrl || data.url === expectedUrl || data.url.startsWith(expectedUrl)) {
                return data;
            }
        }
        // Wait 500ms before retry
        await new Promise(r => setTimeout(r, 500));
    }

    throw new Error('ページの読み込みが完了しませんでした（URL不一致）。');
}

export async function performBrowserSearch(queries) {
    const query = queries[0];
    if (!query) return "";

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const searchTab = await chrome.tabs.create({ url: searchUrl, active: false });

    try {
        await waitForTabLoad(searchTab.id);
        const links = await chrome.scripting.executeScript({
            target: { tabId: searchTab.id },
            func: () => {
                const results = [];
                const h3s = document.querySelectorAll('h3');
                for (const h3 of h3s) {
                    const a = h3.closest('a');
                    if (a && a.href && !a.href.startsWith('https://www.google.com/search')) {
                        results.push({ title: h3.innerText, url: a.href });
                    }
                    if (results.length >= 3) break;
                }
                return results;
            }
        });
        const searchResults = links[0].result;
        chrome.tabs.remove(searchTab.id);

        if (!searchResults || searchResults.length === 0) return "検索結果なし";

        let combinedText = `--- Query: ${query} ---\n`;

        // Fetch all pages in parallel
        const contentPromises = searchResults.map(async (item) => {
            let itemText = `\nTitle: ${item.title}\nURL: ${item.url}\n`;
            try {
                const content = await fetchPageContent(item.url);
                itemText += `Content: ${content.substring(0, 2000)}...\n`;
            } catch (e) {
                itemText += `Content: (取得失敗) ${e.message}\n`;
            }
            return itemText;
        });

        const contents = await Promise.all(contentPromises);
        combinedText += contents.join('');

        return combinedText;
    } catch (err) {
        chrome.tabs.remove(searchTab.id).catch(() => { });
        throw err;
    }
}

async function waitForTabLoad(tabId) {
    return new Promise((resolve) => {
        const listener = (tid, changeInfo) => {
            if (tid === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}

async function fetchPageContent(url, retries = 3) {
    const tab = await chrome.tabs.create({ url: url, active: false });
    try {
        for (let i = 0; i < retries; i++) {
            try {
                await waitForTabLoad(tab.id);
                const result = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => {
                        const clone = document.body.cloneNode(true);
                        const scripts = clone.querySelectorAll('script, style, noscript, iframe, svg');
                        scripts.forEach(s => s.remove());
                        return clone.innerText.replace(/\s+/g, ' ').trim();
                    }
                });

                if (result && result[0] && result[0].result) {
                    return result[0].result;
                }
                throw new Error("Empty content");
            } catch (e) {
                if (i === retries - 1) throw e;
                // Wait before retry (e.g., 2s, 4s, 8s)
                await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i)));
                // Reload tab to try again
                await chrome.tabs.reload(tab.id);
            }
        }
    } finally {
        chrome.tabs.remove(tab.id).catch(() => { });
    }
}
