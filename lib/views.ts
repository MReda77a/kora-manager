// Read-only screens about the whole league: the transfer history, and any club's squad.
import { q, one } from './db.ts';
import { fail } from './errors.ts';
import { CLUB_TYPES, LINE, leadership, type ClubTypeKey } from './game.ts';
import { getLeague, pub, squadOf, standings } from './league.ts';
import { nextDay } from './club.ts';

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
