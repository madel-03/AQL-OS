const qwenModels = { cerebras: 'qwen-3.8-27b', groq: 'qwen/qwen3.8-27b' };
export function chatModelOrder(provider, config, preferQwen = false) {
  const original = provider === 'cerebras' ? [config.CEREBRAS_MODEL || 'gpt-oss-120b'] : String(config.GROQ_MODELS || 'openai/gpt-oss-120b,openai/gpt-oss-20b').split(',').map(x => x.trim()).filter(Boolean);
  return [...new Set(preferQwen && config.QWEN_ENABLED !== 'false' ? [qwenModels[provider], ...original] : original)];
}
export function createModelChat({ config = process.env, fetcher = fetch } = {}) {
  return async (provider, system, messages, tools = null, preferQwen = false, { timeoutMs = 45000, maxModels } = {}) => {
    if (!['cerebras','groq'].includes(provider)) throw new Error('Unsupported AI provider');
    const key = config[provider === 'cerebras' ? 'CEREBRAS_API_KEY' : 'GROQ_API_KEY'];
    if (!key) throw new Error(`${provider} API key missing`);
    let lastError;
    const order = chatModelOrder(provider, config, preferQwen);
    for (const model of maxModels ? order.slice(0, maxModels) : order) {
      try {
        const body = { model, temperature: 0.7, messages: [{ role: 'system', content: system }, ...messages] };
        if (tools) { body.tools = tools; body.tool_choice = 'auto'; }
        if (provider === 'groq' && model.startsWith('qwen/')) body.reasoning_effort = 'none';
        const response = await fetcher(provider === 'cerebras' ? 'https://api.cerebras.ai/v1/chat/completions' : 'https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) {
          lastError = Object.assign(new Error(`${provider} ${response.status} on ${model}`), { status: response.status });
          if ([401,402,403].includes(response.status)) throw lastError;
          continue;
        }
        const data = await response.json(); const message = data.choices?.[0]?.message;
        if (!message || (!(typeof message.content === 'string' && message.content.trim()) && !message.tool_calls?.length)) { lastError = new Error(`${provider} returned no answer on ${model}`); continue; }
        return { ...data, model: data.model || model, aqlProvider: provider, aqlRequestedModel: model };
      } catch (error) { lastError = error; if ([401,402,403].includes(error.status)) throw error; }
    }
    throw lastError || new Error(`${provider} models unavailable`);
  };
}
