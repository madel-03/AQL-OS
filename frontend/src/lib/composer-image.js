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
  return /ابحث (?:لي )?عن (?:هذا |هال)?(?:ال)?منتج|(?:وين|من وين) (?:أ|ا)?شتري|(?:where (?:can i|to) buy|find this product|shop for)/i.test(text);
}

export function shoppingLink(query) {
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`;
}

