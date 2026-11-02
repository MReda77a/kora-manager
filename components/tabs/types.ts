import type { useToast } from '../ui.tsx';

export const TABS = [
  ['home', 'Home', 'home'], ['lineup', 'Match plan', 'lineup'], ['tactics', 'Tactics', 'tactics'], ['players', 'Squad', 'players'],
  ['training', 'Training', 'training'], ['condition', 'Condition', 'condition'], ['office', 'Office', 'office'], ['store', 'Packs', 'store'],
  ['market', 'Market', 'market'], ['deals', 'Deals', 'market'], ['table', 'Standings', 'table'], ['managers', 'Managers', 'awards'], ['fixtures', 'Fixtures', 'fixtures'], ['cup', 'Cup', 'cup'],
  ['analyst', 'Prepare', 'stats'], ['press', 'Press', 'paper'], ['friendly', 'Friendly', 'fixtures'], ['paper', 'Paper', 'paper'], ['awards', 'Awards', 'awards'], ['leaders', 'Leaders', 'stats'], ['history', 'History', 'history'],
] as const;
export type Tab = (typeof TABS)[number][0];
// The rail shows sections; a section with several screens shows them as tabs at the top.
export const SECTIONS: { key: string; label: string; icon: string; tabs: Tab[] }[] = [
  { key: 'home', label: 'Home', icon: 'home', tabs: ['home'] },
  { key: 'team', label: 'Team', icon: 'players', tabs: ['lineup', 'players', 'training', 'condition'] },
  { key: 'matches', label: 'Matches', icon: 'fixtures', tabs: ['fixtures', 'analyst', 'table', 'cup'] },
  { key: 'transfers', label: 'Transfers', icon: 'market', tabs: ['market', 'deals', 'store'] },
  { key: 'club', label: 'Club', icon: 'office', tabs: ['office', 'paper', 'awards', 'history'] },
];
// screens that live inside another tab (reached from a switch on that tab)
export const PARENT: Partial<Record<Tab, Tab>> = { tactics: 'lineup', press: 'analyst', friendly: 'fixtures', managers: 'table', leaders: 'table' };
// the switch shown at the top of a tab that holds several screens
export const GROUPS: { tabs: Tab[]; labels: string[] }[] = [
  { tabs: ['fixtures', 'friendly'], labels: ['Fixtures', 'Friendly'] },
  { tabs: ['analyst', 'press'], labels: ['Analyst', 'Press room'] },
  { tabs: ['table', 'managers', 'leaders'], labels: ['Table', 'Managers', 'Top players'] },
];
export const topTab = (t: Tab): Tab => PARENT[t] || t;
export const sectionOf = (t: Tab) => SECTIONS.find((s) => s.tabs.includes(topTab(t))) || SECTIONS[0];
export type TabProps = { lid: number; d: any; reload: () => void; toast: ReturnType<typeof useToast>; go: (t: Tab) => void };
