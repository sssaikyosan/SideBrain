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
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
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

// Rate Limiting Variables
let lastSearchTime = 0;
let searchTimestamps = []; // Store timestamps of recent searches
const MIN_SEARCH_INTERVAL = 5000; // Minimum 5 seconds between searches
const MAX_SEARCHES_PER_WINDOW = 15; // Max 15 searches...
const TIME_WINDOW = 180000; // ...in 3 minutes
const BURST_COOLDOWN = 120000; // Wait 2 minutes if limit reached

export async function performBrowserSearch(queries) {
    const query = queries[0];
    if (!query) return "";

    const now = Date.now();

    // 1. Minimum Interval Check
    const timeSinceLastSearch = now - lastSearchTime;
    if (timeSinceLastSearch < MIN_SEARCH_INTERVAL) {
        const waitTime = MIN_SEARCH_INTERVAL - timeSinceLastSearch;
        console.log(`Search interval limit. Waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // 2. Burst Limit Check (Sliding Window)
    // Remove timestamps older than TIME_WINDOW
    searchTimestamps = searchTimestamps.filter(t => Date.now() - t < TIME_WINDOW);

    if (searchTimestamps.length >= MAX_SEARCHES_PER_WINDOW) {
        console.warn(`Burst limit reached (${MAX_SEARCHES_PER_WINDOW} searches in 3 mins). Waiting ${BURST_COOLDOWN / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, BURST_COOLDOWN));
        // Clear history after cooldown to allow fresh start
        searchTimestamps = [];
    }

    // Update state
    lastSearchTime = Date.now();
    searchTimestamps.push(lastSearchTime);

    // Google検索を使用
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    try {
        // 1. 検索結果ページをバックグラウンドタブで開く
        const searchTab = await chrome.tabs.create({ url: searchUrl, active: false });

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
        const results = await chrome.scripting.executeScript({
            target: { tabId: searchTab.id },
            func: () => {
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
                    if (items.length >= 3) break;
                }
                return items;
            }
        });

        // 4. 検索タブを閉じる
        await chrome.tabs.remove(searchTab.id);

        const searchResults = results[0].result;
        if (!searchResults || searchResults.length === 0) return "検索結果なし";

        let combinedText = `--- Query: ${query} ---\n`;

        // 5. 各ページの内容を同様にタブを開いて取得（並列処理はタブ制御が複雑になるため順次処理）
        for (const item of searchResults) {
            // Check for downloadable file extensions to avoid auto-download
            const skipExtensions = ['.pdf', '.zip', '.exe', '.dmg', '.iso', '.csv', '.xlsx', '.docx', '.pptx'];
            const lowerUrl = item.url.toLowerCase();
            if (skipExtensions.some(ext => lowerUrl.endsWith(ext))) {
                combinedText += `\n--- Page Start ---\nTitle: ${item.title}\nSourceURL: ${item.url}\nContent: (Skipped: Downloadable file)\n`;
                continue;
            }

            let itemText = `\n--- Page Start ---\nTitle: ${item.title}\nSourceURL: ${item.url}\n`;
            try {
                // ページ用タブを作成
                const pageTab = await chrome.tabs.create({ url: item.url, active: false });

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
                const contentResult = await chrome.scripting.executeScript({
                    target: { tabId: pageTab.id },
                    func: () => {
                        const clone = document.body.cloneNode(true);
                        const scripts = clone.querySelectorAll('script, style, noscript, iframe, svg');
                        scripts.forEach(s => s.remove());
                        return clone.innerText.replace(/\s+/g, ' ').trim().substring(0, 2000);
                    }
                });

                // タブを閉じる
                await chrome.tabs.remove(pageTab.id);

                if (contentResult && contentResult[0] && contentResult[0].result) {
                    itemText += `Content: ${contentResult[0].result}...\n`;
                } else {
                    itemText += `Content: (取得失敗)\n`;
                }

            } catch (e) {
                itemText += `Content: (エラー: ${e.message})\n`;
            }
            combinedText += itemText;
        }

        return {
            text: combinedText,
            items: searchResults
        };

    } catch (err) {
        console.error("Browser Search Error:", err);
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
