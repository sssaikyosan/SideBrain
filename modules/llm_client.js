export async function callLLM(systemPrompt, userPrompt, config, jsonMode, signal) {
    // Always use OpenAI Compatible (Local Model)
    const responseText = await callOpenAICompatible(systemPrompt, userPrompt, config, jsonMode, signal);
    return responseText.replace(/^\s*<think>[\s\S]*?<\/think>/i, '').trim();
}

async function callOpenAICompatible(systemPrompt, userPrompt, config, jsonMode, signal) {
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
        body: JSON.stringify(body),
        signal: signal
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
