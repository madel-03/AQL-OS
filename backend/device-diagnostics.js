const redact = value => String(value).replace(/Bearer\s+[\w.+/=-]+/gi, 'Bearer [REDACTED]').replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');

export function deviceDiagnostic(value) {
  if (!value || !['failed', 'timed_out'].includes(value.status) || typeof value.output !== 'string') return null;
  return {
    status: value.status,
    output: redact(value.output).slice(-12000),
    steps: Array.isArray(value.steps) ? value.steps.slice(0, 12).map(step => ({
      type: String(step?.type || '').slice(0, 40),
      path: String(step?.path || '').slice(0, 240),
      status: String(step?.status || '').slice(0, 30),
    })) : [],
  };
}
