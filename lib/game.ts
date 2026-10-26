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

// AI clubs get fictional names that fit the chosen country.
export const AI_NAMES_BY_POOL: Record<string, string[]> = {
  ENG: ['Kingsbridge United', 'Harrowgate Town', 'Thamesbury FC', 'Northvale Athletic', 'Westmoor Rangers', 'Elmwood City', 'Redcliffe Albion', 'Brackenfield Town', 'Hollowbrook United', 'Stonebridge Wanderers', 'Marlow Heath', 'Fenwick Athletic', 'Oakhurst City', 'Calder Vale', 'Mersey Bay FC', 'Pennine Rovers', 'Wexley Town', 'Ravensworth United', 'Blackmoor Athletic', 'Saxonford City', 'Highfield Rangers', 'Cobham Vale', 'Ironbridge United', 'Linton Albion', 'Moorgate FC', 'Thornbury Town', 'Ashcombe City', 'Kestrel Park FC', 'Riverside Athletic', 'Wolverley United'],
  ESP: ['Atlético Sierra Norte', 'Real Costa Dorada', 'CD Valle Verde', 'Unión Montealto', 'SD Puerto Azul', 'Racing Las Dunas', 'CF Torre Blanca', 'Deportivo Río Claro', 'UD Serranía', 'Sporting Alameda', 'CD Almenara', 'Atlético Vega Alta', 'Real Peñaroja', 'CF Marisma', 'UD Olivares', 'Club Ciudad Sol', 'CD Faro Viejo', 'Atlético Cumbres', 'Real Bahía Sur', 'SD Castillejo', 'CF Los Pinares', 'UD Campo Norte', 'Racing Ribera', 'CD Montañeros', 'Atlético Arenal', 'Real Navarrete', 'CF Altamira', 'UD Mirador', 'SD Cala Brava', 'CD Robledo'],
  ITA: ['AC Vesuvio', 'Sporting Valdarno', 'US Lagunare', 'FC Montebello', 'AS Collina', 'Virtus Alpina', 'Pro Tirreno', 'AC Valtellina', 'US Portofino', 'FC Arcobaleno', 'AS Bellavista', 'Polisportiva Etna', 'AC Torrebianca', 'US Marina Alta', 'FC Castelvetro', 'AS Pianura', 'Real Adriatica', 'AC Sangallo', 'US Montefiore', 'FC Lago Verde', 'AS Ponte Vecchio', 'Sporting Monterosso', 'AC Valdoro', 'US Riviera', 'FC San Lupo', 'AS Cervia Nord', 'Virtus Colline', 'AC Dolomiti', 'US Gran Sasso', 'FC Aurora'],
  GER: ['FC Rheinstadt', 'SV Waldheim', 'Eintracht Nordberg', 'Borussia Talheim', 'SC Elbtal', 'VfR Steinbach', 'TSV Bergland', 'FC Hafenstadt', 'SpVgg Mühlbach', 'Union Ostheim', 'SV Lindenau', 'VfB Rosenfeld', 'Fortuna Kesselberg', 'SC Seetal', 'FC Sonnenberg', 'Alemannia Westerholz', 'TuS Falkenau', 'SV Grünwiese', 'FSV Donaufeld', 'Arminia Kirchberg', 'Rot-Weiss Altdorf', 'SC Moorbach', 'VfL Brückenau', 'FC Eichenhain', 'Germania Nordhafen', 'SV Bergquell', 'TSG Wolfstal', 'Viktoria Adlershorst', 'SC Isarau', 'FC Sternfeld'],
  FRA: ['Olympique Provence', 'AS Côte Bleue', 'Stade Montclair', 'FC Val de Loire', 'RC Bellerive', 'SC Mont-Blanc', 'US Pays Basque', 'Racing Saint-Aubin', 'AS Rivemont', 'FC Lavande', 'Stade Bretagne Nord', 'Olympique Alpin', 'AS Beaulieu', "FC Côte d'Opale", 'US Gironde', 'RC Vallon', 'Stade Fontaine', 'AS Haut-Rhin', 'FC Bois-Joli', 'Olympique Camargue', 'AS Pointe-Rouge', 'FC Normandie Ouest', 'US Belvédère', 'Stade Lumière', 'RC Mirabeau', 'AS Vieux-Port', 'FC Sainte-Clair', 'SC Ardennes', 'US Cévennes', 'Olympique Rivoli'],
  KSA: ['Najd Falcons', 'Asir Eagles', 'Hejaz Stars', 'Tabuk Knights', 'Qassim Lions', 'Red Sea United', 'Riyadh Comets', 'Jeddah Mariners', 'Dammam Sharks', 'Hail Hawks', 'Taif Roses', 'Jazan Waves', 'Abha Peaks', 'Khobar Pearls', 'Yanbu Sails', 'Al-Ula Rocks', 'Najran Scorpions', 'Madinah Palms', 'Makkah Crescent', 'Buraidah Dates', 'Al-Ahsa Oasis', 'Jubail Anchors', 'Rafha Desert', 'Sakaka Wolves', 'Baha Mountains', 'Qurayyat Hawks', 'Diriyah Knights', 'Unaizah Stallions', 'Arar Falcons', 'Tayma Stars'],
  USA: ['Austin Stallions', 'Portland Pines', 'Denver Summit', 'Carolina Tides', 'Ohio Ironmen', 'Phoenix Firebirds', 'Boston Harbors', 'Nashville Notes', 'Tampa Bay Pelicans', 'Sacramento Gold', 'Memphis Blues', 'Detroit Motors', 'Oakland Redwoods', 'Milwaukee Harbor', 'Albuquerque Suns', 'Kansas City Prairie', 'Buffalo Snowbirds', 'Tucson Desert FC', 'Richmond Rebels', 'Omaha Thunder', 'Pittsburgh Steel FC', 'San Diego Surf', 'Las Vegas Neon', 'Baltimore Bay', 'Raleigh Oaks', 'Anchorage Glaciers', 'Honolulu Waves', 'El Paso Rattlers', 'Savannah Sails', 'Boise Peaks'],
  EGY: ['Cairo Falcons', 'Aswan Stars', 'Port Said Mariners', 'Luxor Pharaohs', 'Delta Lions', 'Canal Sailors', 'Upper Nile FC', 'Sinai Wolves', 'Red Sea Sharks', 'Giza Knights', 'North United', 'Desert Hawks', 'Alexandria Waves', 'Fayoum Oasis', 'Suez Anchors', 'Mansoura Bulls', 'Tanta Tigers', 'Minya Royals', 'Sohag Spartans', 'Qena Kings', 'Hurghada Reef', 'Damietta Dolphins', 'Ismailia Eagles', 'Zagazig Rovers', 'Beni Suef Bees', 'Matrouh Marlins', 'Dakhla Dunes', 'Siwa Scorpions', 'Helwan Hammers', 'Nasr City Comets'],
};
export const AI_NAMES = AI_NAMES_BY_POOL.EGY;
export const CUP_NAMES: Record<string, string> = { ENG: 'The Crown Cup', ESP: 'Copa del Sol', ITA: 'Coppa Aurora', GER: 'Goldpokal', FRA: 'Coupe Lumière', KSA: 'The Desert Cup', USA: 'The Liberty Cup', EGY: 'The Nile Cup' };
export const PAPER_NAMES: Record<string, string> = { ENG: 'The Morning Whistle', ESP: 'Diario del Gol', ITA: 'Il Corriere del Pallone', GER: 'Der Anstoß', FRA: "Le Coup d'Envoi", KSA: 'The Desert Herald', USA: 'The Daily Kickoff', EGY: 'The Nile Gazette' };

// Staff come from the Staff pack. The best of each role counts.
export const STAFF_ROLES: Record<string, { name: string; effect: (lvl: number) => string }> = {
  doctor: { name: 'Club Doctor', effect: (l) => `${l * 8}% fewer injuries, ${Math.min(2, Math.floor(l / 2))} day(s) shorter` },
  physio: { name: 'Physio', effect: (l) => `+${l * 3}% fitness recovery per day` },
  coach: { name: 'Coach', effect: (l) => `Training ${l * 10}% faster${l >= 4 ? ', 3 players at once' : ''}` },
};
export const STAFF_PACK = { name: 'Staff', price: 80 };

// Sponsor offers, chosen once per season in the Office.
// Sponsors pay on results: a win pays in full, a draw pays less, a defeat pays nothing.
// (Home matches also bring ticket money, which follows the size of the crowd.)
export const SPONSORS = {
  safe: { name: 'Safe', win: 1.0, draw: 0.5, perGoal: 0, bonus: 0, text: '1M per win, 0.5M per draw. Nothing for a defeat.' },
  bonus: { name: 'Bonus', win: 1.5, draw: 0.2, perGoal: 0.1, bonus: 0, text: '1.5M per win, 0.2M per draw, plus 0.1M for every goal. Nothing for a defeat.' },
  target: { name: 'Target', win: 0.8, draw: 0.3, perGoal: 0, bonus: 9, text: '0.8M per win, 0.3M per draw, plus 9M if you hit your board target. Nothing for a defeat.' },
} as const;
export type SponsorKey = keyof typeof SPONSORS;

export const TRAINABLE = ['Finishing', 'Passing', 'Crossing', 'Dribbling', 'Pace', 'Heading', 'Tackling', 'Marking', 'Vision', 'Composure', 'Stamina', 'LongShots', 'Reflexes', 'Handling', 'OneOnOne'];
export const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'CAM', 'LW', 'RW', 'ST'];

export const LIVE_SECONDS = 110; // a watched match lasts this long in real time
export const AI_COLORS = ['#3651C9', '#1F9D55', '#D9A520', '#2B9FC9', '#7A5BD6', '#C9702B', '#5E6B73', '#B8325A', '#2F8F83', '#8E3BB0'];

export function shortName(name: string) {
  const w = name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean);
  return (w.length > 1 ? w[0].slice(0, 2) + w[1][0] : (w[0] || 'CLB').slice(0, 3)).toUpperCase();
}

// Transfer windows: open in pre-season, then for WINDOW_DAYS days at the start of each round of
// the league - the first round (everyone plays everyone once) and the second round (the return games).
export const WINDOW_DAYS = 5;
export type WindowInfo = {
  open: boolean; label: string; round: 0 | 1 | 2;
  phase: 'pre' | 'open1' | 'between' | 'open2' | 'after' | 'over';
  closesAt?: string; opensAt?: string;
};
export function windowFromDays(status: string, days: { day: number; kind: string; kickoff_at: string | Date }[], now: number): WindowInfo {
  if (status === 'setup') return { open: true, label: 'Pre-season window', round: 0, phase: 'pre' };
  if (status !== 'running') return { open: false, label: 'Season over', round: 0, phase: 'over' };
  if (!days.length) return { open: true, label: 'Pre-season window', round: 0, phase: 'pre' };
  const t = (x: { kickoff_at: string | Date }) => new Date(x.kickoff_at).getTime();
  const sorted = [...days].sort((a, b) => a.day - b.day);
  const DAY = 86_400_000;
  // the second round starts on the break day after the last game of the first round
  const brk = sorted.find((x) => x.kind === 'break') || sorted[Math.floor(sorted.length / 2)];
  const r2 = t(brk), last = t(sorted[sorted.length - 1]);
  const w1End = Math.min(t(sorted[0]) + WINDOW_DAYS * DAY, r2);
  const w2End = Math.min(r2 + WINDOW_DAYS * DAY, last);
  const iso = (x: number) => new Date(x).toISOString();
  if (now < w1End) return { open: true, label: 'First-round window', round: 1, phase: 'open1', closesAt: iso(w1End) };
  if (now < r2) return { open: false, label: 'Closed · opens when the second round starts', round: 1, phase: 'between', opensAt: iso(r2) };
  if (now < w2End) return { open: true, label: 'Second-round window', round: 2, phase: 'open2', closesAt: iso(w2End) };
  return { open: false, label: 'Closed until next season', round: 2, phase: 'after' };
}

// ---------------------------------------------------------------- kits
export const PATTERNS = ['Plain', 'Stripes', 'Halves', 'Hoops', 'Sash'];
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt((h || '#000000').slice(i, i + 2), 16) || 0);
export function colorDist(a: string, b: string) {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0));
}
export type Kit = { c1: string; c2: string; pattern: number; label: 'Home kit' | 'Away kit' | 'Third kit' };
// The home side always wears its home kit. The away side switches to its away kit on a clash,
// and to a white or black third kit if that still clashes.
export function matchKits(home: any, away: any): [Kit, Kit] {
  const hk: Kit = { c1: home.color1, c2: home.color2, pattern: home.pattern || 0, label: 'Home kit' };
  const clash = (c: string) => colorDist(c, hk.c1) < 110 || (colorDist(c, hk.c2) < 60 && colorDist(hk.c1, hk.c2) < 110);
  let ak: Kit = { c1: away.color1, c2: away.color2, pattern: away.pattern || 0, label: 'Home kit' };
  if (clash(ak.c1)) {
    const a1 = away.away1 || away.color2, a2 = away.away2 || away.color1;
    ak = { c1: a1, c2: a2, pattern: 0, label: 'Away kit' };
    if (clash(ak.c1)) {
      const white = colorDist('#F3EEFF', hk.c1) >= colorDist('#151018', hk.c1);
      ak = { c1: white ? '#F3EEFF' : '#151018', c2: white ? '#151018' : '#F3EEFF', pattern: 0, label: 'Third kit' };
    }
  }
  return [hk, ak];
}

// ---------------------------------------------------------------- player roles
export const ROLES: Record<string, { line: 'GK' | 'DEF' | 'MID' | 'FWD'; desc: string; keys: string[] }> = {
  'Shot stopper': { line: 'GK', desc: 'Stays on his line. Better saves.', keys: ['Reflexes', 'Handling'] },
  'Sweeper keeper': { line: 'GK', desc: 'Rushes out behind a high line.', keys: ['OneOnOne', 'Distribution'] },
  Stopper: { line: 'DEF', desc: 'Steps out, wins duels and headers.', keys: ['Tackling', 'Strength'] },
  'Ball-playing': { line: 'DEF', desc: 'Starts attacks from the back.', keys: ['Passing', 'Vision'] },
  'Wing-back': { line: 'DEF', desc: 'Bombs forward and crosses.', keys: ['Pace', 'Crossing'] },
  Anchor: { line: 'MID', desc: 'Sits in front of the defence.', keys: ['Tackling', 'Marking'] },
  'Box-to-box': { line: 'MID', desc: 'Covers every blade of grass.', keys: ['Stamina', 'WorkRate'] },
  Playmaker: { line: 'MID', desc: 'Dictates play, splits defences.', keys: ['Passing', 'Vision'] },
  Poacher: { line: 'FWD', desc: 'Lives in the box. Finishes chances.', keys: ['Finishing', 'Positioning'] },
  'Target man': { line: 'FWD', desc: 'Wins headers, holds the ball up.', keys: ['Heading', 'Strength'] },
  'False 9': { line: 'FWD', desc: 'Drops deep to link play.', keys: ['Passing', 'Dribbling'] },
  'Inside forward': { line: 'FWD', desc: 'Cuts in and shoots.', keys: ['Dribbling', 'LongShots'] },
};
export const CORNER_ROUTINES: Record<string, string> = { near: 'Near post', far: 'Far post', short: 'Short' };

// ---------------------------------------------------------------- personalities
export const TRAITS: Record<string, string> = {
  Professional: 'Never sulks for long. Trains hard.',
  Ambitious: 'Hates the bench. Wants trophies.',
  Loyal: 'Takes setbacks well. Loves the club.',
  Temperamental: 'Big mood swings. Picks up cards.',
  Leader: 'Calms the dressing room. Talks work twice as well.',
  'Big-game player': 'Raises his game in derbies and cup ties.',
};
export function traitOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  const t = ['Professional', 'Professional', 'Ambitious', 'Ambitious', 'Loyal', 'Loyal', 'Temperamental', 'Leader', 'Big-game player', 'Professional'];
  return t[h % t.length];
}

// ---------------------------------------------------------------- match conditions
export const WEATHER: Record<string, { label: string; icon: string; note: string }> = {
  clear: { label: 'Clear', icon: '☀️', note: 'Perfect conditions.' },
  rain: { label: 'Heavy rain', icon: '🌧️', note: 'Short passing is riskier. Long balls skid.' },
  heat: { label: 'Heat', icon: '🥵', note: 'Legs tire 25% faster. Pressing hurts.' },
  wind: { label: 'Strong wind', icon: '💨', note: 'Crosses and long balls lose accuracy.' },
  snow: { label: 'Snow', icon: '❄️', note: 'Slow pitch. Pace matters less.' },
};
export const REFEREES = ['K. Aldridge', 'S. Marwan', 'L. Ferrand', 'T. Okafor', 'R. Haddad', 'J. Lindqvist', 'M. Serrano', 'D. Kowal', 'A. Nassar', 'P. Bellamy', 'H. Rahimi', 'G. Ottaviani'];
export function conditionsFor(fixtureId: number, pool: string, day: number) {
  let h = 2166136261;
  for (const c of `${fixtureId}|${pool}|${day}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const hot = ['KSA', 'EGY', 'USA'].includes(pool), cold = ['GER', 'ENG'].includes(pool);
  const w = h % 100;
  const weather = w < 55 ? 'clear' : w < 70 ? (hot ? 'heat' : 'rain') : w < 82 ? 'wind' : w < 92 ? (hot ? 'heat' : 'rain') : cold ? 'snow' : 'clear';
  const strict = (h >>> 8) % 3; // 0 lenient, 1 normal, 2 strict
  return { weather, referee: { name: REFEREES[(h >>> 12) % REFEREES.length], strict, label: ['Lenient', 'Normal', 'Strict'][strict] } };
}

// ---------------------------------------------------------------- tactic fit
// How well a tactic suits the players on the pitch. Each part of the tactic asks for certain
// qualities from certain players (pressing needs stamina and work rate, crosses need crossers and
// headers, a high line needs fast defenders...). Each quality is compared with the team's own level,
// so a side with a great striker and an average midfield fits a different plan than the reverse.
export type FitPlayer = { pos: string; slot?: string; ovr: number; a: Record<string, number> };
export type FitPart = { label: string; value: number; weight: number };
const WIDE = new Set(['LB', 'RB', 'LW', 'RW']);
// typical attribute minus overall for each position, measured on the whole player database
const TYPICAL: Record<string, Record<string, number>> = {"GK":{"Stamina":-24,"WorkRate":-25,"Aggression":-25,"Pace":-31,"Positioning":-30,"Marking":-50,"Tackling":-50,"Passing":-24,"FirstTouch":-25,"Composure":0,"Heading":-40,"Strength":-8,"Jumping":-6,"Crossing":-45,"Vision":-24,"Dribbling":-45,"LongShots":-50,"Finishing":-55,"Decisions":0},"CB":{"Stamina":-4,"WorkRate":-2,"Aggression":4,"Pace":-7,"Positioning":4,"Marking":6,"Tackling":5,"Passing":-8,"FirstTouch":-10,"Composure":-1,"Heading":5,"Strength":6,"Jumping":5,"Crossing":-24,"Vision":-14,"Dribbling":-18,"LongShots":-24,"Finishing":-34,"Decisions":1},"LB":{"Stamina":6,"WorkRate":5,"Aggression":-2,"Pace":6,"Positioning":-2,"Marking":0,"Tackling":1,"Passing":-4,"FirstTouch":-4,"Composure":-3,"Heading":-8,"Strength":-6,"Jumping":-6,"Crossing":3,"Vision":-8,"Dribbling":-6,"LongShots":-18,"Finishing":-28,"Decisions":-2},"RB":{"Stamina":6,"WorkRate":5,"Aggression":-2,"Pace":5,"Positioning":-2,"Marking":0,"Tackling":1,"Passing":-4,"FirstTouch":-4,"Composure":-4,"Heading":-8,"Strength":-6,"Jumping":-6,"Crossing":3,"Vision":-8,"Dribbling":-6,"LongShots":-18,"Finishing":-28,"Decisions":-2},"DM":{"Stamina":4,"WorkRate":5,"Aggression":3,"Pace":-8,"Positioning":3,"Marking":3,"Tackling":4,"Passing":1,"FirstTouch":-2,"Composure":1,"Heading":-2,"Strength":2,"Jumping":-3,"Crossing":-12,"Vision":-2,"Dribbling":-8,"LongShots":-8,"Finishing":-20,"Decisions":2},"CM":{"Stamina":5,"WorkRate":5,"Aggression":-4,"Pace":-5,"Positioning":-2,"Marking":-8,"Tackling":-6,"Passing":4,"FirstTouch":2,"Composure":1,"Heading":-8,"Strength":-4,"Jumping":-8,"Crossing":-6,"Vision":3,"Dribbling":0,"LongShots":-2,"Finishing":-10,"Decisions":2},"CAM":{"Stamina":-3,"WorkRate":-3,"Aggression":-14,"Pace":-2,"Positioning":0,"Marking":-26,"Tackling":-24,"Passing":5,"FirstTouch":5,"Composure":2,"Heading":-16,"Strength":-12,"Jumping":-14,"Crossing":-4,"Vision":7,"Dribbling":4,"LongShots":2,"Finishing":-2,"Decisions":2},"LW":{"Stamina":-2,"WorkRate":-3,"Aggression":-14,"Pace":7,"Positioning":0,"Marking":-32,"Tackling":-30,"Passing":-3,"FirstTouch":2,"Composure":-2,"Heading":-14,"Strength":-12,"Jumping":-12,"Crossing":2,"Vision":-3,"Dribbling":6,"LongShots":-2,"Finishing":0,"Decisions":-3},"RW":{"Stamina":-2,"WorkRate":-3,"Aggression":-14,"Pace":7,"Positioning":0,"Marking":-32,"Tackling":-30,"Passing":-3,"FirstTouch":2,"Composure":-2,"Heading":-14,"Strength":-12,"Jumping":-12,"Crossing":2,"Vision":-3,"Dribbling":6,"LongShots":-2,"Finishing":0,"Decisions":-3},"ST":{"Stamina":-6,"WorkRate":-8,"Aggression":-8,"Pace":2,"Positioning":5,"Marking":-38,"Tackling":-35,"Passing":-8,"FirstTouch":2,"Composure":4,"Heading":0,"Strength":0,"Jumping":-2,"Crossing":-12,"Vision":-8,"Dribbling":0,"LongShots":0,"Finishing":7,"Decisions":-2}};
export function tacticFit(xi: FitPlayer[], t: Pick<Tactic, 'mentality' | 'press' | 'line' | 'build' | 'focus' | 'width' | 'tempo'>) {
  const out = xi.filter((p) => (p.slot || LINE[p.pos]) !== 'GK');
  const by = (s: string) => out.filter((p) => (p.slot || LINE[p.pos] || 'MID') === s);
  const D = by('DEF'), M = by('MID'), F = by('FWD');
  const G = xi.filter((p) => (p.slot || LINE[p.pos]) === 'GK');
  const W = out.filter((p) => WIDE.has(p.pos));
  // how much better (or worse) than usual each player is at these qualities, for his position and level
  const q = (ps: FitPlayer[], keys: string[]) => {
    if (!ps.length) return 0;
    const v = ps.reduce((s, p) => {
      const base = TYPICAL[p.pos] || TYPICAL.CM;
      return s + keys.reduce((k, key) => k + ((p.a[key] ?? 50) - p.ovr - (base[key] ?? 0)), 0) / keys.length;
    }, 0) / ps.length;
    return Math.max(-1.5, Math.min(1.5, v / 4));
  };
  const parts: FitPart[] = [];
  const add = (label: string, value: number, weight: number) => { if (weight > 0) parts.push({ label, value, weight }); };
  // out of possession
  add('Pressing: stamina and work rate', q(out, ['Stamina', 'WorkRate', 'Aggression']), [0, 0.3, 1, 1.6][t.press]);
  if (t.line === 2) add('High line: defenders\' pace', q(D, ['Pace']), 1.2);
  if (t.line === 0) add('Deep block: defending', q([...D, ...M], ['Positioning', 'Marking', 'Tackling']), 1.1);
  if (t.mentality === 0) add('Defensive: tackling', q(D, ['Tackling', 'Marking']), 0.6);
  // in possession
  if (t.build === 0) add('Short build-up: passing', q([...D, ...M, ...G], ['Passing', 'FirstTouch', 'Composure']), 1.2);
  if (t.build === 2) add('Direct: target up front', q(F, ['Heading', 'Strength', 'Jumping']), 1.0);
  if (t.focus === 0) { add('Crosses: crossers', q(W.length ? W : M, ['Crossing']), 1.0); add('Crosses: headers in the box', q(F, ['Heading', 'Jumping']), 1.0); }
  if (t.focus === 1) { add('Through balls: vision', q(M, ['Vision', 'Passing']), 0.9); add('Through balls: runners\' pace', q(F, ['Pace', 'Positioning']), 1.1); }
  if (t.focus === 2) add('Work it in: technique', q([...M, ...F], ['Passing', 'Dribbling', 'FirstTouch']), 1.6);
  if (t.focus === 3) add('Shoot early: long shots', q([...M, ...F], ['LongShots', 'Finishing']), 1.6);
  if (t.width === 2) add('Wide play: pace on the flanks', q(W.length ? W : F, ['Pace', 'Dribbling']), 0.6);
  if (t.tempo === 2) add('Fast tempo: stamina', q(out, ['Stamina']), 0.6);
  if (t.tempo === 0) add('Slow tempo: composure', q(M, ['Composure', 'Decisions']), 0.5);
  if (t.mentality === 2) add('Attacking: finishing', q(F, ['Finishing', 'Composure']), 0.8);
  const tw = parts.reduce((s, p) => s + p.weight, 0) || 1;
  const fit = parts.reduce((s, p) => s + p.value * p.weight, 0) / tw; // about -1.5 .. +1.5
  return { fit, score: Math.round(Math.max(0, Math.min(100, 50 + fit * 40))), parts };
}
