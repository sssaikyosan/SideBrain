import { callLLM } from './llm_client.js';

export async function inferIntentAndQueries(pageData, config, signal) {
    const systemPrompt = `あなたはユーザーのブラウジングを支援するAIです。
ユーザーは現在、以下の内容のウェブページを見ています。
このページを見ているユーザーが、次に知りたいと思うであろう情報や、疑問に思うであろう点を推測してください。
また、その意図に基づいて、最初に検索すべきクエリも提案してください。

出力は以下のJSON形式のみ:
{
  "intent": "ユーザーの意図や知りたいことの簡潔な説明",
  "query": "最初の検索クエリ"
}`;
    const userPrompt = `--- ページ情報 ---
タイトル: ${pageData.title || ''}
URL: ${pageData.url || ''}
説明: ${pageData.description || ''}

--- ページ内容 (抜粋) ---
${(pageData.content || '').substring(0, 10000)}`;

    const response = await callLLM(systemPrompt, userPrompt, config, true, signal);
    try {
        const jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        return { intent: "情報の分析中...", query: "" };
    }
}

export async function decideNextStep(intent, currentSummary, searchHistory, config, forceExploration = false, signal) {
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

    const response = await callLLM(systemPrompt, "", config, true, signal);
    try {
        const jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        if (searchHistory.length === 0) {
            return { shouldSearch: true, query: intent };
        }
        return { shouldSearch: false };
    }
}

export async function updateSummary(currentSummary, newSearchResults, intent, config, signal, onUpdate) {
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

    return await callLLM(systemPrompt, "", config, false, signal, onUpdate);
}
