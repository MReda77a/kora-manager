'use client';
// The result as a picture to send to the group: both clubs, the score, who scored. Drawn on the
// phone itself and handed to the share sheet (or saved as a file where there is no share sheet).
import { useState } from 'react';

type Side = { name: string; short: string; color1: string; color2: string; manager?: string | null };
export type ShareData = { home: Side; away: Side; score: [number, number]; note: string; goals: { m: number; side: 0 | 1; name: string }[]; line?: string };

function draw(d: ShareData): HTMLCanvasElement {
  const W = 1080, H = 1080, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0B1E3C'); g.addColorStop(1, '#050D1C');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // a glow in each club's colour
  for (const [cx, col] of [[230, d.home.color1], [850, d.away.color1]] as const) {
    const r = x.createRadialGradient(cx, 380, 20, cx, 380, 420);
    r.addColorStop(0, col + '55'); r.addColorStop(1, col + '00');
    x.fillStyle = r; x.fillRect(0, 0, W, H);
  }
  const font = (px: number, w = 700, fam = 'Oswald, Cairo, sans-serif') => { x.font = `${w} ${px}px ${fam}`; };
  const fit = (t: string, max: number, px: number, w = 700) => { let s = px; font(s, w); while (x.measureText(t).width > max && s > 20) { s -= 2; font(s, w); } };
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#2EF2B0'; font(40, 600); x.fillText(d.note.toUpperCase(), W / 2, 120);
  // crests: a disc in the club's colours with its short name
  const crest = (cx: number, s: Side) => {
    x.beginPath(); x.arc(cx, 330, 96, 0, Math.PI * 2); x.fillStyle = s.color1; x.fill();
    x.lineWidth = 10; x.strokeStyle = s.color2 || '#fff'; x.stroke();
    // dark letters on a light shirt, light letters on a dark one
    const h = s.color1.replace('#', ''), lum = h.length >= 6 ? (parseInt(h.slice(0, 2), 16) * 299 + parseInt(h.slice(2, 4), 16) * 587 + parseInt(h.slice(4, 6), 16) * 114) / 1000 : 0;
    x.fillStyle = lum > 160 ? '#0B1E3C' : '#fff'; fit(s.short, 150, 62); x.fillText(s.short, cx, 334);
    x.fillStyle = '#EAF2FF'; fit(s.name, 400, 52); x.fillText(s.name, cx, 480);
    if (s.manager) { x.fillStyle = '#8FA6C4'; fit(s.manager, 380, 34, 500); x.fillText(s.manager, cx, 534); }
  };
  crest(230, d.home); crest(850, d.away);
  x.fillStyle = '#fff'; font(210); x.fillText(`${d.score[0]}–${d.score[1]}`, W / 2, 330);
  // the scorers under each side
  x.textAlign = 'left';
  const col = (side: 0 | 1, left: number) => {
    const list = d.goals.filter((gl) => gl.side === side).slice(0, 7);
    list.forEach((gl, i) => { x.fillStyle = '#2EF2B0'; font(32, 600); x.fillText(`${gl.m}'`, left, 640 + i * 46); x.fillStyle = '#EAF2FF'; fit(gl.name, 330, 34, 500); x.fillText(gl.name, left + 76, 640 + i * 46); });
  };
  col(0, 70); col(1, 640);
  x.textAlign = 'center';
  if (d.line) { x.fillStyle = '#F2C14E'; fit(d.line, 960, 38, 600); x.fillText(d.line, W / 2, 965); }
  x.fillStyle = '#2EF2B0'; font(46, 400, '"Kaushan Script", Oswald, sans-serif'); x.fillText('Vamos!', W / 2, 1030);
  return c;
}

export function ShareButton({ data, className = 'ghost grow' }: { data: ShareData; className?: string }) {
  const [busy, setBusy] = useState(false);
  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      try { await Promise.race([(document as any).fonts?.ready, new Promise((r) => setTimeout(r, 1500))]); } catch { /* draw with what there is */ }
      const blob: Blob | null = await new Promise((res) => draw(data).toBlob(res, 'image/png'));
      if (!blob) return;
      const file = new File([blob], 'vamos-result.png', { type: 'image/png' });
      const text = `${data.home.name} ${data.score[0]}–${data.score[1]} ${data.away.name}`;
      const nav = navigator as any;
      if (nav.canShare?.({ files: [file] })) {
        // closing the sheet is an answer; any other failure (no share target on this device) falls through to saving the file
        try { await nav.share({ files: [file], text }); return; } catch (e: any) { if (e?.name === 'AbortError') return; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'vamos-result.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } finally { setBusy(false); }
  };
  return <button className={className} onClick={share} disabled={busy}><span>Share result</span></button>;
}
