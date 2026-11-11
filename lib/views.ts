// Read-only screens about the whole league: the transfer history, and any club's squad.
import { q, one, type Row } from './db.ts';
import { fail } from './errors.ts';
import { CLUB_TYPES, LINE, leadership, type ClubTypeKey } from './game.ts';
import { applyMods, getLeague, pub, squadOf, standings } from './league.ts';
import { nextDay } from './club.ts';
import { movers } from './career.ts';

export async function transfersView(leagueId: number) {
  const rows = await q(
    `SELECT t.id, t.season, t.day, t.player_id, t.player_name, t.from_club, t.from_name, t.to_club, t.to_name, t.fee, t.kind, t.created_at,
       fc.color1 AS from_color, fc.user_id IS NOT NULL AS from_human, tc.color1 AS to_color, tc.user_id IS NOT NULL AS to_human,
       p.pos, p.ovr
     FROM transfers t LEFT JOIN clubs fc ON fc.id=t.from_club LEFT JOIN clubs tc ON tc.id=t.to_club LEFT JOIN players p ON p.id=t.player_id
     WHERE t.league_id=$1 ORDER BY t.id DESC LIMIT 300`,
    [leagueId],
  );
  // deals made before the history was kept: their news lines
  const older = await q(
    `SELECT text, created_at FROM news WHERE league_id=$1 AND kind='transfer'
       AND created_at < COALESCE((SELECT MIN(created_at) FROM transfers WHERE league_id=$1) - interval '1 minute', now() + interval '1 day')
     ORDER BY id DESC LIMIT 100`,
    [leagueId],
  );
  return {
    rows: rows.map((r) => ({
      id: r.id, season: r.season, day: r.day, player: { id: r.player_id, name: r.player_name, pos: r.pos, ovr: r.ovr },
      from: { id: r.from_club, name: r.from_name, color: r.from_color, human: !!r.from_human },
      to: { id: r.to_club, name: r.to_name, color: r.to_color, human: !!r.to_human },
      fee: Number(r.fee), kind: r.kind, at: r.created_at,
    })),
    older: older.map((o) => ({ text: o.text, at: o.created_at })),
  };
}

export async function clubView(leagueId: number, clubId: number) {
  const l = await getLeague(leagueId);
  const c = await one('SELECT * FROM clubs WHERE id=$1 AND league_id=$2', [clubId, leagueId]);
  if (!c) fail(404, 'Club not found.');
  const day = l.status === 'running' ? await nextDay(leagueId, c!.id) : 0;
  const [players, stats, listed, mgr, table] = await Promise.all([
    squadOf(c!.id, day),
    q('SELECT player_id, apps, goals, assists, rating_sum FROM pstats WHERE league_id=$1 AND club_id=$2', [leagueId, c!.id]),
    q('SELECT player_id, price FROM listings WHERE seller_id=$1', [c!.id]),
    c!.user_id ? one('SELECT username FROM users WHERE id=$1', [c!.user_id]) : Promise.resolve(null),
    l.status === 'setup' ? Promise.resolve([]) : standings(leagueId, c!.division || 1),
  ]);
  const st = new Map(stats.map((x) => [x.player_id, x]));
  const li = new Map(listed.map((x) => [x.player_id, Number(x.price)]));
  const line = (pos: string) => (pos === 'GK' ? 'GK' : LINE[pos] || 'MID');
  const list = players.map((p) => {
    const s = st.get(p.id);
    return {
      ...pub(p), line: line(p.pos), v: Number(p.attrs?.v) || 0, injured: p.out_until >= day && day > 0 ? p.out_reason || 'Out' : null,
      apps: s?.apps || 0, goals: s?.goals || 0, assists: s?.assists || 0, rating: s?.apps ? Math.round((Number(s.rating_sum) / s.apps) * 10) / 10 : null,
      listed: li.get(p.id) ?? null, captain: c!.captain === p.id, lead: leadership(p),
    };
  }).sort((a, b) => b.ovr - a.ovr);
  const best11 = list.slice(0, 11);
  const pos = table.findIndex((r: any) => r.id === c!.id);
  return {
    club: {
      id: c!.id, name: c!.name, short: c!.short, color1: c!.color1, color2: c!.color2, shape: c!.shape, emblem: c!.emblem,
      type: CLUB_TYPES[c!.club_type as ClubTypeKey]?.name || c!.club_type, human: !!c!.user_id, manager: mgr?.username || null,
      stadium: c!.stadium, fans: c!.fans, division: c!.division || 1,
      pos: pos >= 0 ? pos + 1 : null, row: pos >= 0 ? table[pos] : null,
    },
    strength: best11.length ? Math.round(best11.reduce((a, p) => a + p.ovr, 0) / best11.length) : 0,
    value: Math.round(list.reduce((a, p) => a + p.v, 0) * 10) / 10,
    players: list,
  };
}

/** every manager in the league: most goals first, with their club, place and when they last opened the game */
export async function managersView(leagueId: number) {
  const l = await one('SELECT divisions, max_clubs FROM leagues WHERE id=$1', [leagueId]);
  const types = new Map((await q('SELECT id, club_type, board FROM clubs WHERE league_id=$1 AND user_id IS NOT NULL', [leagueId])).map((c) => [c.id, c]));
  const rows: any[] = [];
  for (let div = 1; div <= (l?.divisions || 1); div++) {
    const table = await standings(leagueId, div);
    table.forEach((t: any, i: number) => {
      if (!t.user_id) return;
      const c = types.get(t.id);
      // the board's target: a place for the club type in the top flight, promotion below it
      const target = div > 1 ? movers(l?.max_clubs || table.length) : CLUB_TYPES[(c?.club_type || 'fan') as ClubTypeKey].targetPos(table.length);
      const pos = i + 1;
      const status = !t.p ? 'WAITING' : pos <= target ? 'ON TRACK' : pos <= target + 2 ? 'AT RISK' : 'BEHIND';
      rows.push({ clubId: t.id, club: t.name, short: t.short, color1: t.color1, color2: t.color2, shape: t.shape, emblem: t.emblem, uid: t.user_id, division: div, pos, p: t.p, w: t.w, d: t.d, l: t.l, gf: t.gf, ga: t.ga, pts: t.pts, form: t.form,
        target, gap: target - pos, status, board: c?.board ?? 60, type: CLUB_TYPES[(c?.club_type || 'fan') as ClubTypeKey].name });
    });
  }
  const users = await q('SELECT id, username, last_seen FROM users WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::int)', [JSON.stringify(rows.map((r) => r.uid))]);
  const by = new Map(users.map((u) => [u.id, u]));
  // ranked by how well each manager meets his board's target (places ahead of it), then board confidence
  return rows.map((r) => ({ ...r, manager: by.get(r.uid)?.username ?? '?', lastSeen: by.get(r.uid)?.last_seen ?? null }))
    .sort((a, b) => b.gap - a.gap || b.board - a.board || b.pts - a.pts);
}

/** The lasting record, for one manager: his head-to-head with every club he has met (all seasons),
 *  and what happened in this league when each style met each other style. A record of what was, not a
 *  forecast: it fills up as the league is played. */
export async function recordsView(uid: number, leagueId: number) {
  const me = await one('SELECT id FROM clubs WHERE league_id=$1 AND user_id=$2', [leagueId, uid]);
  const rows = await q(`SELECT m.home_id, m.away_id, m.home_goals, m.away_goals, m.winner_id, m.home_style, m.away_style, m.season, m.comp
    FROM meetings m WHERE m.league_id=$1 ORDER BY m.played_at DESC, m.fixture_id DESC`, [leagueId]);
  const clubs = new Map((await q(`SELECT c.id, c.name, c.short, c.color1, c.color2, c.shape, c.emblem, u.username FROM clubs c LEFT JOIN users u ON u.id=c.user_id WHERE c.league_id=$1`, [leagueId])).map((c) => [c.id, c]));
  // head-to-head
  const h2h = new Map<number, any>();
  // style against style, from the first style's side
  const styles: Record<string, Record<string, { p: number; w: number; d: number; l: number }>> = {};
  const mine: Record<string, Record<string, { p: number; w: number; d: number; l: number }>> = {};
  const add = (t: typeof styles, a: string, b: string, res: 'w' | 'd' | 'l') => { const c = ((t[a] ||= {})[b] ||= { p: 0, w: 0, d: 0, l: 0 }); c.p++; c[res]++; };
  for (const m of rows) {
    // a cup tie settled on penalties counts as the draw it was on the pitch
    const res = (home: boolean): 'w' | 'd' | 'l' => (m.home_goals === m.away_goals ? 'd' : (m.home_goals > m.away_goals) === home ? 'w' : 'l');
    if (m.home_style && m.away_style) {
      add(styles, m.home_style, m.away_style, res(true));
      add(styles, m.away_style, m.home_style, res(false)); // (the same style on both sides counts from each side: wins and defeats level)
    }
    if (!me || (m.home_id !== me.id && m.away_id !== me.id)) continue;
    const home = m.home_id === me.id, oppId = home ? m.away_id : m.home_id, c = clubs.get(oppId);
    if (!c) continue;
    const r = res(home);
    if (m.home_style && m.away_style) add(mine, home ? m.home_style : m.away_style, home ? m.away_style : m.home_style, r);
    const e = h2h.get(oppId) || { clubId: oppId, club: c.name, short: c.short, color1: c.color1, color2: c.color2, shape: c.shape, emblem: c.emblem, manager: c.username || null, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, last: [] as any[] };
    e.p++; e[r]++; e.gf += home ? m.home_goals : m.away_goals; e.ga += home ? m.away_goals : m.home_goals;
    if (e.last.length < 5) e.last.push({ res: r.toUpperCase(), score: `${home ? m.home_goals : m.away_goals}–${home ? m.away_goals : m.home_goals}`, season: m.season, cup: m.comp === 'cup', mine: home ? m.home_style : m.away_style, theirs: home ? m.away_style : m.home_style });
    h2h.set(oppId, e);
  }
  return { h2h: [...h2h.values()].sort((a, b) => (b.manager ? 1 : 0) - (a.manager ? 1 : 0) || b.p - a.p), styles, mine, matches: rows.length };
}

// ---------------------------------------------------------------- the team profile
// What the first eleven is made of, measure by measure, against the other clubs in the division.
// Each measure is one the match engine really uses, so a weak one here is a weakness on the pitch.
const PROFILE: { key: string; name: string; line: string[]; attrs: string[]; weak: string; strong: string }[] = [
  { key: 'airDef', name: 'In the air at the back', line: ['DEF'], attrs: ['Heading', 'Jumping', 'Strength'], weak: 'Crosses and corners will hurt you: teams that see this play wide and cross.', strong: 'Crosses and corners rarely beat you.' },
  { key: 'paceDef', name: 'Pace at the back', line: ['DEF'], attrs: ['Pace'], weak: 'A high line is a risk: quick forwards get in behind on through balls and counters.', strong: 'You can hold a high line: your defenders catch the runners.' },
  { key: 'tackling', name: 'Winning the ball', line: ['DEF', 'MID'], attrs: ['Tackling', 'Marking'], weak: 'Passing sides play through your midfield.', strong: 'Passing sides struggle to play through you.' },
  { key: 'keeper', name: 'Goalkeeper', line: ['GK'], attrs: ['Reflexes', 'Handling'], weak: 'Shots from distance are worth more against you: expect teams to shoot on sight.', strong: 'Shooting from distance against you is a waste.' },
  { key: 'passing', name: 'Passing', line: ['MID'], attrs: ['Passing', 'Vision'], weak: 'Patient build-up will break down: play more direct.', strong: 'You can keep the ball and pass through a press.' },
  { key: 'paceAtt', name: 'Pace up front', line: ['FWD'], attrs: ['Pace'], weak: 'Through balls and counter-attacks will not get you far.', strong: 'Through balls and counters suit you, above all against a high line.' },
  { key: 'airAtt', name: 'In the air up front', line: ['FWD'], attrs: ['Heading', 'Jumping', 'Strength'], weak: 'Crossing is not your game: your forwards lose the headers.', strong: 'Wing play and crosses suit you: your forwards win headers.' },
  { key: 'finishing', name: 'Finishing', line: ['FWD'], attrs: ['Finishing', 'Composure'], weak: 'You need more chances than most to score.', strong: 'Your forwards make the most of their chances.' },
  { key: 'longShots', name: 'Shooting from distance', line: ['MID', 'FWD'], attrs: ['LongShots'], weak: 'Shoot on sight is a waste with these players.', strong: 'Shoot on sight is a real weapon, above all against a deep block.' },
  { key: 'stamina', name: 'Stamina', line: ['DEF', 'MID', 'FWD'], attrs: ['Stamina'], weak: 'Pressing and a fast tempo will empty your legs before the end.', strong: 'You can press and play fast for ninety minutes.' },
];

export async function profileView(uid: number, leagueId: number) {
  const me = await one('SELECT id, division FROM clubs WHERE league_id=$1 AND user_id=$2', [leagueId, uid]);
  if (!me) return null;
  const clubs = await q('SELECT id, name, lineup, user_id FROM clubs WHERE league_id=$1 AND COALESCE(division, 1)=$2', [leagueId, me.division || 1]);
  const rows = await q(`SELECT s.club_id, p.id, p.name, p.pos, p.ovr, p.pot, p.attrs, s.pos_override, s.ovr_delta, s.boost, s.out_until
    FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id IN (SELECT jsonb_array_elements_text($1::jsonb)::int)`, [JSON.stringify(clubs.map((c) => c.id))]);
  const by = new Map<number, Row[]>();
  for (const r of rows) { const p = applyMods(r, 0); (by.get(r.club_id) || by.set(r.club_id, []).get(r.club_id)!).push(p); }
  // the eleven a club puts out: its saved line-up, or its best men by line
  const eleven = (c: Row) => {
    const all = by.get(c.id) || [];
    const saved = (Array.isArray(c.lineup) ? c.lineup : []).map((id: string) => all.find((p) => p.id === id)).filter(Boolean) as Row[];
    if (saved.length >= 10) return saved;
    const best = [...all].sort((a, b) => b.ovr - a.ovr), xi: Row[] = [];
    for (const [line, n] of [['GK', 1], ['DEF', 4], ['MID', 3], ['FWD', 3]] as const) xi.push(...best.filter((p) => (LINE[p.pos] || 'MID') === line).slice(0, n));
    return xi;
  };
  const measure = (xi: Row[], m: (typeof PROFILE)[number]) => {
    const ps = xi.filter((p) => m.line.includes(LINE[p.pos] || 'MID'));
    if (!ps.length) return null;
    return ps.reduce((s, p) => s + m.attrs.reduce((k, a) => k + (Number(p.attrs?.[a]) || 50), 0) / m.attrs.length, 0) / ps.length;
  };
  const xis = clubs.map((c) => ({ c, xi: eleven(c) }));
  const mine = xis.find((x) => x.c.id === me.id)!;
  const out = PROFILE.map((m) => {
    const vals = xis.map((x) => ({ id: x.c.id, v: measure(x.xi, m) })).filter((x) => x.v !== null) as { id: number; v: number }[];
    const my = vals.find((x) => x.id === me.id)?.v ?? null;
    if (my === null) return null;
    const avg = vals.reduce((a, x) => a + x.v, 0) / vals.length;
    const rank = vals.filter((x) => x.v > my + 1e-9).length + 1;
    const diff = my - avg;
    // who drags it down or carries it: the lowest and highest man on this measure
    const ps = mine.xi.filter((p) => m.line.includes(LINE[p.pos] || 'MID')).map((p) => ({ name: p.name, v: Math.round(m.attrs.reduce((k, a) => k + (Number(p.attrs?.[a]) || 50), 0) / m.attrs.length) })).sort((a, b) => a.v - b.v);
    return { key: m.key, name: m.name, mine: Math.round(my), avg: Math.round(avg), diff: Math.round(diff * 10) / 10, rank, of: vals.length,
      tone: diff <= -3 ? 'weak' : diff >= 3 ? 'strong' : 'level', note: diff <= -3 ? m.weak : diff >= 3 ? m.strong : null, low: ps[0] || null, high: ps[ps.length - 1] || null };
  }).filter(Boolean) as any[];
  return { measures: out, weak: out.filter((x) => x.tone === 'weak').sort((a, b) => a.diff - b.diff), strong: out.filter((x) => x.tone === 'strong').sort((a, b) => b.diff - a.diff), clubs: xis.length };
}
