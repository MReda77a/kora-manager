'use client';
// Browser helpers.
export async function api<T = any>(url: string, data?: unknown): Promise<T> {
  const res = await fetch(url, data === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const j = await res.json().catch(() => ({ error: 'Network error.' }));
  if (!res.ok) throw new Error(j.error || 'Something went wrong.');
  return j as T;
}

export function shirt(id: string, pos: string) {
  if (pos === 'GK') return 1;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const base: Record<string, number[]> = { CB: [4, 5, 6, 15, 23], LB: [3, 12, 21], RB: [2, 22, 24], DM: [6, 16, 18], CM: [8, 14, 20], CAM: [10, 17, 19], LW: [7, 11, 27], RW: [7, 11, 17], ST: [9, 19, 29] };
  const arr = base[pos] || [13];
  return arr[h % arr.length];
}

export function tier(ovr: number) {
  return ovr >= 88 ? 'legend' : ovr >= 80 ? 'gold' : ovr >= 72 ? 'silver' : 'bronze';
}

export function when(iso: string, now = Date.now()) {
  const t = new Date(iso).getTime();
  const d = t - now;
  const abs = Math.abs(d);
  const m = Math.round(abs / 60000);
  const txt = m < 1 ? 'now' : m < 60 ? `${m}m` : m < 60 * 24 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  if (m < 1) return 'now';
  return d > 0 ? `in ${txt}` : `${txt} ago`;
}

export function clock(iso: string) {
  return new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

export const localToUtcMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (((h * 60 + m + new Date().getTimezoneOffset()) % 1440) + 1440) % 1440;
};
export const utcMinToLocal = (u: number) => {
  const l = (((u - new Date().getTimezoneOffset()) % 1440) + 1440) % 1440;
  return `${String(Math.floor(l / 60)).padStart(2, '0')}:${String(l % 60).padStart(2, '0')}`;
};

