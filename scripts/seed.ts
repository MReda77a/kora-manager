// Creates the tables and loads the players into the database in DATABASE_URL (run once after setup).
export {};
const { q } = await import('../lib/db.ts');
const rows = await q(`SELECT pool, COUNT(*)::int AS n FROM players GROUP BY pool ORDER BY pool`);
console.log('Players per league pool:', Object.fromEntries(rows.map((r) => [r.pool, r.n])));
process.exit(0);
