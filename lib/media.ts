// The Media section: a TV show after every matchday, a fans' social feed and the paper.
// Everything is written from what really happened in the league (results, press conferences, plans,
// transfers), so it is funny about the right people and useful at the same time. Small effects:
// the TV verdict nudges fans and board once per matchday, a reply to the fans moves the board.
import { q, one, writes, type Row } from './db.ts';
import { fail } from './errors.ts';
import { PRESETS } from './game.ts';
import { counterShare, nearestPreset } from './engine.ts';
import { getLeague, myClub, standings } from './league.ts';
import { hashSeed } from './rng.ts';

type Who = 'kareem' | 'sami';
export type Line = { who: Who; text: string };
export type Wall =
  | { kind: 'result'; home: Crest; away: Crest; score: [number, number]; label: string }
  | { kind: 'tactics'; preset: string; manager: string; counter: string; pct: number; label: string }
  | { kind: 'board'; title: string; rows: { name: string; note: string; tone: 'good' | 'bad' | 'mid' }[] }
  | { kind: 'transfer'; player: string; from: string; to: string; fee: number; label: string }
  | { kind: 'stat'; big: string; small: string; label: string };
type Crest = { name: string; short: string; c1: string; c2: string; shape: number; emblem: number };
export type Segment = { key: string; title: string; wall: Wall; lines: Line[] };

const pick = <T,>(arr: T[], ...seed: (string | number)[]) => arr[hashSeed(...seed) % arr.length];
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const money = (v: number) => (v >= 10 ? `${Math.round(v)}M` : `${v.toFixed(1)}M`);
const ord = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`;

// ---------------------------------------------------------------- what the pundits say
const T = {
  thrash: [
    '{loser} turned up, I will give them that. That is the only thing I will give them.',
    '{score}. I have seen better defending in a car park on a Friday night.',
    "{lm}'s defence was so open they should charge rent for the space.",
    "{loser} didn't lose that match. They donated it.",
    'Somebody tell {lm} the game started at kick-off, not at half-time.',
  ],
  thrashSami: ['Credit to {winner}, they were sharp from the first whistle.', '{wm} got everything right today: the plan, the shape, the changes.', 'That is a statement result from {winner}. The table will notice.'],
  narrow: ['{winner} won ugly. Ugly still gets three points, sadly for my eyes.', 'Nobody will put that one on a DVD, but {wm} will not care.', '{loser} did everything except the one thing that matters: scoring.'],
  narrowSami: ['Tight game. Small details, and {winner} got them right.', 'Fine margins. {loser} can take some positives from that.'],
  draw: ["A draw. Both managers will call it 'a point gained'. Both are lying.", '{home} and {away} shared the points and, by the look of it, the boredom.', 'Ninety minutes of football and the scoreboard did not notice.'],
  drawSami: ['Fair result. Neither side deserved to lose it.', 'A point each, and both will feel they could have nicked it.'],
  upset: ['{loser} lost to {winner}. Read that again. Then go and lie down.', "Somewhere a bookmaker is laughing at {lm}'s team sheet.", '{winner} were {wp} in the table this morning. {lm} made them look like champions.'],
  upsetSami: ['Huge result for {winner}. Nobody gave them a chance.', 'That is why we play the games. {winner} fully deserved it.'],
  wordsKept: ['{m} said they would win. They won. I hate it when managers are right.', 'Big words from {m} in the press room, and for once the football backed them up.'],
  wordsEaten: ['{m} promised a win in the press room. {score}. Somebody check on {m}, please.', "I'm told {m}'s press conference quotes are now being used as a comedy podcast.", '{m} talked a big game. Turns out the game was bigger.'],
  wordsSami: ['Bold words before a big game always come back to you. Good or bad.', "The press room is part of the job. It added pressure on both dressing rooms."],
  tactics: ['{m} has played {preset} in {n} of the last {t}. Predictable? I would not say that on air. Oh wait.', '{m} loves {preset} more than some people love their family.', 'Every week {m} picks {preset}. Every week the opponents say thank you.'],
  tacticsSami: ['If you face {m}, {counter} is the answer: about {pct}% of the time it comes out on top against {preset}.', 'The numbers say {counter} works best against {preset}. Worth a look before you meet {m}.'],
  hotSeat: ['{m}: {form}. The board have started reading job adverts. Out loud.', "{m}'s run is {form}. Even the kit man has stopped making eye contact.", '{m} is on {form}. I would not buy a house near the stadium just yet.'],
  hotSami: ['Pressure is building on {m}. One good result changes everything, though.', 'Tough spell for {m}. The squad is good enough to turn it around.'],
  motw: ['{m} wins Manager of the Week. Enjoy it, it never lasts.', 'Manager of the Week: {m}. Try not to mention it in every group chat.'],
  motwSami: ['{m} got the plan spot on. Deserved.', 'Great week for {m}. The players clearly believe in the plan.'],
  transfer: ['{to} paid {fee} for {player}. That is either genius or a cry for help.', '{fee} for {player}? At that price I want him to cook dinner as well.', '{from} got {fee} for {player}. Someone at {from} deserves a raise.'],
  transferSami: ['Big statement signing for {to}. He fits the way they play.', '{player} gives {to} quality and options. Smart business if he settles fast.'],
  wasteful: ['{club} had {xg} expected goals and scored {g}. The training ground has a Finishing drill, I am told.', '{club} created {shots} shots and scored {g}. The goal was not moving, lads.'],
  wastefulSami: ['A finishing session in Training would turn those chances into points.', 'The chances are there for {club}. It will click soon if they keep creating.'],
};

// the useful part of a result: why it went that way, from the match stats
function whyLine(f: Row, home: string, away: string): Line[] {
  const st = f.stats; if (!st) return [];
  const poss = st.poss?.[0] ?? 50, xg = st.xg || [0, 0], sh = st.shots || [0, 0];
  const top = poss >= 58 ? home : poss <= 42 ? away : null;
  const better = xg[0] - xg[1] >= 0.8 ? home : xg[1] - xg[0] >= 0.8 ? away : null;
  const won = f.home_goals > f.away_goals ? home : f.away_goals > f.home_goals ? away : null;
  if (top && won && top !== won) return [{ who: 'kareem', text: `${top} had ${top === home ? poss : 100 - poss}% of the ball and lost. Possession is not a trophy, lads. Counter-attacks are.` }];
  if (better && won && better !== won) return [{ who: 'sami', text: `${better} created more (${Math.max(xg[0], xg[1]).toFixed(1)} xG to ${Math.min(xg[0], xg[1]).toFixed(1)}). On another day that ends differently.` }];
  if (won) return [{ who: 'sami', text: `${won} took ${won === home ? sh[0] : sh[1]} shots to ${won === home ? sh[1] : sh[0]}. They wanted it more.` }];
  return [{ who: 'kareem', text: `${sh[0] + sh[1]} shots between them. I counted. I regret counting.` }];
}

// ---------------------------------------------------------------- data for a matchday
async function lastDay(leagueId: number) {
  const r = await one(`SELECT MAX(day)::int AS d FROM fixtures WHERE league_id=$1 AND status='done'`, [leagueId]);
  return r?.d ?? null;
}

async function dayData(l: Row, day: number) {
  const [fx, clubs, users] = await Promise.all([
    q(`SELECT id, home_id, away_id, home_goals, away_goals, comp, division, sides, report->'stats' AS stats FROM fixtures WHERE league_id=$1 AND day=$2 AND status='done'`, [l.id, day]),
    q('SELECT id, name, short, color1, color2, shape, emblem, user_id, club_type, division, fans, board FROM clubs WHERE league_id=$1', [l.id]),
    q('SELECT u.id, u.username FROM users u WHERE u.id IN (SELECT user_id FROM clubs WHERE league_id=$1 AND user_id IS NOT NULL)', [l.id]),
  ]);
  const club = new Map<number, Row>(clubs.map((c) => [c.id, c]));
  const uname = new Map<number, string>(users.map((u) => [u.id, u.username]));
  const mgr = (id: number) => { const c = club.get(id); return c?.user_id ? uname.get(c.user_id) || c.name : c?.name ?? '?'; };
  const tables = new Map<number, Row[]>();
  for (let d = 1; d <= (l.divisions || 1); d++) tables.set(d, await standings(l.id, d));
  const posOf = (id: number) => { const c = club.get(id); const t = tables.get(c?.division || 1) || []; return t.findIndex((x) => x.id === id) + 1; };
  return { fx, club, mgr, posOf, tables, humans: clubs.filter((c) => c.user_id) };
}

const crestOf = (c: Row): Crest => ({ name: c.name, short: c.short, c1: c.color1, c2: c.color2, shape: c.shape ?? 0, emblem: c.user_id ? c.emblem ?? 0 : -1 });

// ---------------------------------------------------------------- the TV show
export async function tvShow(uid: number, leagueId: number) {
  const l = await getLeague(leagueId);
  const me = await myClub(uid, leagueId);
  const day = await lastDay(leagueId);
  if (day == null) return { day: null, segments: [], verdict: null, hotSeat: [] };
  const D = await dayData(l, day);
  const segs: Segment[] = [];
  const v = (s: string, x: Record<string, string | number>) => fill(s, x);

  // 1) the result of the day: a derby, a thrashing, an upset or the human clash
  const scored = D.fx.map((f) => {
    const h = D.club.get(f.home_id)!, a = D.club.get(f.away_id)!;
    const margin = Math.abs(f.home_goals - f.away_goals);
    const humans = (h.user_id ? 1 : 0) + (a.user_id ? 1 : 0);
    const win = f.home_goals > f.away_goals ? h : f.away_goals > f.home_goals ? a : null;
    const lose = win ? (win.id === h.id ? a : h) : null;
    const upset = win && lose && D.posOf(win.id) - D.posOf(lose.id) >= 5;
    return { f, h, a, margin, humans, win, lose, upset, w: humans * 10 + margin * 3 + (upset ? 6 : 0) + (h.club_type === 'fan' && a.club_type === 'fan' && humans === 2 ? 20 : 0) };
  }).sort((x, y) => y.w - x.w);
  const big = scored[0];
  if (big) {
    const x = { winner: big.win?.name ?? '', loser: big.lose?.name ?? '', wm: big.win ? D.mgr(big.win.id) : '', lm: big.lose ? D.mgr(big.lose.id) : '', home: big.h.name, away: big.a.name, score: `${big.f.home_goals}–${big.f.away_goals}`, wp: big.win ? ord(D.posOf(big.win.id)) : '' };
    const kind = !big.win ? 'draw' : big.upset ? 'upset' : big.margin >= 3 ? 'thrash' : 'narrow';
    segs.push({
      key: 'result', title: 'Result of the day',
      wall: { kind: 'result', home: crestOf(big.h), away: crestOf(big.a), score: [big.f.home_goals, big.f.away_goals], label: big.f.comp === 'cup' ? 'CUP' : `MATCHDAY · ${kind.toUpperCase()}` },
      lines: [{ who: 'kareem', text: v(pick((T as any)[kind], l.id, day, 'r'), x) }, { who: 'sami', text: v(pick((T as any)[kind + 'Sami'], l.id, day, 'rs'), x) }, ...whyLine(big.f, big.h.name, big.a.name)],
    });
  }

  // 2) words in the press room against what happened
  const press = await q(`SELECT p.club_id, p.effects, f.home_id, f.away_id, f.home_goals, f.away_goals FROM pressers p JOIN fixtures f ON f.id=p.fixture_id WHERE f.league_id=$1 AND f.day=$2 AND p.done`, [leagueId, day]);
  const bold = press.map((p) => ({ ...p, stake: Number(p.effects?.total?.stake) || 0 }) as Row).sort((a, b) => b.stake - a.stake)[0];
  if (bold && bold.stake > 0.2) {
    const mine = bold.club_id === bold.home_id ? bold.home_goals : bold.away_goals, theirs = bold.club_id === bold.home_id ? bold.away_goals : bold.home_goals;
    const m = D.mgr(bold.club_id);
    const won = mine > theirs;
    segs.push({
      key: 'words', title: 'The press room verdict',
      wall: { kind: 'stat', big: bold.effects?.quote?.text ? `“${String(bold.effects.quote.text).slice(0, 90)}”` : `${m} talked big`, small: `${D.club.get(bold.club_id)?.name} ${mine}–${theirs}`, label: won ? 'WORDS BACKED UP' : 'EATING THOSE WORDS' },
      lines: [{ who: 'kareem', text: v(pick(won ? T.wordsKept : T.wordsEaten, l.id, day, 'w'), { m, score: `${mine}–${theirs}` }) }, { who: 'sami', text: pick(T.wordsSami, l.id, day, 'ws') }],
    });
  }

  // 3) tactics corner: the most predictable manager, and how to beat him (the useful bit)
  const plans: { id: number; m: string; preset: string; n: number; t: number }[] = [];
  for (const c of D.humans) {
    const rows = await q(`SELECT CASE WHEN home_id=$2 THEN sides->0->'tactic' ELSE sides->1->'tactic' END AS t FROM fixtures WHERE league_id=$1 AND status='done' AND (home_id=$2 OR away_id=$2) AND sides IS NOT NULL ORDER BY day DESC LIMIT 5`, [leagueId, c.id]);
    const ps = rows.map((r) => (r.t ? (r.t.preset && PRESETS[r.t.preset] ? r.t.preset : nearestPreset(r.t)) : null)).filter(Boolean) as string[];
    if (!ps.length) continue;
    const top = Object.entries(ps.reduce((a: Record<string, number>, p) => ({ ...a, [p]: (a[p] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0];
    plans.push({ id: c.id, m: D.mgr(c.id), preset: top[0], n: top[1], t: ps.length });
  }
  const predictable = plans.filter((p) => p.id !== me.id).sort((a, b) => b.n / b.t - a.n / a.t || b.n - a.n)[0] || plans[0];
  if (predictable) {
    const counter = Object.keys(PRESETS).sort((a, b) => counterShare(b, predictable.preset) - counterShare(a, predictable.preset))[0];
    const pct = Math.round(counterShare(counter, predictable.preset) * 100);
    const x = { m: predictable.m, preset: predictable.preset, n: predictable.n, t: predictable.t, counter, pct };
    segs.push({
      key: 'tactics', title: 'Tactics corner',
      wall: { kind: 'tactics', preset: predictable.preset, manager: predictable.m, counter, pct, label: `${predictable.m.toUpperCase()} · ${predictable.preset.toUpperCase()} ${predictable.n}/${predictable.t}` },
      lines: [{ who: 'kareem', text: v(pick(T.tactics, l.id, day, 't'), x) }, { who: 'sami', text: v(pick(T.tacticsSami, l.id, day, 'ts'), x) }],
    });
  }

  // 4) wasted chances (useful: points at Training)
  const waste = D.fx.flatMap((f) => [0, 1].map((s) => ({ c: D.club.get(s ? f.away_id : f.home_id)!, g: s ? f.away_goals : f.home_goals, xg: Number(f.stats?.xg?.[s] ?? 0), shots: Number(f.stats?.shots?.[s] ?? 0) })))
    .filter((x) => x.c.user_id && x.xg - x.g >= 1.2).sort((a, b) => b.xg - b.g - (a.xg - a.g))[0];
  if (waste) {
    const x = { club: waste.c.name, xg: waste.xg.toFixed(1), g: waste.g, shots: waste.shots };
    segs.push({ key: 'waste', title: 'Stat of the week', wall: { kind: 'stat', big: `${waste.xg.toFixed(1)} xG → ${waste.g} goals`, small: `${waste.c.name} · ${waste.shots} shots`, label: 'FINISHING PROBLEM' },
      lines: [{ who: 'kareem', text: v(pick(T.wasteful, l.id, day, 'x'), x) }, { who: 'sami', text: v(pick(T.wastefulSami, l.id, day, 'xs'), x) }] });
  }

  // 5) the biggest deal since the last show
  const deal = await one(`SELECT * FROM transfers WHERE league_id=$1 AND season=$2 AND day<=$3 AND day>$3-2 AND fee>0 ORDER BY fee DESC LIMIT 1`, [leagueId, l.season, day]);
  if (deal) {
    const x = { player: deal.player_name, from: deal.from_name, to: deal.to_name, fee: money(Number(deal.fee)) };
    segs.push({ key: 'deal', title: 'Transfer talk', wall: { kind: 'transfer', player: deal.player_name, from: deal.from_name, to: deal.to_name, fee: Number(deal.fee), label: 'DEAL OF THE WEEK' },
      lines: [{ who: 'kareem', text: v(pick(T.transfer, l.id, day, 'd'), x) }, { who: 'sami', text: v(pick(T.transferSami, l.id, day, 'ds'), x) }] });
  }

  // 6) hot seat and manager of the week (form over the last three games)
  const form = (id: number) => { const c = D.club.get(id)!; const t = D.tables.get(c.division || 1) || []; return (t.find((x) => x.id === id)?.form || []).slice(-3) as string[]; };
  const pts = (f: string[]) => f.reduce((a, r) => a + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
  const rank = D.humans.map((c) => ({ id: c.id, m: D.mgr(c.id), f: form(c.id) })).filter((x) => x.f.length).sort((a, b) => pts(a.f) - pts(b.f));
  const hotSeat = rank.filter((x) => pts(x.f) <= 2).slice(0, 3).map((x) => ({ name: x.m, note: x.f.join(' '), tone: 'bad' as const }));
  const best = rank[rank.length - 1];
  if (rank.length) {
    const lines: Line[] = [];
    if (hotSeat[0]) { const hx = { m: hotSeat[0].name, form: hotSeat[0].note }; lines.push({ who: 'kareem', text: v(pick(T.hotSeat, l.id, day, 'h'), hx) }, { who: 'sami', text: v(pick(T.hotSami, l.id, day, 'hs'), hx) }); }
    if (best && pts(best.f) >= 6) lines.push({ who: 'kareem', text: v(pick(T.motw, l.id, day, 'm'), { m: best.m }) }, { who: 'sami', text: v(pick(T.motwSami, l.id, day, 'ms'), { m: best.m }) });
    if (lines.length) segs.push({ key: 'seat', title: 'Hot seat', wall: { kind: 'board', title: 'FORM · LAST 3', rows: [...rank].reverse().slice(0, 5).map((x) => ({ name: x.m, note: x.f.join(' '), tone: pts(x.f) >= 6 ? 'good' : pts(x.f) <= 2 ? 'bad' : 'mid' })) }, lines });
  }

  // the verdict on each manager this matchday, applied once for everyone (small: fans and board)
  const verdicts = new Map<number, { tone: 'praised' | 'mocked' | 'ignored'; why: string; fans: number; board: number }>();
  for (const c of D.humans) {
    const f = D.fx.find((x) => x.home_id === c.id || x.away_id === c.id);
    if (!f) continue;
    const mine = f.home_id === c.id ? f.home_goals : f.away_goals, theirs = f.home_id === c.id ? f.away_goals : f.home_goals;
    const words = press.find((p) => p.club_id === c.id && (Number(p.effects?.total?.stake) || 0) > 0.2);
    const tone = mine - theirs >= 2 || (words && mine > theirs) ? 'praised' : theirs - mine >= 2 || (words && mine < theirs) ? 'mocked' : 'ignored';
    verdicts.set(c.id, { tone, why: tone === 'praised' ? (words ? 'Backed up the big words.' : 'A convincing win.') : tone === 'mocked' ? (words ? 'Big words, no answers.' : 'A heavy defeat.') : 'Nothing to talk about.', fans: tone === 'praised' ? 1 : tone === 'mocked' ? -1 : 0, board: tone === 'praised' ? 1 : tone === 'mocked' ? -1 : 0 });
  }
  const done = new Set((await q(`SELECT club_id FROM media_fx WHERE league_id=$1 AND day=$2 AND kind='tv'`, [leagueId, day])).map((r) => r.club_id));
  const w = writes();
  for (const [id, vd] of verdicts) {
    if (done.has(id) || (!vd.fans && !vd.board)) continue;
    w.add(`INSERT INTO media_fx (league_id, club_id, day, kind) VALUES ($1,$2,$3,'tv') ON CONFLICT DO NOTHING`, [leagueId, id, day]);
    w.add('UPDATE clubs SET fans=GREATEST(3000, ROUND(fans * (1 + $2::numeric / 100))), board=LEAST(100, GREATEST(0, board+$3)) WHERE id=$1', [id, vd.fans, vd.board]);
  }
  await w.flush();
  const mv = verdicts.get(me.id) || null;
  return { day, segments: segs, verdict: mv ? { ...mv, effect: mv.fans ? `Fans ${mv.fans > 0 ? '+' : '−'}1% · board ${mv.board > 0 ? '+' : '−'}1` : 'No effect' } : null, hotSeat };
}

// ---------------------------------------------------------------- the fans' feed
const HANDLES = ['Ultras', '_Army', 'TillIDie', 'Loyal', 'Curva', 'FanTV', '1897', 'Faithful', 'Barmy', 'Kop'];
const FANS = {
  bigWin: ['WHAT A PERFORMANCE 🔥🔥 {score} and it could have been more', '{manager} you beauty. Statue outside the ground when?', 'Sorry {opp}, we were just warming up 😂 {score}'],
  win: ['3 points is 3 points. Ugly but we take it 🙌', 'Good win. Now do it again on {next}', 'Never in doubt (it was very much in doubt)'],
  draw: ['A draw against {opp}? We pay for tickets for this?', 'Fine. A point. I am not angry, just disappointed.', '{player} was the only one who turned up today'],
  loss: ['{manager} OUT. I will not be taking questions 😡', '{score} to {opp}. I am going to bed.', 'Who picked this team. Genuinely asking.'],
  bigLoss: ['{score}?!?! I want my season ticket money back', '{manager} has lost the dressing room, the plot and my respect', 'That was the worst thing I have seen since my ex 🤡'],
  star: ['{player} is too good for this league. Keep him at all costs 🙏', '{player} ({rating}) carried the team on his back again'],
  flop: ['{player} ({rating}) was invisible. Is he even on the pitch?', 'Please give {player} a rest. For all our sakes.'],
  striker: ['BUY A STRIKER. We have scored {g} in {p}. This is not hard.'],
  defender: ['We have let in {ga} in {p}. A centre-back please, any centre-back.'],
  rival: ['How did the derby go, {club} fans? 😂 {score}', '{club} fans very quiet today. Wonder why 🤔'],
};

function mood(c: Row, form: string[]) {
  const f = form.slice(-5).reduce((a, r) => a + (r === 'W' ? 9 : r === 'D' ? 1 : -9), 0);
  return Math.max(0, Math.min(100, Math.round(c.board * 0.5 + 25 + f)));
}

export async function socialFeed(uid: number, leagueId: number) {
  const l = await getLeague(leagueId);
  const me = await myClub(uid, leagueId);
  const day = await lastDay(leagueId);
  await settlePromises(l, me);
  const table = await standings(leagueId, me.division || 1);
  const row = table.find((x) => x.id === me.id);
  const form: string[] = row?.form || [];
  const posts: { id: string; club: string; color: string; handle: string; text: string; likes: number; tag?: string; mine: boolean }[] = [];
  const mkHandle = (c: Row, k: number) => `@${c.short || c.name.split(' ')[0]}${HANDLES[hashSeed(c.id, k, day ?? 0) % HANDLES.length]}`;
  const users = await q('SELECT id, username FROM users WHERE id IN (SELECT user_id FROM clubs WHERE league_id=$1 AND user_id IS NOT NULL)', [leagueId]);
  const mgr = (c: Row) => (c.user_id ? users.find((u) => u.id === c.user_id)?.username : null) || 'the manager';
  const clubs = await q('SELECT id, name, short, color1, user_id, club_type, board FROM clubs WHERE league_id=$1', [leagueId]);
  const byId = new Map<number, Row>(clubs.map((c) => [c.id, c]));
  if (day != null) {
    const fx = await q(`SELECT id, home_id, away_id, home_goals, away_goals, report->'players' AS players FROM fixtures WHERE league_id=$1 AND day=$2 AND status='done'`, [leagueId, day]);
    for (const f of fx) for (const s of [0, 1] as const) {
      const c = byId.get(s ? f.away_id : f.home_id)!, o = byId.get(s ? f.home_id : f.away_id)!;
      const gf = s ? f.away_goals : f.home_goals, ga = s ? f.home_goals : f.away_goals;
      const ps = ((f.players || []) as any[]).filter((p) => p.side === s && p.mins > 30).sort((a, b) => b.r - a.r);
      const x = { score: `${gf}–${ga}`, opp: o.name, manager: mgr(c), player: ps[0]?.name?.split(' ').slice(-1)[0] ?? 'our keeper', next: 'Saturday' };
      const kind = gf - ga >= 3 ? 'bigWin' : gf > ga ? 'win' : gf === ga ? 'draw' : ga - gf >= 3 ? 'bigLoss' : 'loss';
      const mine = c.id === me.id;
      posts.push({ id: `r${f.id}${s}`, club: c.name, color: c.color1, handle: mkHandle(c, 1), text: fill(pick((FANS as any)[kind], f.id, s), x), likes: 40 + (hashSeed(f.id, s) % 900), mine });
      if (mine && ps[0] && ps[0].r >= 7.5) posts.push({ id: `s${f.id}`, club: c.name, color: c.color1, handle: mkHandle(c, 2), text: fill(pick(FANS.star, f.id, 'st'), { player: ps[0].name, rating: ps[0].r.toFixed(1) }), likes: 120 + (hashSeed(f.id, 'st') % 600), tag: 'Fan favourite', mine });
      const flop = ps[ps.length - 1];
      if (mine && flop && flop.r < 6.2) posts.push({ id: `f${f.id}`, club: c.name, color: c.color1, handle: mkHandle(c, 3), text: fill(pick(FANS.flop, f.id, 'fl'), { player: flop.name, rating: flop.r.toFixed(1) }), likes: 60 + (hashSeed(f.id, 'fl') % 300), mine });
      // the other side of a human clash rubs it in
      if (!mine && o.id === me.id && c.user_id && gf - ga >= 2) posts.push({ id: `x${f.id}`, club: c.name, color: c.color1, handle: mkHandle(c, 4), text: fill(pick(FANS.rival, f.id, 'rv'), { club: me.name, score: `${gf}–${ga}` }), likes: 300 + (hashSeed(f.id, 'rv') % 1200), mine: false });
    }
  }
  // what the fans want, from the numbers
  const want: { key: string; text: string; line?: string }[] = [];
  if (row && row.p >= 3 && row.gf / row.p < 1.15) { want.push({ key: 'striker', text: 'A new striker', line: 'FWD' }); posts.unshift({ id: 'w-st', club: me.name, color: me.color1, handle: mkHandle(me, 5), text: fill(FANS.striker[0], { g: row.gf, p: row.p }), likes: 412, tag: 'Fans want: a striker', mine: true }); }
  if (row && row.p >= 3 && row.ga / row.p > 1.6) { want.push({ key: 'defender', text: 'A new defender', line: 'DEF' }); posts.unshift({ id: 'w-df', club: me.name, color: me.color1, handle: mkHandle(me, 6), text: fill(FANS.defender[0], { ga: row.ga, p: row.p }), likes: 380, tag: 'Fans want: a defender', mine: true }); }
  if (form.slice(-1)[0] === 'L') want.push({ key: 'win', text: 'A win in the next match' });
  const reply = day != null ? await one(`SELECT choice FROM media_replies WHERE club_id=$1 AND day=$2`, [me.id, day]) : null;
  return {
    day, mood: mood(me, form), want, replied: reply?.choice ?? null,
    replyTo: posts.find((p) => p.mine && /OUT|BUY|please|pay|Who picked|money back|lost the/i.test(p.text)) || posts.find((p) => p.mine) || null,
    mine: posts.filter((p) => p.mine), league: posts.filter((p) => !p.mine).slice(0, 12),
  };
}

const REPLIES: Record<string, { text: string; board: number; morale: number; note: string }> = {
  calm: { text: '🤝 “We hear you. We will keep working.”', board: 1, morale: 0, note: 'Board +1' },
  promise: { text: '📝 “Reinforcements are coming.”', board: 4, morale: 0, note: 'Board +4 now. Sign a player for that line before the window shuts, or −8.' },
  cheeky: { text: '😏 “Trust the process.”', board: -1, morale: 2, note: 'Board −1, squad morale +2' },
};
export const replyOptions = () => Object.entries(REPLIES).map(([k, r]) => ({ key: k, text: r.text, note: r.note }));

export async function replyToFans(uid: number, leagueId: number, choice: string, line?: string) {
  const me = await myClub(uid, leagueId);
  const r = REPLIES[choice];
  if (!r) fail(400, 'Pick a reply.');
  const day = await lastDay(leagueId);
  if (day == null) fail(400, 'Nothing to reply to yet.');
  const ins = await q(`INSERT INTO media_replies (league_id, club_id, day, choice, line) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (club_id, day) DO NOTHING RETURNING id`, [leagueId, me.id, day, choice, choice === 'promise' ? line || 'FWD' : null]);
  if (!ins[0]) fail(400, 'You already answered the fans this matchday.');
  await q('UPDATE clubs SET board=LEAST(100, GREATEST(0, board+$2)) WHERE id=$1', [me.id, r.board]);
  if (r.morale) await q('UPDATE squad SET morale=LEAST(100, morale+$2) WHERE club_id=$1', [me.id, r.morale]);
  return { ok: true, note: r.note };
}

// a promise of a signing is judged once the window has shut: signed one for that line, or the fans remember
async function settlePromises(l: Row, me: Row) {
  const open = await q(`SELECT r.id, r.line, r.created_at FROM media_replies r WHERE r.club_id=$1 AND r.choice='promise' AND NOT r.settled`, [me.id]);
  if (!open.length) return;
  const { windowFor } = await import('./league.ts');
  const win = await windowFor(l);
  for (const p of open) {
    const signed = await one(`SELECT 1 FROM transfers t JOIN players pl ON pl.id=t.player_id WHERE t.to_club=$1 AND t.created_at > $2 AND (CASE WHEN pl.pos='GK' THEN 'GK' WHEN pl.pos IN ('CB','LB','RB','LWB','RWB') THEN 'DEF' WHEN pl.pos IN ('ST','CF','LW','RW') THEN 'FWD' ELSE 'MID' END)=$3`, [me.id, p.created_at, p.line]);
    if (signed) await q('UPDATE media_replies SET settled=true WHERE id=$1', [p.id]);
    else if (!win.open) { await q('UPDATE media_replies SET settled=true WHERE id=$1', [p.id]); await q('UPDATE clubs SET board=GREATEST(0, board-8) WHERE id=$1', [me.id]); }
  }
}
