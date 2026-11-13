import test from 'node:test';
import assert from 'node:assert/strict';
import { accentColors, defaultAppearance, normalizeAppearance, prepareWallpaper } from '../src/lib/appearance-settings.js';

test('missing or corrupted saved preferences restore a complete appearance', () => {
  for (const value of [null, undefined, 'invalid', 12, []]) assert.deepEqual(normalizeAppearance(value), defaultAppearance);
});
test('saved appearance values cannot inject arbitrary CSS or remote wallpaper URLs', () => {
  const result = normalizeAppearance({ surface: 'javascript:', wallpaper: 'https://tracker.example/image.jpg', accent: 'red; background:url(x)', density: 'unknown' });
  assert.deepEqual(result, defaultAppearance);
  assert.deepEqual(Object.keys(normalizeAppearance({ extra: 'untrusted' })), Object.keys(defaultAppearance));
});
test('slider values remain within supported ranges and invalid numbers use defaults', () => {
  const result = normalizeAppearance({ opacity: -20, blur: 1000, darkness: -1, radius: Infinity });
  assert.equal(result.opacity, 18); assert.equal(result.blur, 36); assert.equal(result.darkness, 25); assert.equal(result.radius, 22);
  assert.equal(normalizeAppearance({ opacity: '0.5' }).opacity, defaultAppearance.opacity);
  assert.equal(normalizeAppearance({ darkness: NaN }).darkness, defaultAppearance.darkness);
});
test('valid customizations round-trip through JSON without losing accessibility choices', () => {
  const settings = { surface: 'solid', wallpaper: 'custom', accent: 'mint', opacity: 65, blur: 28, darkness: 60, radius: 30, density: 'compact', motion: false, companion: false };
  assert.deepEqual(normalizeAppearance(JSON.parse(JSON.stringify(settings))), settings);
  assert(Object.hasOwn(accentColors, settings.accent));
});
test('wallpaper uploads reject unsupported formats and oversize files before decoding', async () => {
  await assert.rejects(prepareWallpaper({ type: 'image/svg+xml', size: 100 }), /FILE_TYPE/);
  await assert.rejects(prepareWallpaper({ type: 'image/png', size: 9 * 1024 * 1024 }), /FILE_SIZE/);
});
