const configuredPort = Number(import.meta.env?.VITE_AQL_LOCAL_BRIDGE_PORT || 8765);
const PORT = Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535 ? configuredPort : 8765;
const ENDPOINT = `http://127.0.0.1:${PORT}/v1/action`;
let paired = null;
let pairing = null;

export function hasLocalDevice() {
  return Boolean(paired);
}

export function disconnectLocalDevice() {
  pairing?.abort();
  paired?.controller.abort();
  pairing = null;
  paired = null;
}

async function call(key, payload, signal) {
  const timeout = AbortSignal.timeout(6500);
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'omit',
    targetAddressSpace: 'loopback',
    redirect: 'error',
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || 'local_device_failed');
  return data;
}

export async function connectLocalDevice(key) {
  const value = key.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('invalid_key');
  pairing?.abort();
  const controller = new AbortController();
  pairing = controller;
  try {
    await call(value, { action: 'status' }, controller.signal);
    controller.signal.throwIfAborted();
    paired?.controller.abort();
    paired = { key: value, controller };
  } finally {
    if (pairing === controller) pairing = null;
  }
}

export function localDeviceAction(payload, signal) {
  if (!paired) throw new Error('local_device_unpaired');
  const connection = paired.controller.signal;
  return call(paired.key, payload, signal ? AbortSignal.any([connection, signal]) : connection);
}

export function localFolderIntent(command) {
  const action = /^(?:افتح (?:مجلد )?|open (?:the )?(?:folder )?)(.+)$/ui.exec(command.trim().replace(/[؟?.!]+$/gu, ''));
  if (!action) return '';
  switch (action[1].trim().toLowerCase()) {
    case 'سطح المكتب': case 'desktop': return 'desktop';
    case 'التنزيلات': case 'التحميلات': case 'downloads': return 'downloads';
    case 'المستندات': case 'documents': return 'documents';
    default: return '';
  }
}
