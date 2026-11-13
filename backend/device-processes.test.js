import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceEnvironment } from './device-processes.js';

test('program environments do not inherit backend secrets or Node injection options', () => {
  const previous = process.env.AQL_TEST_SECRET;
  process.env.AQL_TEST_SECRET = 'never-forward';
  try {
    const env = deviceEnvironment();
    assert.equal(env.AQL_TEST_SECRET, undefined);
    for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'GROQ_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NPM_TOKEN']) assert.equal(env[name], undefined);
    assert.equal(Object.keys(env).filter(key => key.toLowerCase() === 'path').length, 1);
  } finally { if (previous === undefined) delete process.env.AQL_TEST_SECRET; else process.env.AQL_TEST_SECRET = previous; }
});
