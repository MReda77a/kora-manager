import type { useToast } from '../ui.tsx';

export const TABS = [
  ['home', 'Home', 'home'], ['lineup', 'Match plan', 'lineup'], ['tactics', 'Tactics', 'tactics'], ['players', 'Squad', 'players'],
  ['training', 'Training', 'training'], ['condition', 'Condition', 'condition'], ['office', 'Office', 'office'], ['store', 'Packs', 'store'],
  ['market', 'Market', 'market'], ['deals', 'Deals', 'market'], ['table', 'Standings', 'table'], ['managers', 'Managers', 'awards'], ['fixtures', 'Fixtures', 'fixtures'], ['cup', 'Cup', 'cup'],
  ['analyst', 'Prepare', 'stats'], ['press', 'Press', 'paper'], ['friendly', 'Friendly', 'fixtures'], ['paper', 'Paper', 'paper'], ['tv', 'TV & fans', 'paper'], ['social', 'Fans', 'paper'], ['awards', 'Awards', 'awards'], ['leaders', 'Leaders', 'stats'], ['streaks', 'Streaks', 'stats'], ['history', 'History', 'history'],
] as const;
export type Tab = (typeof TABS)[number][0];
// The rail shows sections; a section with several screens shows them as tabs at the top.
export const SECTIONS: { key: string; label: string; icon: string; tabs: Tab[] }[] = [
  { key: 'home', label: 'Home', icon: 'home', tabs: ['home'] },
  { key: 'team', label: 'Team', icon: 'players', tabs: ['lineup', 'players', 'training', 'condition'] },
  { key: 'matches', label: 'Calendar', icon: 'fixtures', tabs: ['fixtures', 'cup', 'analyst'] },
  { key: 'standings', label: 'Standings', icon: 'table', tabs: ['table', 'awards'] },
  { key: 'transfers', label: 'Transfers', icon: 'market', tabs: ['market', 'deals', 'store'] },
  { key: 'media', label: 'Media', icon: 'tv', tabs: ['tv', 'paper'] },
  { key: 'club', label: 'Club', icon: 'office', tabs: ['office', 'history'] },
];
// screens that live inside another tab (reached from a switch on that tab)
export const PARENT: Partial<Record<Tab, Tab>> = { tactics: 'lineup', press: 'analyst', social: 'tv', friendly: 'fixtures', managers: 'table', leaders: 'table', streaks: 'table' };
// the switch shown at the top of a tab that holds several screens
export const GROUPS: { tabs: Tab[]; labels: string[] }[] = [
  { tabs: ['fixtures', 'friendly'], labels: ['Fixtures', 'Friendly'] },
  { tabs: ['analyst', 'press'], labels: ['Analyst', 'Press room'] },
  { tabs: ['table', 'leaders', 'streaks', 'managers'], labels: ['Table', 'Top players', 'Streaks', 'Managers'] },
];
export const topTab = (t: Tab): Tab => PARENT[t] || t;
export const sectionOf = (t: Tab) => SECTIONS.find((s) => s.tabs.includes(topTab(t))) || SECTIONS[0];
export type TabProps = { lid: number; d: any; reload: () => void; toast: ReturnType<typeof useToast>; go: (t: Tab) => void };
