import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceDiagnostic } from './device-diagnostics.js';

test('diagnostics are bounded, redact common credentials and ignore arbitrary metadata', () => {
  const result = deviceDiagnostic({ status: 'failed', output: 'x'.repeat(15000) + '\npassword=private\nBearer abc.def\napi_key=secret', token: 'device-secret', workspace: 'C:/private', steps: [{ type: 'run_node', path: 'app.js', status: 'failed', private: 'hidden' }] });
  assert(result.output.length <= 12000);
  assert(!result.output.includes('private')); assert(!result.output.includes('abc.def')); assert(!result.output.includes('api_key=secret'));
  assert.equal(result.token, undefined); assert.equal(result.workspace, undefined);
  assert.equal(result.steps[0].private, undefined);
});
test('running and successful jobs are not failure evidence', () => {
  for (const status of ['running', 'completed', 'stopped']) assert.equal(deviceDiagnostic({ status, output: 'log' }), null);
  assert.equal(deviceDiagnostic(null), null);
});
