import type { useToast } from '../ui.tsx';

export const TABS = [
  ['home', 'Home', 'home'], ['lineup', 'Lineup', 'lineup'], ['tactics', 'Tactics', 'tactics'], ['players', 'Squad', 'players'],
  ['training', 'Training', 'training'], ['condition', 'Condition', 'condition'], ['office', 'Office', 'office'], ['store', 'Packs', 'store'],
  ['market', 'Market', 'market'], ['table', 'Table', 'table'], ['fixtures', 'Fixtures', 'fixtures'], ['cup', 'Cup', 'cup'],
  ['paper', 'Paper', 'paper'], ['awards', 'Awards', 'awards'], ['leaders', 'Leaders', 'stats'],
] as const;
export type Tab = (typeof TABS)[number][0];
export type TabProps = { lid: number; d: any; reload: () => void; toast: ReturnType<typeof useToast>; go: (t: Tab) => void };
