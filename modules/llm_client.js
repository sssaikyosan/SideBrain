export async function callLLM(systemPrompt, userPrompt, config, jsonMode, signal, onUpdate) {
    // Always use OpenAI Compatible (Local Model)
    const responseText = await callOpenAICompatible(systemPrompt, userPrompt, config, jsonMode, signal, onUpdate);
    return responseText.replace(/^\s*<think>[\s\S]*?<\/think>/i, '').trim();
}

async function callOpenAICompatible(systemPrompt, userPrompt, config, jsonMode, signal, onUpdate) {
    const endpoints = resolveEndpoints(config.openaiBaseUrl);
    const modes = endpoints.preferredMode === 'completion'
        ? ['completion', 'chat']
        : ['chat', 'completion'];
    let lastError = null;

    for (let i = 0; i < modes.length; i++) {
        const mode = modes[i];
        const endpoint = mode === 'chat' ? endpoints.chatEndpoint : endpoints.completionEndpoint;
        const hasFallback = i < modes.length - 1;

        try {
            return await callEndpoint(mode, endpoint, systemPrompt, userPrompt, config, signal, onUpdate);
        } catch (err) {
            lastError = err;
            if (!hasFallback || !err.unsupportedEndpoint) {
                throw err;
            }

            if (config.debugMode) {
                console.warn(`[LLM] ${mode} endpoint is unsupported. Falling back to ${modes[i + 1]} endpoint.`);
            }
        }
    }

    throw lastError || new Error('API Error: Request failed.');
}

function resolveEndpoints(baseUrl) {
    let endpoint = (baseUrl || '').trim();
    if (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);

    if (endpoint.endsWith('/chat/completions')) {
        return {
            preferredMode: 'chat',
            chatEndpoint: endpoint,
            completionEndpoint: endpoint.replace(/\/chat\/completions$/, '/completions')
        };
    }

    if (endpoint.endsWith('/completions')) {
        return {
            preferredMode: 'completion',
            chatEndpoint: endpoint.replace(/\/completions$/, '/chat/completions'),
            completionEndpoint: endpoint
        };
    }

    return {
        preferredMode: 'chat',
        chatEndpoint: `${endpoint}/chat/completions`,
        completionEndpoint: `${endpoint}/completions`
    };
}

async function callEndpoint(mode, endpoint, systemPrompt, userPrompt, config, signal, onUpdate) {
    const body = mode === 'chat'
        ? createChatBody(systemPrompt, userPrompt, config.openaiModel, !!onUpdate)
        : createCompletionBody(systemPrompt, userPrompt, config.openaiModel, !!onUpdate);

    if (config.debugMode) {
        console.group('LLM Request');
        console.log('Mode:', mode);
        console.log('Endpoint:', endpoint);
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
        const errMsg = await extractErrorMessage(response);
        const error = new Error(`API Error (${response.status}): ${errMsg}`);
        error.status = response.status;
        error.unsupportedEndpoint = isUnsupportedEndpoint(response.status, errMsg);
        throw error;
    }

    if (onUpdate) {
        return await readStreamingResponse(response, config, onUpdate);
    }

    const data = await response.json();
    const content = extractContent(data);
    if (content === null) {
        throw new Error('API Error: Unexpected response format.');
    }

    if (config.debugMode) {
        console.group('LLM Response');
        console.log(content);
        console.groupEnd();
    }

    return content;
}

function createChatBody(systemPrompt, userPrompt, model, stream) {
    const normalizedSystem = (systemPrompt || '').trim();
    const normalizedUser = (userPrompt || '').trim();
    const fallbackUserPrompt = 'Please follow the instructions and return the best possible answer.';

    const messages = [];
    if (normalizedSystem) {
        messages.push({ role: 'system', content: normalizedSystem });
    }
    messages.push({ role: 'user', content: normalizedUser || fallbackUserPrompt });

    return {
        model: model || 'local-model',
        messages,
        stream
    };
}

function createCompletionBody(systemPrompt, userPrompt, model, stream) {
    return {
        model: model || 'local-model',
        prompt: buildCompletionPrompt(systemPrompt, userPrompt),
        stream
    };
}

function buildCompletionPrompt(systemPrompt, userPrompt) {
    const system = (systemPrompt || '').trim();
    const user = (userPrompt || '').trim();

    if (system && user) {
        return `${system}\n\nUser:\n${user}\n\nAssistant:\n`;
    }

    if (system) {
        return `${system}\n\nAssistant:\n`;
    }

    return user;
}

async function extractErrorMessage(response) {
    const fallback = response.statusText || `HTTP ${response.status}`;
    let raw = '';

    try {
        raw = await response.text();
    } catch (e) {
        return fallback;
    }

    if (!raw) return fallback;

    try {
        const parsed = JSON.parse(raw);
        return (
            parsed?.error?.message ||
            (typeof parsed?.error === 'string' ? parsed.error : '') ||
            parsed?.message ||
            parsed?.detail ||
            raw
        );
    } catch (e) {
        return raw;
    }
}

function isUnsupportedEndpoint(status, errMsg) {
    const msg = (errMsg || '').toLowerCase();
    if ([404, 405, 501].includes(status)) return true;

    if (status === 400 || status === 422) {
        const hints = [
            'chat/completions',
            'unknown endpoint',
            'not found',
            'unsupported',
            'not implemented',
            'invalid endpoint',
            'route',
            'error rendering prompt with jinja template',
            'prompt template',
            'no user query found in messages'
        ];
        return hints.some(hint => msg.includes(hint));
    }

    return false;
}

async function readStreamingResponse(response, config, onUpdate) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;
            if (!trimmedLine.startsWith('data: ')) continue;

            try {
                const json = JSON.parse(trimmedLine.slice(6));
                const chunk = extractContent(json, true);
                if (!chunk) continue;

                fullText += chunk;
                onUpdate(stripThinkingBlock(fullText));
            } catch (e) {
                console.error('Error parsing stream:', e);
            }
        }
    }

    if (config.debugMode) {
        console.group('LLM Response (Stream)');
        console.log(fullText);
        console.groupEnd();
    }

    return fullText;
}

function extractContent(data, isStreaming = false) {
    const choice = data?.choices?.[0];
    if (!choice) return null;

    if (isStreaming) {
        if (typeof choice?.delta?.content === 'string') return choice.delta.content;
        if (Array.isArray(choice?.delta?.content)) {
            return choice.delta.content
                .map(part => (typeof part?.text === 'string' ? part.text : ''))
                .join('');
        }
        if (typeof choice?.text === 'string') return choice.text;
        return '';
    }

    if (typeof choice?.message?.content === 'string') return choice.message.content;
    if (Array.isArray(choice?.message?.content)) {
        return choice.message.content
            .map(part => (typeof part?.text === 'string' ? part.text : ''))
            .join('');
    }
    if (typeof choice?.text === 'string') return choice.text;

    return null;
}

function stripThinkingBlock(text) {
    if (!/^\s*<think>/i.test(text)) return text;
    if (!/<\/think>/i.test(text)) return '';
    return text.replace(/^\s*<think>[\s\S]*?<\/think>/i, '').trim();
}
