'use client';
import { useEffect, useState } from 'react';
import { getLang, setLang, makeTranslator } from '../lib/i18n.ts';

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'NOSCRIPT']);

// Swaps the English page for Arabic as it renders (see lib/i18n.ts). Only loads the dictionary in Arabic.
export function LangLayer() {
  useEffect(() => {
    if (getLang() !== 'ar') return;
    let stop = false;
    let obs: MutationObserver | null = null;
    (async () => {
      const { DICTS } = await import('../lib/ar/index.ts');
      if (stop) return;
      const tr = makeTranslator(DICTS);
      const mine = new WeakMap<Node, string>();
      const miss: Set<string> = ((window as any).__trMiss ||= new Set());
      const skip = (el: Element | null) => { for (let e = el; e; e = e.parentElement) { if (SKIP.has(e.tagName) || e.hasAttribute('data-notr')) return true; } return false; };
      const text = (n: Node) => {
        const v = n.nodeValue || '';
        if (mine.get(n) === v || !/[A-Za-z]/.test(v) || /[\u0600-\u06FF]/.test(v) || skip(n.parentElement)) return;
        const t = tr(v);
        if (t === null) { const s = v.trim(); if (s.length > 1) miss.add(s); return; }
        const out = (/^\s/.test(v) ? ' ' : '') + t + (/\s$/.test(v) ? ' ' : '');
        mine.set(n, out);
        n.nodeValue = out;
      };
      const attrs = (el: Element) => {
        for (const a of ATTRS) {
          const v = el.getAttribute(a);
          if (!v || !/[A-Za-z]/.test(v) || /[\u0600-\u06FF]/.test(v)) continue;
          const t = tr(v);
          if (t !== null) el.setAttribute(a, t); else miss.add(v);
        }
      };
      const walk = (root: Node) => {
        if (root.nodeType === 3) return text(root);
        if (root.nodeType !== 1 || skip(root as Element)) return;
        attrs(root as Element);
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) text(n); else attrs(n as Element); }
      };
      walk(document.body);
      const t = tr(document.title); if (t) document.title = t;
      document.documentElement.classList.remove('tr-wait');
      obs = new MutationObserver((list) => {
        for (const m of list) {
          if (m.type === 'characterData') text(m.target);
          else if (m.type === 'attributes') attrs(m.target as Element);
          else m.addedNodes.forEach(walk);
        }
      });
      obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    })();
    return () => { stop = true; obs?.disconnect(); };
  }, []);
  return null;
}

// EN / ع switch
export function LangButton() {
  const [ar, setAr] = useState(false);
  useEffect(() => setAr(getLang() === 'ar'), []);
  return (
    <button className="seg" data-notr onClick={() => setLang(getLang() === 'ar' ? 'en' : 'ar')} aria-label={ar ? 'English' : 'عربي'} title={ar ? 'English' : 'عربي'}>
      <span style={{ fontWeight: 900, fontFamily: 'Cairo, system-ui', fontSize: 14 }}>{ar ? 'EN' : 'ع'}</span>
    </button>
  );
}
