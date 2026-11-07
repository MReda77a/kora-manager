// When each move of a match plays on the watched pitch. Shared by the match page (to lay the moves out)
// and the server (to know how far a live pitch has got, so a shot's result is sent before it is shown).
// It only uses what can be known in advance: who has the ball each minute, how far they get, and where
// and what kind each shot is. Never a shot's result: so the layout never changes when a result comes in.

export type Flow = [number, 0 | 1, number, number]; // minute, side, how far (0-3), shot index or -1
export type ShotLike = { m: number; side: 0 | 1; kind: string };
export type Move = { t0: number; t1: number; s: 0 | 1; r: number; sh: number; merged?: boolean; m0: number; m1: number };

// match minute -> time on the clock of the watched match (stoppage time is squeezed in)
export const tm = (m: number) => (m <= 90 ? m : 90 + (m - 90) * 0.08);

export function moveTimes(flow: Flow[], shots: ShotLike[]): Move[] {
  const groups = new Map<number, Flow[]>();
  for (const f of flow) { const g = groups.get(f[0]) || []; g.push(f); groups.set(f[0], g); }
  const raw: Move[] = [];
  for (const [m, g] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const B = tm(m), A = m <= 1 ? 0 : tm(m - 1);
    // every shot is its own move (two in a minute are two moves), so every chance, penalty and free kick
    // is seen; a minute without one shows its most dangerous spell of possession
    const withShot = g.filter((f) => f[3] >= 0 && shots[f[3]]);
    if (withShot.length > 1) {
      withShot.forEach((f, j) => raw.push({ t0: A + ((B - A) * j) / withShot.length, t1: A + ((B - A) * (j + 1)) / withShot.length, s: f[1], r: f[2], sh: f[3], m0: m, m1: m }));
      continue;
    }
    const main = withShot[0] ?? g.reduce((a, f) => (f[2] >= a[2] ? f : a), g[0]);
    const last = raw[raw.length - 1];
    if (main[3] < 0 && last && last.sh < 0 && !last.merged && last.s === main[1] && Math.abs(last.t1 - A) < 1e-6 && m !== 46) {
      last.t1 = B; last.m1 = m; last.merged = true; if (main[2] > last.r) last.r = main[2]; continue;
    }
    raw.push({ t0: A, t1: B, s: main[1], r: main[2], sh: main[3] >= 0 && shots[main[3]] ? main[3] : -1, m0: m, m1: m });
  }
  // possession that makes sense to the eye: a lone quiet minute of the other team between two minutes
  // of ours is our ball all along (no ping-pong), quiet minutes of one team merge into one longer spell
  // (up to three minutes), and the quiet minute before a shot becomes its build-up
  for (let i = 1; i < raw.length - 1; i++) {
    const a = raw[i - 1], b = raw[i], c = raw[i + 1];
    if (b.sh < 0 && b.r <= 1 && a.s === c.s && b.s !== a.s && !(b.t0 < 45 && b.t1 > 45) && Math.abs(b.t0 - 45) > 0.01) b.s = a.s;
  }
  const spells: Move[] = [];
  for (const m of raw) {
    const last = spells[spells.length - 1];
    const joinable = last && last.s === m.s && Math.abs(last.t1 - m.t0) < 1e-6 && !(last.t1 <= 45.01 && m.t0 >= 45);
    if (joinable && last.sh < 0 && m.sh < 0 && m.t1 - last.t0 <= 3) { last.t1 = m.t1; last.m1 = m.m1; last.r = Math.max(last.r, m.r); continue; }
    if (joinable && last.sh < 0 && m.sh >= 0 && last.t1 - last.t0 <= 1.01) { last.t1 = m.t1; last.m1 = m.m1; last.sh = m.sh; last.r = Math.max(last.r, m.r); continue; }
    spells.push({ ...m });
  }
  raw.length = 0; raw.push(...spells);
  // a chance needs a build-up you can see: a one-minute attack that ends in a shot borrows time from
  // the other team's spell before it (the shot itself stays on its minute)
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i];
    if (b.sh < 0 || a.s === b.s || b.t1 - b.t0 > 1.01 || (a.t1 <= 45.01 && b.t0 >= 45)) continue;
    const give = Math.min(0.8, a.t1 - a.t0 - 0.6);
    if (give > 0.05) { a.t1 -= give; b.t0 -= give; }
  }
  // stoppage time is squeezed into the last moments of the clock: its quiet moves fold into the one before
  for (let i = raw.length - 1; i > 0; i--) if (raw[i].t0 >= 90 - 1e-6 && raw[i].sh < 0) { raw[i - 1].t1 = raw[i].t1; raw[i - 1].m1 = Math.max(raw[i - 1].m1, raw[i].m1); raw.splice(i, 1); }
  // every move gets the time it needs to be followed: an attack that ends in a shot, a penalty, the restart
  // after a shot (the keeper's ball, a corner, a celebration). A busy spell pushes the pitch's clock a little
  // behind the match minute and quiet moves catch up; each half keeps its own time, so the half-time and
  // final whistles stay where they are. None of it depends on how a shot ends.
  const needOf = (i: number) => {
    const m = raw[i], pv = raw[i - 1];
    const kind = m.sh >= 0 ? shots[m.sh]?.kind : '';
    let n = m.sh < 0 ? 0.6 : kind === 'penalty' ? 1.6 : kind === 'free kick' ? 1.25 : 0.95;
    if (pv && pv.sh >= 0) n += pv.s === m.s ? 0.75 : 0.6;
    return n;
  };
  for (const [a, b] of [[0, 45], [45, 90.45]] as [number, number][]) {
    const idx = raw.map((_, i) => i).filter((i) => raw[i].t0 >= (a < 1 ? -1 : a - 1e-6) && raw[i].t0 < b - 1e-6);
    if (!idx.length) continue;
    const need = idx.map((i) => needOf(i));
    const n = idx.length, room = b - a, tot = need.reduce((x, y) => x + y, 0);
    // more happened than the half can show: every move gives up time in proportion, so none is squashed
    if (tot > room) for (let j = 0; j < n; j++) need[j] *= room / tot;
    // the best fit to the clock: each move starts as close as it can to its own minute (a chance ends on
    // the minute it happened), with every move getting the time it needs. With c = the time all moves
    // before need, start = c + u, and u must not go down: the closest such u is an isotonic fit (pool
    // adjacent violators) of the wanted starts minus c, kept inside the half
    const c: number[] = []; let acc = 0; for (let j = 0; j < n; j++) { c.push(acc); acc += need[j]; }
    const want = idx.map((i, j) => (raw[i].sh >= 0 ? raw[i].t1 - need[j] : raw[i].t0));
    const lo = a, hi = b - acc;
    const blocks: { v: number; w: number }[] = [];
    for (let j = 0; j < n; j++) {
      blocks.push({ v: Math.max(lo, Math.min(hi, want[j] - c[j])), w: 1 });
      while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
        const y = blocks.pop()!, x = blocks.pop()!;
        blocks.push({ v: (x.v * x.w + y.v * y.w) / (x.w + y.w), w: x.w + y.w });
      }
    }
    const st: number[] = [];
    for (const bl of blocks) for (let k = 0; k < bl.w; k++) st.push(c[st.length] + Math.max(lo, Math.min(hi, bl.v)));
    st[0] = a; // the half's first move starts on the whistle
    idx.forEach((i, j) => { raw[i].t0 = st[j]; raw[i].t1 = j < n - 1 ? st[j + 1] : Math.max(b, st[j] + need[j]); });
  }
  // the first minute each move plays (the minutes in between belong to it)
  raw.forEach((q, i) => { q.m0 = i ? raw[i - 1].m1 + 1 : 1; });
  return raw;
}

/** when something that happened in minute m shows on the pitch: inside the move that plays that minute */
export function minuteTime(moves: Move[], m: number): number | null {
  const q = moves.find((x) => x.m1 >= m);
  if (!q) return null;
  const span = Math.max(1, q.m1 - q.m0 + 1);
  const frac = 0.15 + 0.65 * Math.max(0, Math.min(1, (m - q.m0 + 0.5) / span));
  return q.t0 + (q.t1 - q.t0) * frac;
}

/** the last match minute a live pitch at time T has shown or will show within `ahead` pitch minutes */
export function shownBy(moves: Move[], T: number, ahead: number): number {
  let m = 0;
  for (const q of moves) if (q.t0 <= T + ahead) m = Math.max(m, q.m1); else break;
  return m;
}
