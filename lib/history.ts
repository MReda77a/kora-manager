// The transfer history of a league: every deal, whoever made it. Each transfer path adds one row
// (as a statement, so it can ride along in the same database request as the deal itself).
export type TransferRow = {
  league: number; player: string; name: string;
  from: number | null; fromName: string; to: number | null; toName: string;
  fee: number; kind: 'buy' | 'loan' | 'swap' | 'abroad' | 'sold abroad';
};
export function transferStmt(x: TransferRow) {
  return {
    text: `INSERT INTO transfers (league_id, season, day, player_id, player_name, from_club, from_name, to_club, to_name, fee, kind)
           VALUES ($1, (SELECT season FROM leagues WHERE id=$1), (SELECT COALESCE(MAX(day), 0) FROM days WHERE league_id=$1 AND processed), $2,$3,$4,$5,$6,$7,$8,$9)`,
    params: [x.league, x.player, x.name, x.from, x.fromName, x.to, x.toName, Math.round(x.fee * 100) / 100, x.kind] as unknown[],
  };
}
