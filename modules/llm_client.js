export async function callLLM(systemPrompt, userPrompt, config, jsonMode, signal, onUpdate) {
    // Always use OpenAI Compatible (Local Model)
    const responseText = await callOpenAICompatible(systemPrompt, userPrompt, config, jsonMode, signal, onUpdate);
    return responseText.replace(/^\s*<think>[\s\S]*?<\/think>/i, '').trim();
}

async function callOpenAICompatible(systemPrompt, userPrompt, config, jsonMode, signal, onUpdate) {
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
        ],
        stream: !!onUpdate
    };

    // Debug Logging
    if (config.debugMode) {
        console.group('LLM Request');
        console.log('System Prompt:', systemPrompt);
        console.log('User Prompt:', userPrompt);
        console.groupEnd();
    }

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

    if (onUpdate) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullText = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep the last incomplete line in buffer

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;
                if (trimmedLine.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(trimmedLine.slice(6));
                        const content = json.choices[0].delta.content || '';
                        fullText += content;
                        // Filter out <think> tags for streaming display if needed, 
                        // but for now just pass raw content or filtered content.
                        // Let's pass raw content to onUpdate, and let the caller handle filtering if they want,
                        // or we can filter here. Since <think> might be split across chunks, filtering here is hard.
                        // We will just pass fullText so far? Or just the new chunk?
                        // Usually onUpdate expects the full text so far or the delta.
                        // Let's pass the full accumulated text.
                        onUpdate(fullText.replace(/^\s*<think>[\s\S]*?<\/think>/i, '').trim());
                    } catch (e) {
                        console.error('Error parsing stream:', e);
                    }
                }
            }
        }
        if (config.debugMode) {
            console.group('LLM Response (Stream)');
            console.log(fullText);
            console.groupEnd();
        }
        return fullText;
    } else {
        const data = await response.json();
        const content = data.choices[0].message.content;
        if (config.debugMode) {
            console.group('LLM Response');
            console.log(content);
            console.groupEnd();
        }
        return content;
    }
}
