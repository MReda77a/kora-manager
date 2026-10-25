// Creates the tables and loads the players into DATABASE_URL (or the local database). Safe to run again.
export {};
const { ensureSeeded } = await import('../lib/seed.ts');
const { q } = await import('../lib/db.ts');
await ensureSeeded();
const rows = await q(`SELECT pool, COUNT(*)::int AS n FROM players GROUP BY pool ORDER BY pool`);
console.log('Players per league pool:', Object.fromEntries(rows.map((r) => [r.pool, r.n])));
process.exit(0);
