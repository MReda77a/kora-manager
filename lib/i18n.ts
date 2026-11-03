// Arabic (Egyptian, casual) for the whole game without touching the English source: the page is
// rendered in English and every text node, placeholder and tooltip is swapped for its Arabic line as it
// appears. Fixed lines are looked up as they are; lines with names or numbers in them are written as
// patterns ('Season {0} over' -> 'الموسم {0} خلص'), and the pieces that fill them are translated too.
export type Lang = 'en' | 'ar';
const KEY = 'vamos-lang';

export function getLang(): Lang {
  try { return localStorage.getItem(KEY) === 'ar' ? 'ar' : 'en'; } catch { return 'en'; }
}
export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* private window: this visit only */ }
  document.cookie = `${KEY}=${l}; path=/; max-age=31536000; samesite=lax`;
  location.reload();
}

// set before the first paint (an inline script in the layout), so an Arabic player never sees the page flip
export const BOOT = `try{if(localStorage.getItem('${KEY}')==='ar'){var d=document.documentElement;d.lang='ar';d.dir='rtl';d.classList.add('ar','tr-wait');setTimeout(function(){d.classList.remove('tr-wait')},1500)}}catch(e){}`;

const DATES: Record<string, string> = {
  mon: 'الاتنين', tue: 'التلات', wed: 'الأربع', thu: 'الخميس', fri: 'الجمعة', sat: 'السبت', sun: 'الحد',
  monday: 'الاتنين', tuesday: 'التلات', wednesday: 'الأربع', thursday: 'الخميس', friday: 'الجمعة', saturday: 'السبت', sunday: 'الحد',
  jan: 'يناير', feb: 'فبراير', mar: 'مارس', apr: 'أبريل', may: 'مايو', jun: 'يونيو', jul: 'يوليو', aug: 'أغسطس', sep: 'سبتمبر', oct: 'أكتوبر', nov: 'نوفمبر', dec: 'ديسمبر',
  january: 'يناير', february: 'فبراير', march: 'مارس', april: 'أبريل', june: 'يونيو', july: 'يوليو', august: 'أغسطس', september: 'سبتمبر', october: 'أكتوبر', november: 'نوفمبر', december: 'ديسمبر',
  am: 'ص', pm: 'م', today: 'النهارده', tomorrow: 'بكرة', yesterday: 'امبارح',
};
const WORD = /[A-Za-z]+/g;
const DATE = new RegExp(`^[\\s\\d:,./-]*(?:(?:${Object.keys(DATES).join('|')})\\b[\\s\\d:,./-]*)+$`, 'i');

type Pat = { re: RegExp; slots: number[]; out: string };
export type Dict = { exact: Record<string, string>; patterns: Record<string, string> };

export function makeTranslator(dicts: Dict[]) {
  const exact = new Map<string, string>();
  const upper = new Map<string, string>();
  const pats: Pat[] = [];
  const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  for (const d of dicts) {
    for (const [k, v] of Object.entries(d.exact)) { exact.set(k, v); upper.set(k.toUpperCase(), v); }
    for (const [k, v] of Object.entries(d.patterns)) {
      const slots: number[] = [];
      const src = esc(k).replace(/\{(\d)\}/g, (_m, a) => { slots.push(Number(a)); return '(.+?)'; });
      pats.push({ re: new RegExp(`^${src}$`, 's'), slots, out: v });
    }
  }
  // the most specific pattern first: the one with the most fixed text
  pats.sort((a, b) => b.re.source.replace(/\(\.\+\?\)/g, '').length - a.re.source.replace(/\(\.\+\?\)/g, '').length);
  const cache = new Map<string, string | null>();

  const one = (s: string, depth: number): string | null => {
    if (!/[A-Za-z]/.test(s)) return s;
    const hit = exact.get(s) ?? (s === s.toUpperCase() ? upper.get(s) : undefined);
    if (hit !== undefined) return hit;
    if (depth > 3) return null;
    const ord = /^(\d+)(st|nd|rd|th)$/.exec(s);
    if (ord) return `الـ${ord[1]}`;
    // dates and times written by the browser in English ("Fri, Nov 6", "Sunday 10:33 AM")
    if (DATE.test(s)) return s.replace(WORD, (w) => DATES[w.toLowerCase()] ?? w);
    for (const p of pats) {
      const m = p.re.exec(s);
      if (!m) continue;
      let out = p.out;
      p.slots.forEach((slot, i) => {
        const v = m[i + 1];
        const t = /[A-Za-z]/.test(v) ? (one(v.trim(), depth + 1) ?? v) : v;
        out = out.split(`{${slot}}`).join(t);
      });
      return out;
    }
    // a line made of parts ("8th · target top 2 · D2"): translate each part
    for (const sep of [' · ', ' — ', ' – ', ': ', '. ', ' | ', ', ']) {
      if (!s.includes(sep)) continue;
      const parts = s.split(sep);
      const done = parts.map((p) => (p.trim() ? one(p.trim(), depth + 1) : p));
      if (done.some((p, i) => p !== null && p !== parts[i].trim())) {
        const sepOut = sep === ', ' ? '، ' : sep === '. ' ? '. ' : sep;
        return done.map((p, i) => p ?? parts[i]).join(sepOut);
      }
    }
    // a sentence ending in punctuation the dictionary has without it
    const tail = /^(.*?)([.!?…:]+)$/s.exec(s);
    if (tail && tail[1]) { const t = one(tail[1], depth + 1); if (t !== null) return t + tail[2].replace('?', '؟'); }
    // a leading emoji or symbol the dictionary has without it
    const lead = /^([^A-Za-z0-9"'(]+)(.+)$/su.exec(s);
    if (lead) { const t = one(lead[2], depth + 1); if (t !== null) return lead[1] + t; }
    return null;
  };

  return (raw: string): string | null => {
    const s = raw.replace(/\s+/g, ' ').trim();
    if (!s) return null;
    if (cache.has(s)) return cache.get(s)!;
    const t = one(s, 0);
    const out = t === s ? null : t;
    cache.set(s, out);
    return out;
  };
}
