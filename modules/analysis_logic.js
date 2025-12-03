import { callLLM } from './llm_client.js';

export async function inferIntentAndQueries(pageData, config, signal) {
    const systemPrompt = `あなたはユーザーの知的活動を支援する高度なAIリサーチアシスタントです。
ユーザーは現在、以下のウェブページを閲覧しています。
このページの内容から、ユーザーが抱いているであろう「根本的な目的」や「解決したい課題」を深く洞察してください。

単にページの内容を要約するのではなく、「ユーザーはこの情報を得て、次に何を知りたくなるか？」「何を実行しようとしているか？」を推測してください。
その上で、その目的を達成するために調査すべき具体的な「疑問点」を洗い出し、最初の検索クエリを生成してください。

重要: 検索クエリは「文章」ではなく、検索エンジンで最も効果的な「キーワードの組み合わせ」にしてください（例: "Hugging Face 使い方", "Hugging Face モデル学習 チュートリアル"）。
技術的なトピックや、より広範な情報を得るために有効な場合は、英語など多言語での検索クエリも積極的に検討してください。

出力は以下のJSON形式のみ:
{
  "intent": "ユーザーの意図や目的の明確な言語化（例: 'Hugging Faceのアカウント作成手順を知りたい', 'BERTモデルのファインチューニング方法を調べたい'）",
  "query": "その目的を達成するための、検索エンジンに最適なキーワードの組み合わせ（スペース区切り）"
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
    const systemPrompt = `あなたは執念深いプロのリサーチャーです。
ユーザーの目的: "${intent}"
現在までの調査結果: "${currentSummary || '(まだありません)'}"
これまでの検索履歴: ${JSON.stringify(searchHistory)}

あなたの使命は、ユーザーの目的を完全に達成するために必要な情報を、一切の漏れなく収集することです。
現状の情報で十分か、厳しく自己評価してください。

以下の観点で「情報の欠落」がないか確認し、次の検索アクションを決定してください：
1. **具体性**: 手順や方法論は具体的か？抽象的な説明で終わっていないか？
2. **多角性**: メリットだけでなくデメリットやリスク、代替案は調査したか？
3. **信頼性**: 一次情報や専門家の意見、最新のデータに基づいているか？
4. **網羅性**: 関連する重要なトピックを見落としていないか？

もし少しでも不明点や深掘りすべき点があれば、それを解消するための鋭い検索クエリを生成してください。
似たような検索を繰り返さず、視点を変えたクエリ（例: "〇〇 デメリット", "〇〇 比較", "〇〇 実例"）を提案してください。
技術的なトピックや、より広範な情報を得るために有効な場合は、英語など多言語での検索クエリも積極的に検討してください。

出力は以下のJSON形式のみ:
{
  "shouldSearch": true/false,
  "query": "次に検索すべき具体的かつ戦略的なクエリ"
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
検索結果が外国語の場合は、内容を日本語に翻訳して要約に統合してください。
以前の情報が古くなった場合は新しい情報で上書きしてください。

重要: 情報の提供のみに集中してください。「〜はいかがでしょうか」や「〜もおすすめです」のような提案や、挨拶、結びの言葉などの蛇足は一切含めないでください。純粋な情報の要約のみを出力してください。`;

    return await callLLM(systemPrompt, "", config, false, signal, onUpdate);
}
