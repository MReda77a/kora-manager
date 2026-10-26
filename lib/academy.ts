// Academy players: fictional youngsters that top up thin pools, mostly goalkeepers.
// The real data has few keepers (only those who played), and the Egyptian pool is small,
// so every pool is filled to support a 30-club league. Academy players are rated 60-73,
// below the real stars, and marked so the UI can tag them.
import { rng, hashSeed } from './rng.ts';

const NAMES: Record<string, [string[], string[]]> = {
  EGY: [['Omar', 'Youssef', 'Karim', 'Ahmed', 'Hassan', 'Mostafa', 'Ziad', 'Seif', 'Marwan', 'Hamza', 'Adham', 'Yassin', 'Khaled', 'Tarek', 'Amr', 'Islam', 'Ali', 'Mahmoud'],
    ['Hegazy', 'Fathy', 'Saber', 'Abdelaziz', 'Ragab', 'Shawky', 'Mansour', 'Farouk', 'Ashraf', 'Gaber', 'Helmy', 'Nabil', 'Salah El-Din', 'Kamal', 'Fawzy', 'Zaki', 'Sherif', 'Badawy']],
  KSA: [['Faisal', 'Abdullah', 'Turki', 'Nawaf', 'Saud', 'Fahad', 'Rakan', 'Mishal', 'Bandar', 'Hattan', 'Sultan', 'Majed', 'Yazeed', 'Ziyad'],
    ['Al-Harbi', 'Al-Qahtani', 'Al-Otaibi', 'Al-Shahrani', 'Al-Ghamdi', 'Al-Dawsari', 'Al-Mutairi', 'Al-Zahrani', 'Al-Anazi', 'Al-Shammari', 'Al-Malki', 'Al-Subaie']],
  ENG: [['Jack', 'Harry', 'Oliver', 'Charlie', 'George', 'Alfie', 'Freddie', 'Archie', 'Louis', 'Toby', 'Callum', 'Reece', 'Kyle', 'Jordan'],
    ['Walker', 'Hughes', 'Bennett', 'Carter', 'Fletcher', 'Harper', 'Marsh', 'Doyle', 'Webb', 'Pritchard', 'Holt', 'Barnes', 'Gibbs', 'Ashworth']],
  USA: [['Tyler', 'Mason', 'Logan', 'Ethan', 'Caleb', 'Brandon', 'Austin', 'Dylan', 'Gavin', 'Cole', 'Hunter', 'Chase', 'Diego', 'Malik'],
    ['Miller', 'Brooks', 'Reyes', 'Coleman', 'Sanders', 'Price', 'Jenkins', 'Ortiz', 'Hayes', 'Russell', 'Ward', 'Morales', 'Fisher', 'Grant']],
  ESP: [['Pablo', 'Álvaro', 'Hugo', 'Sergio', 'Iker', 'Unai', 'Mario', 'Adrián', 'Raúl', 'Javi', 'Dani', 'Marcos', 'Iván', 'Gorka'],
    ['García', 'Moreno', 'Navarro', 'Romero', 'Torres', 'Gil', 'Serrano', 'Molina', 'Ortega', 'Delgado', 'Castro', 'Vidal', 'Prieto', 'Herrera']],
  ITA: [['Luca', 'Matteo', 'Lorenzo', 'Andrea', 'Davide', 'Simone', 'Riccardo', 'Tommaso', 'Gabriele', 'Federico', 'Nicolò', 'Pietro', 'Filippo', 'Alessio'],
    ['Rossi', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'Mancini', 'Lombardi']],
  GER: [['Lukas', 'Jonas', 'Leon', 'Finn', 'Paul', 'Felix', 'Niklas', 'Tim', 'Jannik', 'Moritz', 'Florian', 'Tobias', 'Malte', 'Bastian'],
    ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Wagner', 'Becker', 'Hoffmann', 'Koch', 'Richter', 'Wolf', 'Neumann', 'Krüger', 'Braun']],
  FRA: [['Lucas', 'Hugo', 'Théo', 'Nathan', 'Enzo', 'Mathis', 'Rayan', 'Noah', 'Yanis', 'Maxime', 'Clément', 'Bastien', 'Moussa', 'Kylian'],
    ['Martin', 'Bernard', 'Dubois', 'Laurent', 'Lefèvre', 'Moreau', 'Girard', 'Fontaine', 'Mercier', 'Blanc', 'Garnier', 'Faure', 'Diallo', 'Traoré']],
};

const LINE_OF: Record<string, string> = { GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', DM: 'MID', CM: 'MID', CAM: 'MID', LW: 'FWD', RW: 'FWD', ST: 'FWD' };
const TARGET: Record<string, number> = { GK: 66, DEF: 190, MID: 190, FWD: 130 };
const POSITIONS: Record<string, string[]> = { GK: ['GK'], DEF: ['CB', 'CB', 'LB', 'RB'], MID: ['DM', 'CM', 'CM', 'CAM'], FWD: ['ST', 'ST', 'LW', 'RW'] };

export type RawPlayer = { id: string; name: string; pool: string; nat: string; pos: string; foot: string; age: number; height: number; ovr: number; pot: number; attrs: Record<string, number> };

// existing: real players of one pool. Returns academy players to add.
export function academyFor(pool: string, existing: RawPlayer[]): RawPlayer[] {
  const r = rng(hashSeed('academy', pool));
  const [first, last] = NAMES[pool] || NAMES.ENG;
  const used = new Set(existing.map((p) => p.name));
  const out: RawPlayer[] = [];
  const count = (line: string) => existing.filter((p) => LINE_OF[p.pos] === line).length + out.filter((p) => LINE_OF[p.pos] === line).length;
  let k = 0;
  for (const line of ['GK', 'DEF', 'MID', 'FWD']) {
    const templates = existing.filter((p) => LINE_OF[p.pos] === line).sort((a, b) => a.ovr - b.ovr);
    while (count(line) < TARGET[line]) {
      const pos = r.pick(POSITIONS[line]);
      let name = '';
      for (let t = 0; t < 20 && (!name || used.has(name)); t++) name = `${r.pick(first)} ${r.pick(last)}`;
      // three-part names (first, father, family) when two-part ones run out
      for (let t = 0; t < 40 && used.has(name); t++) name = `${r.pick(first)} ${r.pick(first)} ${r.pick(last)}`;
      if (used.has(name)) name = `${name} Jr`;
      if (used.has(name)) name += ` ${++k}`;
      used.add(name);
      const ovr = Math.round(60 + r.next() * 13);
      const age = 17 + Math.floor(r.next() * 6);
      // borrow the shape of a real player in the same line, scaled to the new rating
      const tpl = templates[Math.floor(r.next() * Math.min(templates.length, 40))] || existing[0];
      const scale = ovr / Math.max(40, tpl.ovr);
      const attrs: Record<string, number> = {};
      for (const [key, v] of Object.entries(tpl.attrs)) {
        if (key === 'v') continue;
        const outfieldOnly = ['Reflexes', 'Handling', 'OneOnOne', 'Distribution'].includes(key) ? line === 'GK' : line !== 'GK';
        const scaled = outfieldOnly && !['Consistency', 'BigMatch', 'InjuryProne'].includes(key) ? v * scale : v;
        attrs[key] = Math.max(15, Math.min(95, Math.round(scaled + r.gauss(0, 3))));
      }
      attrs.v = Math.round((0.3 + (ovr - 60) * 0.12) * 10) / 10;
      attrs.Academy = 1;
      out.push({
        id: `A-${pool}-${String(out.length + 1).padStart(3, '0')}`, name, pool, nat: pool === 'ENG' ? 'ENG' : pool, pos,
        foot: r.next() < 0.25 ? 'L' : 'R', age, height: line === 'GK' ? 185 + Math.floor(r.next() * 10) : 170 + Math.floor(r.next() * 18),
        ovr, pot: Math.min(88, ovr + 6 + Math.floor(r.next() * 12)), attrs,
      });
    }
  }
  return out;
}

// A youth intake prospect for one club at the start of a new season. Templates are real players of
// the pool's line; the youngster gets their shape at a lower rating and a high potential.
export function youthPlayer(pool: string, id: string, seed: number, line: string, templates: RawPlayer[], bonus = 0): RawPlayer {
  const r = rng(seed);
  const [first, last] = NAMES[pool] || NAMES.ENG;
  const pos = r.pick(POSITIONS[line]);
  const ovr = Math.round(54 + r.next() * 10 + bonus);
  const tpl = templates[Math.floor(r.next() * templates.length)];
  const scale = ovr / Math.max(40, tpl.ovr);
  const attrs: Record<string, number> = {};
  for (const [key, v] of Object.entries(tpl.attrs)) {
    if (key === 'v' || key === 'Academy') continue;
    const gk = ['Reflexes', 'Handling', 'OneOnOne', 'Distribution'].includes(key);
    const scaled = (gk ? line === 'GK' : line !== 'GK') && !['Consistency', 'BigMatch', 'InjuryProne'].includes(key) ? v * scale : v;
    attrs[key] = Math.max(15, Math.min(92, Math.round(scaled + r.gauss(0, 3))));
  }
  attrs.v = Math.round((0.4 + (ovr - 54) * 0.1) * 10) / 10;
  attrs.Youth = 1;
  return {
    id, name: `${r.pick(first)} ${r.pick(last)}`, pool, nat: pool, pos, foot: r.next() < 0.25 ? 'L' : 'R', age: 16 + Math.floor(r.next() * 3),
    height: line === 'GK' ? 184 + Math.floor(r.next() * 10) : 168 + Math.floor(r.next() * 20), ovr,
    pot: Math.min(92, ovr + 14 + Math.floor(r.next() * 14) + bonus), attrs,
  };
}
