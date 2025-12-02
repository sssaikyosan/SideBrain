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

    try {
        const response = await fetch(searchUrl);
        if (!response.ok) throw new Error(`Search failed: ${response.status}`);
        const text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');

        const results = [];
        const h3s = doc.querySelectorAll('h3');
        for (const h3 of h3s) {
            const a = h3.closest('a');
            if (a) {
                let url = a.getAttribute('href');
                if (url) {
                    // Handle Google's redirect links if present
                    if (url.startsWith('/url?q=')) {
                        url = new URLSearchParams(url.split('?')[1]).get('q');
                    } else if (url.startsWith('/')) {
                        url = 'https://www.google.com' + url;
                    }

                    if (url && !url.startsWith('https://www.google.com/search') && url.startsWith('http')) {
                        results.push({ title: h3.innerText, url: url });
                    }
                }
            }
            if (results.length >= 3) break;
        }

        if (results.length === 0) return "検索結果なし";

        let combinedText = `--- Query: ${query} ---\n`;

        // Fetch all pages in parallel
        const contentPromises = results.map(async (item) => {
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
        throw err;
    }
}

async function fetchPageContent(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');

            const scripts = doc.querySelectorAll('script, style, noscript, iframe, svg');
            scripts.forEach(s => s.remove());

            // bodyがない場合もあるのでチェック
            const content = doc.body ? doc.body.innerText : doc.documentElement.innerText;
            return content.replace(/\s+/g, ' ').trim();
        } catch (e) {
            if (i === retries - 1) throw e;
            // Wait before retry
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
        }
    }
}
