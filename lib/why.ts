// "Why did that happen?" after the final whistle: a verdict (was the result deserved?), the few things
// that decided the match and one change to try next time. Everything is read from the match report
// (shots with their kind and xG, the events, the plans over time), so it only says what really happened.
import type { Report, Shot } from './engine.ts';

export type WhyLine = { tone: 'good' | 'bad' | 'luck'; text: string };
export type Why = { title: string; tone: 'good' | 'bad' | 'even'; line: string; reasons: WhyLine[]; tip: string | null };

type Cand = WhyLine & { w: number; tip?: string };

const f2 = (x: number) => x.toFixed(2);
const min = (m: number) => (m > 90 ? `90+${m - 90}'` : `${m}'`);
const sum = (l: Shot[]) => l.reduce((a, s) => a + s.xg, 0);

// what a run of chances says about the side that conceded them, and how to stop it
const AGAINST: Record<string, { text: (n: number, x: string) => string; tip: string }> = {
  counter: {
    text: (n, x) => `${n} of their chances came on the counter (${x} xG): they won the ball and ran at your back line.`,
    tip: 'Drop your defensive line a step, or put an Anchor in front of the defence. Quick centre-backs help too.',
  },
  'through ball': {
    text: (n, x) => `${n} through balls got in behind your defence (${x} xG).`,
    tip: 'A lower defensive line, or a Sweeper behind it, stops runs in behind.',
  },
  cross: {
    text: (n, x) => `${n} of their chances came from crosses (${x} xG): you lost the headers in your box.`,
    tip: 'Put a Stopper at centre-back, or close their wide men with Flank cover.',
  },
  corner: {
    text: (n, x) => `${n} of their chances came from corners (${x} xG): you lost the headers in your box.`,
    tip: 'Tall, strong centre-backs win corners. A Stopper role helps.',
  },
  'high turnover': {
    text: (n, x) => `They won the ball high up the pitch ${n} times and shot straight away (${x} xG). Your build-up was pressed.`,
    tip: 'Against a high press, set Build-up to Mixed or Direct in Style.',
  },
  'build-up': {
    text: (n, x) => `They passed their way through your midfield ${n} times (${x} xG).`,
    tip: 'An Anchor or a Marker in midfield, or a more defensive mentality, closes the middle.',
  },
};
const FOR: Record<string, string> = {
  counter: 'counter-attacks', 'through ball': 'through balls', cross: 'crosses', corner: 'corners',
  'high turnover': 'winning the ball high', 'build-up': 'patient passing', 'long shot': 'shots from distance',
};

export function whyReport(rep: Report, me: 0 | 1, names: [string, string]): Why | null {
  if (!rep?.stats) return null;
  const op = (1 - me) as 0 | 1;
  const shots = rep.shots || [];
  const mine = shots.filter((s) => s.side === me), theirs = shots.filter((s) => s.side === op);
  const xgM = rep.stats.xg[me], xgO = rep.stats.xg[op];
  const gM = rep.score[me], gO = rep.score[op];
  const dx = xgM - xgO;
  const c: Cand[] = [];

  // ---- the verdict: the score against the chances each side made
  let title: string, tone: Why['tone'], line: string;
  const chances = `${f2(xgM)} xG to ${f2(xgO)}`;
  if (gM > gO) {
    if (dx >= 0.5) { title = 'DESERVED WIN'; tone = 'good'; line = `You made the better chances: ${chances}.`; }
    else if (dx <= -0.5) { title = 'LUCKY WIN'; tone = 'even'; line = `They made the better chances (${f2(xgO)} xG to ${f2(xgM)}). Take the points, then fix it.`; }
    else { title = 'TIGHT WIN'; tone = 'good'; line = `Very even on chances (${chances}). The small things went your way.`; }
  } else if (gM < gO) {
    if (dx <= -0.5) { title = 'THEY WERE BETTER'; tone = 'bad'; line = `They made the better chances: ${f2(xgO)} xG to ${f2(xgM)}. The result is fair.`; }
    else if (dx >= 0.5) { title = 'UNLUCKY'; tone = 'even'; line = `You made the better chances (${chances}) and still lost. That one was luck, not your plan.`; }
    else { title = 'FINE MARGINS'; tone = 'bad'; line = `Even on chances (${chances}). It could have gone either way.`; }
  } else {
    if (dx >= 0.7) { title = 'SHOULD HAVE WON'; tone = 'even'; line = `You made far better chances (${chances}).`; }
    else if (dx <= -0.7) { title = 'POINT SAVED'; tone = 'even'; line = `They made the better chances (${f2(xgO)} xG to ${f2(xgM)}). A point is a good result.`; }
    else { title = 'FAIR DRAW'; tone = 'even'; line = `Even on chances (${chances}).`; }
  }

  // ---- your shooting: lots of shots from distance are worth little
  if (mine.length >= 10) {
    const far = mine.filter((s) => s.kind === 'long shot' || s.kind === 'free kick');
    if (far.length / mine.length >= 0.45 && sum(far) / far.length < 0.075) {
      c.push({ tone: 'bad', w: 1.5 + far.length / mine.length * 2, text: `${far.length} of your ${mine.length} shots came from outside the box. They are worth little: ${f2(sum(far))} xG between them.`,
        tip: 'Your plan shoots from distance. In Match plan › Style, set Final third to Work it in or Through, and give your striker a scoring role (Poacher).' });
    }
  }
  // ---- the ball without the danger
  const poss = rep.stats.poss[me];
  if (poss >= 58 && rep.stats.shots[me] <= rep.stats.shots[op]) {
    c.push({ tone: 'bad', w: 2.4, text: `${poss}% of the ball but ${rep.stats.shots[me]} shots to their ${rep.stats.shots[op]}. Lots of passing, little danger.`,
      tip: 'Keep the ball with a purpose: a faster tempo or a Direct build-up, and runners up front (Line breaker, Inside forward).' });
  }
  // ---- how they hurt you: their main route to goal
  if (theirs.length && xgO >= 1) {
    const by = new Map<string, Shot[]>();
    theirs.forEach((s) => by.set(s.kind, [...(by.get(s.kind) || []), s]));
    const [kind, list] = [...by.entries()].filter(([k]) => AGAINST[k]).sort((a, b) => sum(b[1]) - sum(a[1]))[0] || [];
    if (kind && list && sum(list) >= Math.max(0.6, xgO * 0.35)) {
      c.push({ tone: 'bad', w: 1 + sum(list) * 1.3, text: AGAINST[kind].text(list.length, f2(sum(list))), tip: AGAINST[kind].tip });
    } else if (xgO >= 2.2) {
      c.push({ tone: 'bad', w: xgO, text: `They made ${f2(xgO)} xG: your defence gave away big chances all over the pitch.`, tip: 'Try a more defensive mentality and a lower line until it settles.' });
    }
  }
  if (xgO < 0.8 && theirs.length) c.push({ tone: 'good', w: 2 - xgO, text: `Your defence held: they made only ${f2(xgO)} xG all match.` });
  // ---- how you hurt them
  if (mine.length && xgM >= 1.2) {
    const by = new Map<string, Shot[]>();
    mine.forEach((s) => by.set(s.kind, [...(by.get(s.kind) || []), s]));
    const best = [...by.entries()].filter(([k]) => FOR[k] && k !== 'long shot').sort((a, b) => sum(b[1]) - sum(a[1]))[0];
    if (best && sum(best[1]) >= xgM * 0.4) c.push({ tone: 'good', w: 0.8 + sum(best[1]), text: `Most of your danger came from ${FOR[best[0]]}: ${f2(sum(best[1]))} xG.` });
  }

  // ---- finishing, yours and theirs (this part is mostly luck)
  if (gM - xgM <= -1) c.push({ tone: 'luck', w: 1.2 + (xgM - gM), text: `You made ${f2(xgM)} xG and scored ${gM}. On another day that is ${Math.round(xgM - gM)} more.` });
  if (gM - xgM >= 1) c.push({ tone: 'luck', w: 1 + (gM - xgM), text: `You scored ${gM} from ${f2(xgM)} xG: very clinical.` });
  if (gO - xgO >= 1) c.push({ tone: 'luck', w: 1.2 + (gO - xgO), text: `They scored ${gO} from ${f2(xgO)} xG: nearly everything went in.` });
  if (gO - xgO <= -1) c.push({ tone: 'luck', w: 1 + (xgO - gO), text: `They wasted ${f2(xgO)} xG and scored ${gO}. A lucky escape.` });

  // ---- a lead thrown away late, and whether someone sat back first
  const goals = rep.events.filter((e) => e.type === 'goal');
  let lead = 0, leadAt = -1, leadScore = '';
  for (const g of goals) {
    const was = lead;
    lead += g.side === me ? 1 : -1;
    if (lead > 0 && was <= 0) { leadAt = g.m; }
    if (was > 0 && lead <= 0 && leadAt >= 0 && g.m >= 70) {
      const score = (k: 0 | 1) => goals.filter((x) => x.m <= g.m && x.side === k && x !== g).length;
      leadScore = `${score(me)}–${score(op)}`;
      const sat = rep.events.filter((e) => e.type === 'tactic' && e.side === me && e.m >= leadAt && e.m <= g.m && /sit back|parking the bus/.test(e.text)).pop();
      const who = sat ? (sat.text.includes('switch to') ? 'You' : 'Your assistant') : '';
      c.push({
        tone: 'bad', w: 3.2,
        text: sat ? `You led ${leadScore}. ${who} sat back at ${min(sat.m)} and they scored at ${min(g.m)}.` : `You led ${leadScore} and let it slip at ${min(g.m)}.`,
        tip: sat && who === 'Your assistant' ? 'Sitting back invites pressure. In Match plan › More, untick "Shut it down when winning" to keep your plan to the end.' : 'Late on, fresh legs keep a lead better than a deep block: make your changes before 75\'.',
      });
    }
  }

  // ---- did a change of plan turn the match?
  const rate = (side: 0 | 1, from: number, to: number) => shots.filter((s) => s.side === side && s.m >= from && s.m < to).reduce((a, s) => a + s.xg, 0) / Math.max(5, to - from);
  for (const e of rep.events.filter((x) => x.type === 'tactic' && x.text.includes(' switch to ') && x.m >= 10 && x.m <= 80)) {
    const what = e.text.split(' switch to ')[1];
    const after = shots.filter((s) => s.side === e.side && s.m >= e.m);
    const xAfter = sum(after);
    const before = rate(e.side, 0, e.m), now = rate(e.side, e.m, 95);
    if (e.side === op && xAfter >= 1 && now >= before * 1.7) {
      c.push({ tone: 'bad', w: 1.5 + xAfter * 0.6, text: `After they switched to ${what} at ${min(e.m)}, they made ${f2(xAfter)} xG.`, tip: 'When they change plan, change back: the analyst shows which plan beats theirs.' });
    } else if (e.side === me && xAfter >= 0.8 && now >= before * 1.6) {
      c.push({ tone: 'good', w: 1.2 + xAfter * 0.5, text: `Your switch to ${what} at ${min(e.m)} worked: ${f2(xAfter)} xG after it.` });
    } else if (e.side === me && e.m <= 70 && before > 0.02 && now <= before * 0.5) {
      c.push({ tone: 'bad', w: 1.3, text: `After your switch to ${what} at ${min(e.m)}, your attack dried up.`, tip: 'If a change does not work within ten minutes, go back to what did.' });
    }
  }

  // ---- red cards and tired legs
  for (const e of rep.events.filter((x) => x.type === 'red' && x.side === me)) {
    if (e.m <= 80) c.push({ tone: 'bad', w: 2.6 + (90 - e.m) / 30, text: `A red card at ${min(e.m)}: you played ${90 - e.m} minutes with ten men.`, tip: 'With hard tackling and a strict referee, cards fly. Stay on your feet next time.' });
  }
  const tired = rep.players.filter((p) => p.side === me && p.mins >= 60 && p.fitEnd < 35);
  if (tired.length >= 2) {
    c.push({ tone: 'bad', w: 1 + tired.length * 0.4, text: `${tired.length} of your players finished on empty legs (${tired.slice(0, 3).map((p) => p.name.split(' ').pop()).join(', ')}).`,
      tip: 'Tired players lose duels late on. Rotate them and check Condition before kick-off.' });
  }

  // the three that mattered most; after a defeat the reasons first, after a win what worked first
  const order = (x: Cand) => x.w + (gM < gO && x.tone === 'bad' ? 1 : gM > gO && x.tone === 'good' ? 1 : 0);
  const picked = c.sort((a, b) => order(b) - order(a)).slice(0, 3);
  if (!picked.length) picked.push({ tone: 'luck', w: 0, text: xgM + xgO < 1.6 ? 'A tight, cagey match: few real chances at either end.' : 'Nothing stood out: both sides made their chances, and the finishing decided it.' });
  const tip = picked.find((x) => x.tip)?.tip || c.find((x) => x.tip)?.tip
    || (gM >= gO ? 'This plan works. Keep it, and watch for their changes during the match.' : null);
  void names;
  return { title, tone, line, reasons: picked.map(({ tone, text }) => ({ tone, text })), tip };
}
