// Chemistry: players who play together in the same part of the pitch understand each other better.
// Every pair of team-mates in the same line (keeper + defenders, midfielders, forwards) has a value
// from 0 to 100. It grows with every match they play together (league, cup or friendly); a win adds a
// little more, a defeat takes a little away. A new signing starts as a stranger.
// In a match each line's chemistry is worth from -2.5 (strangers) to +2.5 (a perfect understanding).
import { q, type Row } from './db.ts';
import { CHEM_START, chemGroup as group, lineChem, pairKey } from './game.ts';
export { lineChem, pairKey, CHEM_START };

export const CHEM_AI = 50; // AI clubs: neither help nor harm
export async function chemPairs(clubId: number) {
  const rows = await q<{ a: string; b: string; v: number }>('SELECT a, b, v FROM chemistry WHERE club_id=$1', [clubId]);
  return new Map(rows.map((r) => [`${r.a}|${r.b}`, Number(r.v)]));
}

/** what one match does to the chemistry of the players who took part */
export function chemAfterMatch(clubId: number, players: { id: string; pos: string; mins: number }[], result: 'W' | 'D' | 'L') {
  const played = players.filter((p) => p.mins > 0);
  // a full season together takes a pair from 50 to about 90: chemistry is earned, not handed out
  const bonus = result === 'W' ? 1 : result === 'D' ? 0.3 : -1;
  const rows: { a: string; b: string; g: number }[] = [];
  for (let i = 0; i < played.length; i++) for (let j = i + 1; j < played.length; j++) {
    const x = played[i], y = played[j];
    if (group(x.pos) !== group(y.pos)) continue;
    const [a, b] = x.id < y.id ? [x.id, y.id] : [y.id, x.id];
    rows.push({ a, b, g: Math.round((2.5 * Math.min(x.mins, y.mins, 90) / 90 + bonus) * 10) / 10 });
  }
  if (!rows.length) return null;
  return {
    text: `INSERT INTO chemistry (club_id, a, b, v) SELECT $1, x.a, x.b, LEAST(100, GREATEST(0, ${CHEM_START} + x.g)) FROM jsonb_to_recordset($2::jsonb) AS x(a text, b text, g real)
           ON CONFLICT (club_id, a, b) DO UPDATE SET v = LEAST(100, GREATEST(0, chemistry.v + (EXCLUDED.v - ${CHEM_START})))`,
    params: [clubId, JSON.stringify(rows)],
  };
}

export const chemOf = (r: Row) => r as { DEF: number; MID: number; FWD: number };
