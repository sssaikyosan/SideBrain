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
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('moz-extension://') || tab.url.startsWith('view-source:') || tab.url.includes('addons.mozilla.org')) {
        throw new Error('このページは分析できません。');
    }

    // Retry loop to ensure we get the content of the expected URL
    for (let i = 0; i < 10; i++) {
        let result;
        try {
            result = await chrome.scripting.executeScript({
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
        } catch (e) {
            // Access denied errors (e.g. restricted domains in Firefox)
            if (e.message.includes('Missing host permission') || e.message.includes('The extensions gallery cannot be scripted')) {
                throw new Error('Cannot access contents: Restricted domain');
            }
            console.warn("Script execution failed, retrying...", e);
        }

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

export async function performBrowserSearch(queries, config, onStatusUpdate) {
    const query = queries[0];
    if (!query) return "";

    // Config defaults
    // Rate limiting removed as requested


    // Google検索を使用
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    let searchTab;
    try {
        // 1. 検索結果ページをバックグラウンドタブで開く
        searchTab = await chrome.tabs.create({ url: searchUrl, active: false });

        // 2. ページ読み込み完了を待つ
        await new Promise((resolve) => {
            const listener = (tabId, changeInfo) => {
                if (tabId === searchTab.id && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });

        // 3. 検索結果を抽出
        const maxPages = config.maxSearchPages || 3;
        const results = await chrome.scripting.executeScript({
            target: { tabId: searchTab.id },
            args: [maxPages],
            func: (maxPages) => {
                const items = [];
                const h3s = document.querySelectorAll('h3');
                for (const h3 of h3s) {
                    const a = h3.closest('a');
                    if (a) {
                        let url = a.getAttribute('href');
                        if (url) {
                            // GoogleのリダイレクトURLや内部リンクを処理
                            if (url.startsWith('/url?q=')) {
                                url = new URLSearchParams(url.split('?')[1]).get('q');
                            } else if (url.startsWith('/')) {
                                // 内部リンクは除外（または必要なら絶対パス化）
                                continue;
                            }

                            if (url && url.startsWith('http') && !url.includes('google.com/search')) {
                                items.push({ title: h3.innerText, url: url });
                            }
                        }
                    }
                    if (items.length >= maxPages) break;
                }
                return items;
            }
        });

        // 4. 検索タブを閉じる
        await chrome.tabs.remove(searchTab.id);
        searchTab = null;

        const searchResults = results[0].result;
        if (!searchResults || searchResults.length === 0) return "検索結果なし";

        let combinedText = `--- Query: ${query} ---\n`;

        // 5. 各ページの内容を同様にタブを開いて取得（並列処理はタブ制御が複雑になるため順次処理）
        for (const item of searchResults) {
            // Strict Content-Type Check via HEAD request
            // If HEAD fails or returns non-HTML content, we skip the page to ensure 0 risk of download.
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);
                const response = await fetch(item.url, { method: 'HEAD', signal: controller.signal });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    combinedText += `\n--- Page Start ---\nTitle: ${item.title}\nSourceURL: ${item.url}\nContent: (Skipped: HTTP ${response.status})\n`;
                    continue;
                }

                const contentType = response.headers.get('content-type');
                if (!contentType || (
                    !contentType.includes('text/html') &&
                    !contentType.includes('application/xhtml+xml') &&
                    !contentType.includes('text/plain')
                )) {
                    combinedText += `\n--- Page Start ---\nTitle: ${item.title}\nSourceURL: ${item.url}\nContent: (Skipped: Invalid Content-Type ${contentType || 'unknown'})\n`;
                    continue;
                }
            } catch (e) {
                // If HEAD request fails (timeout, network error, CORS, etc.), we SKIP the page.
                // This is a "fail-safe" approach to prevent opening potential download links that might not support HEAD.
                combinedText += `\n--- Page Start ---\nTitle: ${item.title}\nSourceURL: ${item.url}\nContent: (Skipped: Pre-check failed - ${e.message})\n`;
                continue;
            }

            let itemText = `\n--- Page Start ---\nTitle: ${item.title}\nSourceURL: ${item.url}\n`;
            let pageTab;
            try {
                // ページ用タブを作成
                pageTab = await chrome.tabs.create({ url: item.url, active: false });

                // 読み込み待ち（タイムアウト付き）
                await Promise.race([
                    new Promise(resolve => {
                        const listener = (tabId, changeInfo) => {
                            if (tabId === pageTab.id && changeInfo.status === 'complete') {
                                chrome.tabs.onUpdated.removeListener(listener);
                                resolve();
                            }
                        };
                        chrome.tabs.onUpdated.addListener(listener);
                    }),
                    new Promise(resolve => setTimeout(resolve, 10000)) // 10秒タイムアウト
                ]);

                // コンテンツ抽出
                const limit = (config && config.maxSearchResultSize) ? config.maxSearchResultSize : 8192;
                const contentResult = await chrome.scripting.executeScript({
                    target: { tabId: pageTab.id },
                    args: [limit],
                    func: (limit) => {
                        const clone = document.body.cloneNode(true);
                        const scripts = clone.querySelectorAll('script, style, noscript, iframe, svg');
                        scripts.forEach(s => s.remove());
                        return clone.innerText.replace(/\s+/g, ' ').trim().substring(0, limit);
                    }
                });

                if (contentResult && contentResult[0] && contentResult[0].result) {
                    itemText += `Content: ${contentResult[0].result}...\n`;
                } else {
                    itemText += `Content: (取得失敗)\n`;
                }

            } catch (e) {
                itemText += `Content: (エラー: ${e.message})\n`;
            } finally {
                if (pageTab) {
                    try {
                        await chrome.tabs.remove(pageTab.id);
                    } catch (e) {
                        // タブが既に閉じられている場合などは無視
                    }
                }
            }
            combinedText += itemText;
        }

        return {
            text: combinedText,
            items: searchResults
        };

    } catch (err) {
        if (searchTab) {
            try { await chrome.tabs.remove(searchTab.id); } catch (e) { }
        }
        console.error("Browser Search Error:", err);
        throw err;
    }
}

async function fetchPageContent(url, retries = 5) {
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
