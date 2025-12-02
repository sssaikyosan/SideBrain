
document.addEventListener('DOMContentLoaded', () => {
    const resultsArea = document.getElementById('resultsArea');
    const intentContent = document.getElementById('intentContent');
    const summaryContent = document.getElementById('summaryContent');
    const loading = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const errorMsg = document.getElementById('errorMsg');
    const settingsBtn = document.getElementById('settingsBtn');
    const toggleIntentBtn = document.getElementById('toggleIntentBtn');
    const toggleIcon = document.getElementById('toggleIcon');

    // State management per tab
    // Structure: { [tabId]: { intent, summary, searchHistory, isAnalyzing, analysisId, intentVisible, error } }
    const tabStates = {};
    let currentTabId = null;

    settingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    toggleIntentBtn.addEventListener('click', () => {
        if (!currentTabId || !tabStates[currentTabId]) return;

        const state = tabStates[currentTabId];
        state.intentVisible = !state.intentVisible;
        updateUI(currentTabId);
    });

    // Initialize
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            currentTabId = tabs[0].id;
            handleTabChange(currentTabId);
        }
    });

    // Listen for tab updates
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'loading' && changeInfo.url) {
            // Reset state for this tab on navigation
            resetTabState(tabId);
            if (tabId === currentTabId) updateUI(tabId);
        }

        if (changeInfo.status === 'complete') {
            // Start analysis if not already running or if reset
            if (!tabStates[tabId] || !tabStates[tabId].isAnalyzing) {
                startAnalysisLoop(tabId);
            }
        }
    });

    // Listen for tab activation
    chrome.tabs.onActivated.addListener((activeInfo) => {
        currentTabId = activeInfo.tabId;
        updateUI(currentTabId);

        // If no state exists for this tab (e.g. first visit since panel open), start analysis
        // We need to check if the tab is loaded.
        chrome.tabs.get(currentTabId, (tab) => {
            if (tab.status === 'complete') {
                if (!tabStates[currentTabId]) {
                    startAnalysisLoop(currentTabId);
                }
            }
        });
    });

    // Listen for tab removal to clean up memory
    chrome.tabs.onRemoved.addListener((tabId) => {
        if (tabStates[tabId]) {
            // Stop any running loop for this tab (logic inside loop checks state)
            tabStates[tabId].analysisId++;
            delete tabStates[tabId];
        }
    });

    function resetTabState(tabId) {
        if (tabStates[tabId]) {
            tabStates[tabId].analysisId++; // Invalidate previous loop
        }
        tabStates[tabId] = {
            intent: "",
            summary: "",
            searchHistory: [],
            isAnalyzing: false,
            analysisId: (tabStates[tabId]?.analysisId || 0) + 1,
            intentVisible: false,
            error: null,
            loading: false
        };
    }

    function handleTabChange(tabId) {
        if (!tabStates[tabId]) {
            resetTabState(tabId);
            startAnalysisLoop(tabId);
        } else {
            updateUI(tabId);
        }
    }

    function updateUI(tabId) {
        // Only update UI if the target tab is the currently active one
        if (tabId !== currentTabId) return;

        const state = tabStates[tabId];
        if (!state) {
            // Empty state
            resultsArea.style.display = 'none';
            loading.style.display = 'none';
            errorDiv.style.display = 'none';
            return;
        }

        // Error
        if (state.error) {
            errorMsg.textContent = state.error;
            errorDiv.style.display = 'block';
            loading.style.display = 'none';
            resultsArea.style.display = 'none';
            return;
        } else {
            errorDiv.style.display = 'none';
        }

        // Content
        if (state.intent || state.summary) {
            resultsArea.style.display = 'block';

            // Intent
            intentContent.innerHTML = marked(state.intent);
            if (state.intentVisible) {
                intentContent.style.display = 'block';
                toggleIcon.textContent = '▲';
                toggleIntentBtn.style.borderRadius = '8px 8px 0 0';
            } else {
                intentContent.style.display = 'none';
                toggleIcon.textContent = '▼';
                toggleIntentBtn.style.borderRadius = '8px';
            }

            // Summary
            summaryContent.innerHTML = marked(state.summary);
        } else {
            resultsArea.style.display = 'none';
        }

        // Loading
        if (state.loading) {
            loading.style.display = 'flex';
        } else {
            loading.style.display = 'none';
        }
    }

    async function startAnalysisLoop(tabId) {
        // Initialize state if needed
        if (!tabStates[tabId]) resetTabState(tabId);

        const state = tabStates[tabId];
        const myAnalysisId = state.analysisId;

        state.isAnalyzing = true;
        state.loading = true;
        state.error = null;
        updateUI(tabId);

        let config;
        let pageContent;

        try {
            // 1. Initial Setup
            config = await getConfig();
            validateConfig(config);
            pageContent = await getPageContent(tabId);

            // 2. Initial Intent Inference
            const intentData = await inferIntentAndQueries(pageContent, config);

            if (state.analysisId !== myAnalysisId) return; // Stop if reset happened

            state.intent = intentData.intent;
            updateUI(tabId);

            // 3. Continuous Loop
            // 3. Continuous Loop
            while (state.analysisId === myAnalysisId) {
                // Determine next query
                const nextStep = await decideNextStep(state.intent, state.summary, state.searchHistory, config, true);

                if (state.analysisId !== myAnalysisId) return;

                if (nextStep.shouldSearch && nextStep.query) {
                    state.loading = true;
                    updateUI(tabId);

                    // Perform Search
                    const searchResults = await performBrowserSearch([nextStep.query]);
                    state.searchHistory.push(nextStep.query);

                    if (state.analysisId !== myAnalysisId) return;

                    // Update Summary
                    state.summary = await updateSummary(state.summary, searchResults, state.intent, config);
                    state.loading = false;
                    updateUI(tabId);

                } else {
                    // No search needed immediately, but we continue loop
                    if (!state.summary) {
                        state.summary = "追加の情報を収集中です...";
                        updateUI(tabId);
                    }
                    state.loading = false;
                    updateUI(tabId);
                }

                // Wait before next iteration (e.g. 15s)
                for (let i = 0; i < 15; i++) {
                    if (state.analysisId !== myAnalysisId) return;
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

        } catch (err) {
            if (state.analysisId === myAnalysisId) {
                console.error(err);
                state.error = err.message;
                state.loading = false;
                updateUI(tabId);
            }
        } finally {
            if (state.analysisId === myAnalysisId) {
                state.isAnalyzing = false;
            }
        }
    }
});

// --- Logic Functions ---

async function decideNextStep(intent, currentSummary, searchHistory, config, forceExploration = false) {
    const systemPrompt = `あなたは自律的なリサーチャーです。
ユーザーの意図: "${intent}"
現在までの調査結果要約: "${currentSummary || '(まだありません)'}"
これまでの検索クエリ: ${JSON.stringify(searchHistory)}

目標は、ユーザーの意図に対して**可能な限り深く、多角的な情報**を提供し続けることです。
一度の検索で満足せず、関連する新しい視点や、より詳細な情報を得るための検索クエリを提案してください。
もし十分な情報が集まっているように見えても、さらに深掘りできる点がないか検討してください。
どうしても追加の検索が不要な場合のみ、クエリを空にしてください。

出力は以下のJSON形式のみ:
{
  "shouldSearch": true/false,
  "query": "検索クエリ"
}`;

    const response = await callLLM(systemPrompt, "", config, true);
    try {
        const jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (e) {
        if (searchHistory.length === 0) {
            return { shouldSearch: true, query: intent };
        }
        return { shouldSearch: false };
    }
}

async function updateSummary(currentSummary, newSearchResults, intent, config) {
    const systemPrompt = `あなたは優秀なリサーチャーです。
ユーザーの意図: ${intent}
現在の要約:
"${currentSummary}"

新しく得られた検索結果:
${newSearchResults}

この新しい情報を統合して、要約を更新・改善してください。
情報は常に最新かつ包括的であるように心がけてください。
回答は日本語で、読みやすく箇条書きなどを使って整理してください。
以前の情報が古くなった場合は新しい情報で上書きしてください。`;

    return await callLLM(systemPrompt, "", config, false);
}

async function getConfig() {
    return new Promise((resolve) => {
        chrome.storage.local.get([
            'openaiBaseUrl',
            'openaiApiKey',
            'openaiModel'
        ], (items) => {
            if (!items.openaiBaseUrl) items.openaiBaseUrl = 'http://localhost:1234/v1';
            if (!items.openaiModel) items.openaiModel = 'local-model';
            items.llmProvider = 'openai';
            resolve(items);
        });
    });
}

function validateConfig(config) {
    if (!config.openaiBaseUrl) {
        throw new Error('Base URLが設定されていません。');
    }
}

async function getPageContent(tabId) {
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

    const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => { return document.body.innerText; }
    });
    if (result && result[0] && result[0].result) {
        return result[0].result.substring(0, 50000);
    }
    throw new Error('ページの内容を取得できませんでした。');
}

async function inferIntentAndQueries(pageText, config) {
    const systemPrompt = `あなたはユーザーのブラウジングを支援するAIです。
ユーザーは現在、以下の内容のウェブページを見ています。
このページを見ているユーザーが、次に知りたいと思うであろう情報や、疑問に思うであろう点を推測してください。
出力は以下のJSON形式のみ:
{
  "intent": "ユーザーの意図や知りたいことの簡潔な説明"
}`;
    const userPrompt = `--- ページ内容 (抜粋) ---
${pageText}`;
    const response = await callLLM(systemPrompt, userPrompt, config, true);
    try {
        const jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (e) {
        return { intent: "情報の分析中..." };
    }
}

async function performBrowserSearch(queries) {
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
        for (const item of searchResults) {
            combinedText += `\nTitle: ${item.title}\nURL: ${item.url}\n`;
            try {
                const content = await fetchPageContent(item.url);
                combinedText += `Content: ${content.substring(0, 2000)}...\n`;
            } catch (e) {
                combinedText += `Content: (取得失敗) ${e.message}\n`;
            }
        }
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

async function callLLM(systemPrompt, userPrompt, config, jsonMode) {
    // Always use OpenAI Compatible (Local Model)
    const responseText = await callOpenAICompatible(systemPrompt, userPrompt, config, jsonMode);
    return responseText.replace(/^\s*<think>[\s\S]*?<\/think>/i, '').trim();
}

async function callOpenAICompatible(systemPrompt, userPrompt, config, jsonMode) {
    let endpoint = config.openaiBaseUrl;
    if (!endpoint.endsWith('/chat/completions')) {
        if (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);
        endpoint += '/chat/completions';
    }
    const body = {
        model: config.openaiModel || 'local-model',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    };
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.openaiApiKey || 'lm-studio'}`
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        let errMsg = response.statusText;
        try {
            const err = await response.json();
            if (err.error && err.error.message) errMsg = err.error.message;
        } catch (e) { }
        throw new Error(`API Error: ${errMsg}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
}

function showError(msg) {
    const errorDiv = document.getElementById('error');
    const errorMsg = document.getElementById('errorMsg');
    errorMsg.textContent = msg;
    errorDiv.style.display = 'block';
}

function marked(text) {
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^\s*-\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    html = html.replace(/\n/g, '<br>');
    return html;
}
