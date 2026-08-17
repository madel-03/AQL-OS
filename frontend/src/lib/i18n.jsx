import { useEffect, useRef, useState } from 'react';
import { LangContext, translate, hoursSuffix, enDict } from './lang';

const sortedKeys = Object.keys(enDict).sort((a, b) => b.length - a.length);
const ARABIC_RX = /[\u0600-\u06FF]/;

function translateDom(lang, origMap) {
  try {
    const root = document.getElementById('root');
    if (!root) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach((n) => {
      if (lang === 'ar') {
        const orig = origMap.get(n);
        if (orig !== undefined && n.nodeValue !== orig) n.nodeValue = orig;
        return;
      }
      if (n.parentElement && n.parentElement.closest('[data-skip-i18n]')) return;
      const txt = n.nodeValue;
      if (!txt || !ARABIC_RX.test(txt)) return;
      if (!origMap.has(n)) origMap.set(n, txt);
      let out = txt;
      for (const k of sortedKeys) {
        if (out.includes(k)) out = out.split(k).join(enDict[k]);
      }
      if (out !== txt) n.nodeValue = out;
    });

    root.querySelectorAll('[placeholder]').forEach((el) => {
      if (lang === 'en') {
        const p = el.getAttribute('placeholder');
        if (!origMap.has(el)) origMap.set(el, p);
        let out = p;
        for (const k of sortedKeys) if (out.includes(k)) out = out.split(k).join(enDict[k]);
        el.setAttribute('placeholder', out);
      } else {
        const orig = origMap.get(el);
        if (orig) el.setAttribute('placeholder', orig);
      }
    });
  } catch (err) {
    // لا نكسر الواجهة
  }
}

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('tawazun-lang') || 'ar');
  const origMap = useRef(new WeakMap());

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('tawazun-lang', lang);
  }, [lang]);

  useEffect(() => {
    const apply = () => translateDom(lang, origMap.current);
    apply();
    const ob = new MutationObserver(() => requestAnimationFrame(apply));
    const root = document.getElementById('root');
    if (root) ob.observe(root, { childList: true, subtree: true, characterData: true });
    return () => ob.disconnect();
  }, [lang]);

  const t = (key) => translate(lang, key);
  const hs = hoursSuffix(lang);

  return (
    <LangContext.Provider value={{ lang, setLang, t, hs }}>
      {children}
    </LangContext.Provider>
  );
}