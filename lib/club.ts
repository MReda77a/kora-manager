// Club life between matches: staff, training, condition, office (board, sponsor, fans, stadium)
// and the managers' comments for the matchday paper.
import { q, one, type Row } from './db.ts';
import { fail } from './errors.ts';
import { CLUB_TYPES, PAPER_NAMES, POSITIONS, SPONSORS, STAFF_ROLES, TRAINABLE, type ClubTypeKey, type SponsorKey } from './game.ts';
import { getLeague, myClub, news, squadOf, standings } from './league.ts';
import { inboxOf } from './people.ts';
import { movers } from './career.ts';

export async function staffLevels(clubId: number) {
  const rows = await q('SELECT role, MAX(level)::int AS lvl FROM staff WHERE club_id=$1 GROUP BY role', [clubId]);
  const m: Record<string, number> = { doctor: 0, physio: 0, coach: 0 };
  for (const r of rows) m[r.role] = r.lvl;
  return m as { doctor: number; physio: number; coach: number };
}

export async function staffList(clubId: number) {
  const rows = await q('SELECT * FROM staff WHERE club_id=$1 ORDER BY level DESC, id', [clubId]);
  return rows.map((s) => ({ ...s, title: STAFF_ROLES[s.role]?.name ?? s.role, effect: STAFF_ROLES[s.role]?.effect(s.level) ?? '' }));
}

// The day number of this club's next match (or the next league day).
export async function nextDay(leagueId: number, clubId?: number) {
  const r = await one<{ d: number }>(
    clubId
      ? `SELECT MIN(day)::int AS d FROM fixtures WHERE league_id=$1 AND status='scheduled' AND (home_id=$2 OR away_id=$2)`
      : `SELECT MIN(day)::int AS d FROM days WHERE league_id=$1 AND processed=false`,
    clubId ? [leagueId, clubId] : [leagueId],
  );
  return r?.d ?? 1;
}

// ---------------------------------------------------------------- training
export async function applyTrainings(leagueId: number) {
  const due = await q(`UPDATE training SET done=true WHERE league_id=$1 AND done=false AND ends_at <= now() RETURNING *`, [leagueId]);
  for (const t of due) {
    if (t.kind === 'pos') {
      await q('UPDATE squad SET pos_override=$3 WHERE league_id=$1 AND player_id=$2', [leagueId, t.player_id, t.target]);
    } else {
      await q(
        `UPDATE squad SET boost = jsonb_set(boost, ARRAY[$3::text], to_jsonb(COALESCE((boost->>$3)::int, 0) + $4)) WHERE league_id=$1 AND player_id=$2`,
        [leagueId, t.player_id, t.target, t.amount],
      );
    }
  }
  return due.length;
}

export async function trainingView(uid: number, leagueId: number) {
  await applyTrainings(leagueId);
  const club = await myClub(uid, leagueId);
  const lv = await staffLevels(club.id);
  const active = await q('SELECT * FROM training WHERE club_id=$1 AND done=false ORDER BY ends_at', [club.id]);
  const recent = await q('SELECT * FROM training WHERE club_id=$1 AND done=true ORDER BY ends_at DESC LIMIT 8', [club.id]);
  const players = await squadOf(club.id, await nextDay(leagueId, club.id));
  return {
    slots: lv.coach >= 4 ? 3 : 2, coach: lv.coach, active, recent,
    players: players.map((p) => ({ id: p.id, name: p.name, pos: p.pos, natPos: p.nat_pos, ovr: p.ovr, age: p.age, pot: p.pot, attrs: p.attrs, boost: p.boost || {} })),
    trainable: TRAINABLE, positions: POSITIONS,
  };
}

// One player trains one thing: +2 to a skill (about a day) or a new position (about 3 days).
export async function startTraining(uid: number, leagueId: number, b: { playerId: string; kind: 'attr' | 'pos'; target: string }) {
  const club = await myClub(uid, leagueId);
  const lv = await staffLevels(club.id);
  const p = await one('SELECT s.*, p.attrs, p.pos AS base_pos, p.pot, p.ovr FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 AND s.player_id=$2', [club.id, String(b.playerId)]);
  if (!p) fail(400, 'That player is not in your squad.');
  const active = await q('SELECT * FROM training WHERE club_id=$1 AND done=false', [club.id]);
  if (active.some((t) => t.player_id === p.player_id)) fail(400, 'He is already training.');
  if (active.length >= (lv.coach >= 4 ? 3 : 2)) fail(400, 'All training slots are busy. A 4-star coach adds a third slot.');
  const speed = 1 - lv.coach * 0.1;
  let hours: number, amount = 0;
  if (b.kind === 'pos') {
    if (!POSITIONS.includes(b.target)) fail(400, 'Pick a position.');
    if ((p.pos_override || p.base_pos) === b.target) fail(400, 'He already plays there.');
    if ((b.target === 'GK') !== (p.base_pos === 'GK')) fail(400, 'Keepers and outfield players cannot swap.');
    hours = 72 * speed;
  } else {
    if (!TRAINABLE.includes(b.target)) fail(400, 'Pick a skill.');
    const cur = (p.attrs[b.target] ?? 50) + ((p.boost || {})[b.target] ?? 0);
    if (((p.boost || {})[b.target] ?? 0) >= 10) fail(400, 'He has reached his limit in this skill this season.');
    if (cur >= 95) fail(400, 'Already world class at this.');
    amount = cur < 70 ? 3 : 2;
    hours = 24 * speed;
  }
  const [t] = await q(
    `INSERT INTO training (league_id, club_id, player_id, kind, target, amount, ends_at) VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(mins => $7)) RETURNING *`,
    [leagueId, club.id, p.player_id, b.kind === 'pos' ? 'pos' : 'attr', b.target, amount, Math.round(hours * 60)],
  );
  return t;
}

export async function cancelTraining(uid: number, leagueId: number, id: number) {
  const club = await myClub(uid, leagueId);
  await q('DELETE FROM training WHERE id=$1 AND club_id=$2 AND done=false', [id, club.id]);
  return { ok: true };
}

// ---------------------------------------------------------------- condition
export async function conditionView(uid: number, leagueId: number) {
  const club = await myClub(uid, leagueId);
  const day = await nextDay(leagueId, club.id);
  const lv = await staffLevels(club.id);
  const prev = await one<{ d: number }>(`SELECT MAX(day)::int AS d FROM fixtures WHERE (home_id=$1 OR away_id=$1) AND status='done'`, [club.id]);
  const gap = prev?.d ? Math.max(1, day - prev.d) : 3;
  const players = await squadOf(club.id, day);
  const next = await one(
    `SELECT f.*, h.name AS home, a.name AS away FROM fixtures f JOIN clubs h ON h.id=f.home_id JOIN clubs a ON a.id=f.away_id
     WHERE f.league_id=$1 AND f.status='scheduled' AND (f.home_id=$2 OR f.away_id=$2) ORDER BY f.day LIMIT 1`,
    [leagueId, club.id],
  );
  return {
    day, staff: await staffList(club.id), levels: lv,
    recoveryPerDay: 25 + lv.physio * 3,
    next: next ? { id: next.id, opponent: next.home_id === club.id ? next.away : next.home, home: next.home_id === club.id, kickoff: next.kickoff_at, comp: next.comp } : null,
    players: players.map((p) => ({
      id: p.id, name: p.name, pos: p.pos, ovr: p.ovr, fitness: Math.round(p.fitness), expected: Math.min(100, Math.round(p.fitness + gap * (25 + lv.physio * 3))),
      out: (p.out_until ?? 0) >= day ? { reason: p.out_reason, days: p.out_until - day + 1 } : null,
      form: p.form, formNote: p.form ? p.form_note : null, injuryProne: p.attrs.InjuryProne ?? 30,
    })),
  };
}

// ---------------------------------------------------------------- office
export async function officeView(uid: number, leagueId: number) {
  const l = await getLeague(leagueId);
  const club = await myClub(uid, leagueId);
  const t = CLUB_TYPES[club.club_type as ClubTypeKey];
  const table = l.status === 'setup' ? [] : await standings(leagueId, club.division || 1);
  const n = table.length || l.max_clubs;
  const pos = table.findIndex((x) => x.id === club.id) + 1;
  const me = table.find((x) => x.id === club.id);
  // outside the top flight every board wants promotion
  const lower = (club.division || 1) > 1;
  const target = lower ? movers(l.max_clubs) : t.targetPos(n);
  const objectives: { area: string; text: string; progress: number; note: string; status: string }[] = [];
  const posProgress = pos ? Math.max(0, Math.min(1, (n - pos + 1) / (n - target + 1))) : 0;
  objectives.push({ area: 'Board', text: lower ? `Win promotion (top ${target})` : t.board, progress: posProgress, note: pos ? `Now ${pos}${pos === 1 ? 'st' : pos === 2 ? 'nd' : pos === 3 ? 'rd' : 'th'} · target top ${target}` : 'Season not started', status: !pos ? 'WAITING' : pos <= target ? 'ON TRACK' : pos <= target + 2 ? 'AT RISK' : 'BEHIND' });
  const cup = await one(`SELECT data FROM papers WHERE league_id=$1 AND day=0 AND kind='cup'`, [leagueId]);
  if (club.club_type === 'fan' || club.club_type === 'invest' || club.club_type === 'historic') {
    const out = await one(`SELECT 1 FROM fixtures WHERE league_id=$1 AND comp='cup' AND status='done' AND (home_id=$2 OR away_id=$2) AND winner_id<>$2`, [leagueId, club.id]);
    const won = cup?.data?.winner === club.id;
    objectives.push({ area: 'Board', text: club.club_type === 'historic' ? 'Reach the cup semi-final' : 'Win the cup', progress: won ? 1 : out ? 0 : 0.5, note: won ? 'Winners!' : out ? 'Knocked out' : 'Still in it', status: won ? 'DONE' : out ? 'FAILED' : 'ON TRACK' });
  }
  let sponsorProgress = 0.5, sponsorNote = '';
  if (club.club_type === 'fan') { sponsorProgress = Math.min(1, club.fans / club.capacity); sponsorNote = `${Math.round(sponsorProgress * 100)}% of ${club.capacity.toLocaleString()} seats`; }
  else if (club.club_type === 'commercial') { const gpg = me && me.p ? me.gf / me.p : 0; sponsorProgress = Math.min(1, gpg / 1.5); sponsorNote = `${gpg.toFixed(2)} goals a game · target 1.5`; }
  else if (club.club_type === 'academy') { sponsorProgress = Math.min(1, Number(club.sales) / 10); sponsorNote = `${Number(club.sales).toFixed(1)}M from sales`; }
  else if (club.club_type === 'invest') { const star = await one(`SELECT 1 FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 AND p.ovr>=90`, [club.id]); sponsorProgress = star ? 1 : 0; sponsorNote = star ? 'You have a 90+ star' : 'No 90+ player yet'; }
  else { sponsorNote = 'Cup run counts'; }
  objectives.push({ area: 'Sponsors', text: t.sponsor, progress: sponsorProgress, note: sponsorNote, status: sponsorProgress >= 0.9 ? 'ON TRACK' : sponsorProgress >= 0.6 ? 'AT RISK' : 'BEHIND' });
  objectives.push({ area: 'Squad', text: t.squad, progress: 0.7, note: 'Judged at the end of the season', status: 'ON TRACK' });
  const played = me?.p || 0;
  const left = Math.max(0, (n - 1) * 2 - played);
  const winRate = played ? me!.w / played : 0.45;
  const goals = played ? me!.gf / played : 1.4;
  const est = (k: SponsorKey) => {
    const s = SPONSORS[k];
    const drawRate = played ? me!.d / played : 0.25;
    return Math.round((s.win * winRate * left + s.draw * drawRate * left + s.perGoal * goals * (winRate + drawRate) * left + (k === 'target' && pos && pos <= target ? s.bonus : 0)) * 10) / 10;
  };
  return {
    inbox: await inboxOf(leagueId, club.id),
    kit: { color1: club.color1, color2: club.color2, away1: club.away1 || '#F3EEFF', away2: club.away2 || club.color1, pattern: club.pattern || 0 },
    division: club.division || 1,
    club: { id: club.id, name: club.name, type: club.club_type, typeName: t.name, stadium: club.stadium, capacity: club.capacity, fans: club.fans, board: club.board, money: Number(club.money), sponsor: club.sponsor },
    perk: t.perk, weak: t.weak, objectives,
    sponsors: (Object.keys(SPONSORS) as SponsorKey[]).map((k) => ({ key: k, ...SPONSORS[k], estimate: est(k) })),
    canChooseSponsor: !club.sponsor,
    attendance: Math.min(club.capacity, club.fans), gate: Math.round(Math.min(club.capacity, club.fans) * 0.00002 * 100) / 100,
    grade: club.board >= 75 ? 'A' : club.board >= 60 ? 'B' : club.board >= 45 ? 'C' : club.board >= 30 ? 'D' : 'F',
  };
}

export async function chooseSponsor(uid: number, leagueId: number, key: string) {
  const club = await myClub(uid, leagueId);
  if (!(key in SPONSORS)) fail(400, 'Unknown sponsor deal.');
  const r = await q('UPDATE clubs SET sponsor=$2 WHERE id=$1 AND sponsor IS NULL RETURNING id', [club.id, key]);
  if (!r[0]) fail(400, 'You already signed a sponsor this season.');
  await news(leagueId, club.id, 'sponsor', `${club.name} sign the ${SPONSORS[key as SponsorKey].name} sponsor deal.`);
  return { ok: true };
}

export async function renameStadium(uid: number, leagueId: number, name: string) {
  const club = await myClub(uid, leagueId);
  const n = String(name || '').trim().slice(0, 32);
  if (n.length < 3) fail(400, 'Stadium name needs at least 3 letters.');
  await q('UPDATE clubs SET stadium=$2 WHERE id=$1', [club.id, n]);
  return { ok: true };
}

export async function expandStadium(uid: number, leagueId: number) {
  const club = await myClub(uid, leagueId);
  const r = await q('UPDATE clubs SET money=money-6, capacity=capacity+5000 WHERE id=$1 AND money>=6 AND capacity<80000 RETURNING capacity', [club.id]);
  if (!r[0]) fail(400, 'Expansion costs 6M (max 80,000 seats).');
  await news(leagueId, club.id, 'stadium', `${club.name} expand ${club.stadium} to ${r[0].capacity.toLocaleString()} seats.`);
  return { ok: true, capacity: r[0].capacity };
}

// ---------------------------------------------------------------- the paper
export async function postComment(uid: number, leagueId: number, b: { text: string; tone?: string }) {
  const club = await myClub(uid, leagueId);
  const text = String(b.text || '').trim().slice(0, 160);
  if (text.length < 2) fail(400, 'Write something first.');
  const next = await one(`SELECT id, day FROM fixtures WHERE league_id=$1 AND status='scheduled' AND (home_id=$2 OR away_id=$2) ORDER BY day LIMIT 1`, [leagueId, club.id]);
  if (!next) fail(400, 'No upcoming match to talk about.');
  const tone = ['calm', 'confident', 'provocative'].includes(String(b.tone)) ? String(b.tone) : null;
  await q('DELETE FROM comments WHERE club_id=$1 AND day=$2', [club.id, next.day]);
  await q('INSERT INTO comments (league_id, club_id, fixture_id, day, tone, text) VALUES ($1,$2,$3,$4,$5,$6)', [leagueId, club.id, next.id, next.day, tone, text]);
  return { ok: true };
}

export async function paperView(leagueId: number, uid: number) {
  const l = await getLeague(leagueId);
  const editions = await q(`SELECT day, data FROM papers WHERE league_id=$1 AND kind='paper' ORDER BY day DESC LIMIT 20`, [leagueId]);
  const nd = await one(`SELECT * FROM days WHERE league_id=$1 AND processed=false ORDER BY day LIMIT 1`, [leagueId]);
  let preview: Row | null = null;
  if (nd) {
    const fx = await q(
      `SELECT f.id, f.status, h.name AS home, a.name AS away, h.id AS hid, a.id AS aid, h.club_type AS ht, a.club_type AS at, h.user_id AS hu, a.user_id AS au
       FROM fixtures f JOIN clubs h ON h.id=f.home_id JOIN clubs a ON a.id=f.away_id WHERE f.league_id=$1 AND f.day=$2`,
      [leagueId, nd.day],
    );
    const comments = await q(
      `SELECT c.text, c.tone, cl.name AS club, cl.color1, u.username, cl.user_id=$3 AS mine FROM comments c JOIN clubs cl ON cl.id=c.club_id LEFT JOIN users u ON u.id=cl.user_id
       WHERE c.league_id=$1 AND c.day=$2 ORDER BY c.created_at`,
      [leagueId, nd.day, uid],
    );
    preview = {
      day: nd.day, kind: nd.kind, matchday: nd.matchday, kickoff: nd.kickoff_at,
      fixtures: fx.map((f) => ({ id: f.id, home: f.home, away: f.away, derby: f.ht === 'fan' && f.at === 'fan' && !!f.hu && !!f.au })),
      comments,
    };
  }
  const potm = await q(`SELECT day, data FROM papers WHERE league_id=$1 AND kind='potm' ORDER BY day DESC LIMIT 3`, [leagueId]);
  return { name: PAPER_NAMES[l.pool] || editions[0]?.data?.name, pool: l.pool, editions: editions.map((e) => e.data), preview, potm: potm.map((p) => ({ day: p.day, ...p.data })) };
}

export { news };
