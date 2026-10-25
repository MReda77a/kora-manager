// Plays every due match from your computer or a CI job (no CPU limit). Usage: npm run run:matches
export {};
const { runDue } = await import('../lib/league.ts');
const r = await runDue(undefined, { max: 10000 });
console.log(r);
process.exit(0);
