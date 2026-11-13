// Execute every tool call in a turn, in order, and preserve one response per call.
export async function executeToolCalls(calls, execute, actions) {
  const results = [];
  for (const call of calls) {
    const name = call.function?.name ?? call.name;
    let args;
    let result;
    try {
      args = call.function ? JSON.parse(call.function.arguments || '{}') : (call.args ?? {});
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Expected an argument object');
    } catch {
      result = `tool ${name} failed: invalid arguments; no operation was performed`;
    }
    if (result === undefined) {
      // Record the attempt before execution: a remote write can succeed even if its response fails.
      const action = { tool: name, status: 'running', result: '' };
      actions.push(action);
      try {
        result = String(await execute(name, args));
        action.status = /^(tool .* failed:|unknown tool )/.test(result) ? 'failed' : 'completed';
      } catch (error) {
        result = `tool ${name} failed: ${error.message}`;
        action.status = 'uncertain';
      }
      action.result = result;
    }
    results.push({ call, result });
  }
  return results;
}
