// Shorten sentence-boundary pauses without changing words, decimals or question endings.
export function conversationalArabic(text) {
  return String(text).replace(/([.!؟?])(?:[.!؟?]+)?\s+(?=[\p{L}])/gu, '، ').replace(/\n{2,}/g, '\n').trim();
}
