// Small seeded random generator so a fixture always produces the same match.
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    gauss(mu = 0, sd = 1) {
      const u = Math.max(1e-9, next());
      const v = next();
      return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    pick<T>(arr: T[]): T {
      return arr[Math.floor(next() * arr.length)];
    },
    weighted<T>(arr: T[], w: (x: T) => number): T {
      const ws = arr.map((x) => Math.max(0.0001, w(x)));
      let r = next() * ws.reduce((a, b) => a + b, 0);
      for (let i = 0; i < arr.length; i++) {
        r -= ws[i];
        if (r <= 0) return arr[i];
      }
      return arr[arr.length - 1];
    },
  };
}
export type Rng = ReturnType<typeof rng>;

export function hashSeed(...parts: (string | number)[]) {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
