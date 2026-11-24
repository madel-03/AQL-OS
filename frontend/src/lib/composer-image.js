const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function pastedImage(event) {
  const clipboard = event.clipboardData;
  const file = Array.from(clipboard?.files || []).find(item => Object.hasOwn(EXTENSIONS, item.type))
    || Array.from(clipboard?.items || []).find(item => item.kind === 'file' && Object.hasOwn(EXTENSIONS, item.type))?.getAsFile();
  if (!file) return null;
  event.preventDefault();
  return new File([file], `clipboard.${EXTENSIONS[file.type]}`, { type: file.type });
}

export function wantsProduct(text) {
  return Boolean(productSearchQuery(text)) || /ابحث (?:لي )?عن (?:هذا |هال)?(?:ال)?منتج|(?:وين|من وين) (?:أ|ا)?شتري|(?:where (?:can i|to) buy|find this product|shop for)/i.test(text);
}

export function productSearchQuery(text) {
  const request = text.trim().replace(/[؟?!.]+$/, '');
  if (!request) return '';
  const explicit = /^(?:لو سمحت[،,]?\s+)?(?:ابحث (?:لي )?عن (?:عرض|عروض|سعر|اسعار|أسعار|منتج)(?:\s+(?:على|عن|ل))?|(?:من وين|وين) (?:أ|ا)?شتري|where (?:can i|to) buy|shop for)\s+(.+)$/i.exec(request);
  if (explicit) return explicit[1].trim();
  const lookup = /^(?:لو سمحت[،,]?\s+)?(?:[اأ]بحث (?:لي )?عن|د[وّ]*ر (?:لي )?على|find me|look for)\s+(.+)$/i.exec(request);
  if (!lookup) return '';
  const query = lookup[1].trim();
  return /حامل(?:ات)?\s+(?:الشاش[ةه]|الشاشات|شاش[ةه]|شاشات)|ذراع (?:الشاش[ةه]|شاش[ةه])|\bmonitor\s+(?:stand|arm|mount)\b/i.test(query) ? query : '';
}

export function shoppingLink(query) {
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`;
}

