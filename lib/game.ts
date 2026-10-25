// Game rules shared by server and client.

export const POOLS: Record<string, string> = {
  ENG: 'English League', ESP: 'Spanish League', ITA: 'Italian League', GER: 'German League',
  FRA: 'French League', KSA: 'Saudi League', USA: 'American League', EGY: 'Egyptian League',
};

export type ClubTypeKey = 'fan' | 'invest' | 'academy' | 'commercial' | 'historic';

export const CLUB_TYPES: Record<ClubTypeKey, {
  name: string; coins: number; money: number; perk: string; weak: string;
  board: string; sponsor: string; squad: string; targetPos: (n: number) => number;
}> = {
  fan: { name: 'Fan Club', coins: 1000, money: 15, perk: 'Biggest crowds: top ticket income and the strongest home advantage.', weak: 'Fans turn fast after losses.', board: 'Win the league and the cup', sponsor: 'Sell out the stadium', squad: 'Keep your fan favourite all season', targetPos: () => 1 },
  invest: { name: 'Investment', coins: 1150, money: 30, perk: '+150 starting coins and the biggest transfer budget.', weak: 'Impatient board.', board: 'Win the league or the cup', sponsor: 'Have a 90+ player in your XI', squad: 'Sign a star mid-season', targetPos: () => 2 },
  academy: { name: 'Academy', coins: 900, money: 10, perk: 'Young players grow faster. Better scouts.', weak: '100 fewer starting coins.', board: 'Finish in the top half', sponsor: 'Profit from player sales', squad: 'Under-21s play 30% of minutes', targetPos: (n) => Math.ceil(n / 2) },
  commercial: { name: 'Commercial', coins: 1000, money: 18, perk: 'Sponsors pay 0.1M for every goal you score.', weak: 'Sponsors cut money when you score under 1 a game.', board: 'Finish in the top 6', sponsor: 'Score a lot of goals', squad: 'Start an attacking star', targetPos: () => 6 },
  historic: { name: 'Historic', coins: 950, money: 12, perk: 'Steady morale. New tactics are learned faster.', weak: 'Lower income.', board: 'Top 8 and no losing streaks', sponsor: 'Reach a cup semi-final', squad: 'Keep your captain', targetPos: () => 8 },
};

// Pack bands are percentiles of the league pool, so every pool has stars and depth.
export const PACKS = {
  legend: { name: 'Legend', price: 200, n: 1, lo: 0.965, hi: 1.0 },
  gold: { name: 'Gold', price: 150, n: 3, lo: 0.72, hi: 0.965 },
  silver: { name: 'Silver', price: 60, n: 4, lo: 0.4, hi: 0.72 },
  bronze: { name: 'Bronze', price: 25, n: 5, lo: 0.0, hi: 0.4, gk: true },
} as const;
export type PackKey = keyof typeof PACKS;

export const MIN_SQUAD = 16;
export const MAX_SQUAD = 30;

export const LINE: Record<string, 'GK' | 'DEF' | 'MID' | 'FWD'> = {
  GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', DM: 'MID', CM: 'MID', CAM: 'MID', LW: 'FWD', RW: 'FWD', ST: 'FWD',
};

// Slot lines for each formation, index 0 is always the goalkeeper.
export const FORMATIONS: Record<string, { slots: ('GK' | 'DEF' | 'MID' | 'FWD')[]; xy: [number, number][] }> = {
  '4-3-3': { slots: ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD'], xy: [[6, 50], [24, 14], [21, 38], [21, 62], [24, 86], [44, 26], [40, 50], [44, 74], [70, 16], [76, 50], [70, 84]] },
  '4-4-2': { slots: ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD'], xy: [[6, 50], [24, 14], [21, 38], [21, 62], [24, 86], [46, 14], [42, 38], [42, 62], [46, 86], [72, 38], [72, 62]] },
  '4-2-3-1': { slots: ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'MID', 'FWD'], xy: [[6, 50], [24, 14], [21, 38], [21, 62], [24, 86], [38, 38], [38, 62], [58, 18], [58, 50], [58, 82], [78, 50]] },
  '3-5-2': { slots: ['GK', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD'], xy: [[6, 50], [22, 26], [20, 50], [22, 74], [44, 10], [40, 34], [36, 50], [40, 66], [44, 90], [72, 38], [72, 62]] },
  '5-3-2': { slots: ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD', 'FWD'], xy: [[6, 50], [26, 8], [20, 30], [18, 50], [20, 70], [26, 92], [44, 28], [40, 50], [44, 72], [70, 38], [70, 62]] },
};

export type Tactic = {
  preset: string; formation: string;
  mentality: number; press: number; line: number; build: number; focus: number; width: number; tempo: number;
};

export const PRESETS: Record<string, Omit<Tactic, 'preset' | 'formation'> & { desc: string }> = {
  'Tiki-taka': { mentality: 1, press: 2, line: 2, build: 0, focus: 2, width: 1, tempo: 0, desc: 'Keep the ball, short passes, high line.' },
  Gegenpress: { mentality: 2, press: 3, line: 2, build: 1, focus: 1, width: 1, tempo: 2, desc: 'Win it back high and fast. Tiring.' },
  'Low block': { mentality: 0, press: 0, line: 0, build: 2, focus: 1, width: 0, tempo: 1, desc: 'Sit deep, stay compact, hit on the break.' },
  'Wing play': { mentality: 1, press: 1, line: 1, build: 1, focus: 0, width: 2, tempo: 1, desc: 'Stretch them wide and cross. Balanced.' },
  'Long ball': { mentality: 1, press: 1, line: 0, build: 2, focus: 0, width: 1, tempo: 1, desc: 'Skip midfield, go direct to the strikers.' },
  'Shoot on sight': { mentality: 2, press: 1, line: 1, build: 1, focus: 3, width: 1, tempo: 2, desc: 'Shoot from anywhere. Good vs deep blocks.' },
};

export const DEFAULT_TACTIC: Tactic = { preset: 'Wing play', formation: '4-3-3', ...stripDesc(PRESETS['Wing play']) };

export function stripDesc(p: (typeof PRESETS)[string]) {
  const { desc, ...rest } = p;
  void desc;
  return rest;
}

export const TACTIC_FIELDS: { key: keyof Tactic; label: string; opts: string[] }[] = [
  { key: 'mentality', label: 'Mentality', opts: ['Defensive', 'Balanced', 'Attacking'] },
  { key: 'press', label: 'Pressing', opts: ['Low', 'Mid', 'High', 'Gegenpress'] },
  { key: 'line', label: 'Defensive line', opts: ['Deep', 'Mid', 'High'] },
  { key: 'build', label: 'Build-up', opts: ['Short', 'Mixed', 'Direct'] },
  { key: 'focus', label: 'Final third', opts: ['Crosses', 'Through balls', 'Work it in', 'Shoot early'] },
  { key: 'width', label: 'Width', opts: ['Narrow', 'Balanced', 'Wide'] },
  { key: 'tempo', label: 'Tempo', opts: ['Slow', 'Normal', 'Fast'] },
];

export const AI_NAMES = [
  'Cairo Falcons', 'Aswan Stars', 'Port Said Mariners', 'Luxor Pharaohs', 'Delta Lions', 'Canal Sailors', 'Upper Nile FC', 'Sinai Wolves',
  'Red Sea Sharks', 'Giza Knights', 'North United', 'Desert Hawks', 'Alexandria Waves', 'Fayoum Oasis', 'Suez Anchors', 'Mansoura Bulls',
  'Tanta Tigers', 'Minya Royals', 'Sohag Spartans', 'Qena Kings', 'Hurghada Reef', 'Damietta Dolphins', 'Ismailia Eagles', 'Zagazig Rovers',
  'Beni Suef Bees', 'Matrouh Marlins', 'Dakhla Dunes', 'Siwa Scorpions', 'Helwan Hammers', 'Nasr City Comets',
];
export const AI_COLORS = ['#3651C9', '#1F9D55', '#D9A520', '#2B9FC9', '#7A5BD6', '#C9702B', '#5E6B73', '#B8325A', '#2F8F83', '#8E3BB0'];

export function shortName(name: string) {
  const w = name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean);
  return (w.length > 1 ? w[0].slice(0, 2) + w[1][0] : (w[0] || 'CLB').slice(0, 3)).toUpperCase();
}

// Transfer windows: before matchday 1 and during the break between halves.
export function windowState(playedMatchdays: number, totalMatchdays: number, status: string) {
  const half = totalMatchdays / 2;
  if (status === 'setup' || playedMatchdays === 0) return { open: true, label: 'Pre-season window' };
  if (playedMatchdays === half) return { open: true, label: 'Mid-season window' };
  if (status === 'finished') return { open: false, label: 'Season over' };
  const next = playedMatchdays < half ? half : null;
  return { open: false, label: next ? `Closed · opens after matchday ${half}` : 'Closed until next season' };
}
