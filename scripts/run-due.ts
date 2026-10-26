// Plays every due match from your computer or a CI job (no CPU limit). Usage: npm run run:matches
export {};
const { runDue } = await import('../lib/season.ts');
console.log(await runDue(undefined, { max: 10000 }));
process.exit(0);
