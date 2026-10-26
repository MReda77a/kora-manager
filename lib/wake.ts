// The timer (worker.ts) keeps the time of the next thing to do in Cloudflare KV, so it does not have
// to ask the database every minute and the database can sleep between matches (Neon's free plan
// counts the hours it is awake). Anything that moves match times calls wakeTimer() so the timer
// looks again at its next tick.
export async function wakeTimer() {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const env = getCloudflareContext().env as { KORA?: { delete: (k: string) => Promise<void> } };
    await env.KORA?.delete('next_due');
  } catch {
    // local scripts and tests run without Cloudflare: nothing to wake
  }
}
