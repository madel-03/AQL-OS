import { createContext, useContext } from 'react';

export const AppearanceContext = createContext(null);
export const useAppearance = () => useContext(AppearanceContext);
export const APPEARANCE_KEY = 'aql-appearance-v1';
export const defaultAppearance = { surface: 'glass', wallpaper: 'room', accent: 'ice', opacity: 40, blur: 20, darkness: 48, radius: 22, density: 'comfortable', motion: true, companion: true };
export const accentColors = { ice: '#a4d7ff', lavender: '#b7a3ff', mint: '#91ebcf', peach: '#ffc59e', rose: '#f3b5d9' };
export const wallpaperOptions = ['room', 'aurora', 'ocean', 'dusk', 'plain', 'custom'];
const bounded = (value, fallback, low, high) => typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
export function normalizeAppearance(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    surface: ['glass', 'solid'].includes(value.surface) ? value.surface : defaultAppearance.surface,
    wallpaper: wallpaperOptions.includes(value.wallpaper) ? value.wallpaper : defaultAppearance.wallpaper,
    accent: Object.hasOwn(accentColors, value.accent) ? value.accent : defaultAppearance.accent,
    opacity: bounded(value.opacity, 40, 18, 85), blur: bounded(value.blur, 20, 0, 36),
    darkness: bounded(value.darkness, 48, 25, 80), radius: bounded(value.radius, 22, 10, 32),
    density: ['comfortable', 'compact'].includes(value.density) ? value.density : 'comfortable',
    motion: typeof value.motion === 'boolean' ? value.motion : true,
    companion: typeof value.companion === 'boolean' ? value.companion : true,
  };
}

async function wallpaperDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('aql-appearance', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('wallpapers');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readCustomWallpaper() {
  const db = await wallpaperDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('wallpapers', 'readonly');
      const request = tx.objectStore('wallpapers').get('custom');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function writeCustomWallpaper(blob) {
  const db = await wallpaperDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('wallpapers', 'readwrite');
      if (blob) tx.objectStore('wallpapers').put(blob, 'custom');
      else tx.objectStore('wallpapers').delete('custom');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Wallpaper could not be saved'));
    });
  } finally { db.close(); }
}

export async function prepareWallpaper(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('FILE_TYPE');
  if (file.size > 8 * 1024 * 1024) throw new Error('FILE_SIZE');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('IMAGE_DECODE')), 'image/webp', .88));
  } finally { URL.revokeObjectURL(url); }
}
