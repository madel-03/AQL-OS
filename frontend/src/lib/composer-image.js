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
  return Boolean(productSearchQuery(text)) || wantsProductLink(text)
    || /(?:[اأ]بحث|د(?:و|ّ)*ر)\s+(?:لي\s+)?(?:عن|عل[ىي])\s+(?:(?:هذا|هال)\s*)?(?:ال)?منتج|\b(?:find this product|shop for|buy this)\b|(?:كم|وش)\s+سعر|أبغ[اى]\s+أشتري/i.test(text);
}

export function wantsProductLink(text) {
  return /(?:وين|من وين)\s+(?:أ|ا)?شتري(?:ه|ها)?|رابط\s+(?:الشراء|شراء|المنتج)|(?:هات|[اأ]عطني|عطيني|[اأ]رسل)\s+(?:لي\s+)?(?:ال)?رابط|where (?:can i|to) buy|(?:purchase|product|buying) link/i.test(text);
}

export function productSearchQuery(text) {
  const request = text.trim().replace(/[؟?!.]+$/, '');
  if (!request) return '';
  const steam = /\bsteam\b|ستيم/i.test(request);
  const deal = /خصم|عروض|تخفيض|مجاني|\b(?:deals?|discounts?|free|giveaways?)\b|[%٪]/i.test(request);
  if (steam && deal) return request;
  const explicit = /^(?:لو سمحت[،,]?\s+)?(?:ابحث (?:لي )?عن (?:عرض|عروض|سعر|اسعار|أسعار|منتج)(?:\s+(?:على|عن|ل))?|(?:من وين|وين) (?:أ|ا)?شتري|where (?:can i|to) buy|shop for)\s+(.+)$/i.exec(request);
  if (explicit) return explicit[1].trim();
  const lookup = /^(?:لو سمحت[،,]?\s+)?(?:[اأ]بحث (?:لي )?عن|د(?:و|ّ)*ر (?:لي )?على|find me|look for)\s+(.+)$/i.exec(request);
  if (!lookup) return '';
  const query = lookup[1].trim();
  return /حامل(?:ات)?\s+(?:الشاش[ةه]|الشاشات|شاش[ةه]|شاشات)|ذراع (?:الشاش[ةه]|شاش[ةه])|\bmonitor\s+(?:stand|arm|mount)\b/i.test(query) ? query : '';
}

export function shoppingLink(query) {
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`;
}

export async function searchProducts(api, query, lang, headers, signal) {
  try {
    const response = await fetch(`${api}/api/products/search`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ query: query.slice(0, 300), lang }),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export function productSearchReply(search, en) {
  if (search?.results?.length) return search.reply || (en ? 'Here are the search results.' : 'هذي نتائج البحث حسب المواصفات اللي طلبتها.');
  return en ? 'Use the shopping link below to see store results.' : 'تقدر تشوف نتائج المتاجر من رابط التسوق.';
}

