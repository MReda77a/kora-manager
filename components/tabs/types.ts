import type { useToast } from '../ui.tsx';

export const TABS = [
  ['home', 'Home', 'home'], ['lineup', 'Lineup', 'lineup'], ['tactics', 'Tactics', 'tactics'], ['players', 'Squad', 'players'],
  ['training', 'Training', 'training'], ['condition', 'Condition', 'condition'], ['office', 'Office', 'office'], ['store', 'Packs', 'store'],
  ['market', 'Market', 'market'], ['table', 'Table', 'table'], ['fixtures', 'Fixtures', 'fixtures'], ['cup', 'Cup', 'cup'],
  ['analyst', 'Analyst', 'stats'], ['press', 'Press', 'paper'], ['friendly', 'Friendly', 'fixtures'], ['paper', 'Paper', 'paper'], ['awards', 'Awards', 'awards'], ['leaders', 'Leaders', 'stats'], ['history', 'History', 'history'],
] as const;
export type Tab = (typeof TABS)[number][0];
// The rail shows sections; a section with several screens shows them as tabs at the top.
export const SECTIONS: { key: string; label: string; icon: string; tabs: Tab[] }[] = [
  { key: 'home', label: 'Home', icon: 'home', tabs: ['home'] },
  { key: 'team', label: 'Team', icon: 'players', tabs: ['lineup', 'tactics', 'players', 'training', 'condition'] },
  { key: 'matches', label: 'Matches', icon: 'fixtures', tabs: ['fixtures', 'analyst', 'press', 'friendly', 'table', 'cup', 'leaders'] },
  { key: 'transfers', label: 'Transfers', icon: 'market', tabs: ['market', 'store'] },
  { key: 'club', label: 'Club', icon: 'office', tabs: ['office', 'paper', 'awards', 'history'] },
];
export const sectionOf = (t: Tab) => SECTIONS.find((s) => s.tabs.includes(t)) || SECTIONS[0];
export type TabProps = { lid: number; d: any; reload: () => void; toast: ReturnType<typeof useToast>; go: (t: Tab) => void };
