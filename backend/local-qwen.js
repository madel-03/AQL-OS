export function createLocalQwen({ config = process.env, fetcher = fetch } = {}) {
  const model = config.AQL_LOCAL_QWEN_MODEL?.trim();
  if (!model) return null;

  return async (messages, { json = false, signal } = {}) => {
    const deadline = AbortSignal.timeout(90000);
    const response = await fetcher('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: signal ? AbortSignal.any([deadline, signal]) : deadline,
      body: JSON.stringify({ model, messages, stream: false, think: false, ...(json ? { format: 'json' } : {}) }),
    });
    if (!response.ok) throw new Error('Local Qwen HTTP ' + response.status);
    const data = await response.json();
    const content = data.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('Local Qwen returned no text');
    return { content, model: data.model || model };
  };
}
