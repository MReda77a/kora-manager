// Big-match press conferences (derbies and cup finals).
// Before the match each manager faces five questions picked from a large bank, chosen by the
// situation: the table, who is stronger, form, the last meeting, star players, the referee, the
// fans and what the rival manager already said. Every answer has a price: lifting your own team
// can fire up theirs, attacking the referee makes him watch you, promising a win raises the stakes.
// What you say is printed in the league news, and the rival is told about it.
import { q, one, type Row } from './db.ts';
import { fail } from './errors.ts';
import { conditionsFor } from './game.ts';
import { getLeague, myClub, news, standings } from './league.ts';
import { hashSeed, rng } from './rng.ts';
import { notify } from './push.ts';
import { isDerby, previewSides } from './season.ts';
import { strengthOf } from './today.ts';
import type { ESide } from './engine.ts';

// ---------------------------------------------------------------- tones and effects
export const TONES = {
  calm: { face: '🙂', name: 'Calm' },
  humble: { face: '🙏', name: 'Humble' },
  bold: { face: '😎', name: 'Confident' },
  fiery: { face: '😠', name: 'Fiery' },
  witty: { face: '😏', name: 'Witty' },
  mind: { face: '🧠', name: 'Mind games' },
} as const;
export type Tone = keyof typeof TONES;

/** what an answer does. morale: your team; fire: fires THEM up; doubt: puts THEM off;
 *  ref: referee strictness on you (1 = normal); crowd: your fans; stake: how much the result
 *  moves the board and the fans; pmod: one player's form; fans: fans gained now */
export type Fx = { morale?: number; fire?: number; doubt?: number; ref?: number; crowd?: number; stake?: number; pmod?: { who: Who; v: number }; fans?: number };
type Who = 'myStar' | 'scorer' | 'struggler' | 'captain' | 'keeper';

const BASE: Record<Tone, Fx> = {
  calm: { morale: 0.2 },
  humble: { morale: 0.1, stake: -0.4, doubt: 0.1 },
  bold: { morale: 0.6, fire: 0.35, stake: 0.6 },
  fiery: { morale: 0.85, fire: 0.75, stake: 0.8, crowd: 0.3 },
  witty: { morale: 0.35, fire: 0.15, fans: 400 },
  mind: { morale: 0.2, doubt: 0.45 },
};

export type Ctx = {
  me: string; opp: string; oppMgr: string; human: boolean; venue: 'home' | 'away'; stadium: string;
  myPos: number | null; oppPos: number | null; pts: number; // points gap: positive = we are ahead
  edge: number; // strength gap in engine points: positive = we are stronger
  fav: 'fav' | 'dog' | 'even';
  myForm: string[]; oppForm: string[]; streak: { k: 'W' | 'L' | 'U' | null; n: number }; oppStreak: { k: 'W' | 'L' | 'U' | null; n: number };
  h2h: { res: 'W' | 'D' | 'L'; score: string } | null;
  myStar: string; oppStar: string; scorer: string | null; goals: number; struggler: string | null; cap: string | null; keeper: string | null; injured: string | null;
  ref: string; strict: number; weather: string;
  final: boolean; derby: boolean; boardLow: boolean; rival: { text: string; tone: Tone } | null;
  ids: Partial<Record<Who, string>>;
};

const ord = (n: number | null) => (n == null ? '?' : `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`);
const last = (n: string | null) => (n ? n.split(' ').slice(-1)[0] : '');
const big = (c: Ctx) => (c.final ? 'the final' : 'the derby');

type Ans = { tone: Tone; say: string[]; fx?: Fx; react?: string[] };
type Q = { id: string; cat: string; w?: number; when?: (c: Ctx) => boolean; ask: (c: Ctx) => string[]; answers: (c: Ctx) => Ans[] };

// ---------------------------------------------------------------- the question bank
const BANK: Q[] = [
  // ---- openers
  {
    id: 'open-feel', cat: 'open',
    ask: (c) => [`How are you feeling going into ${big(c)} against ${c.opp}?`, `Big one tomorrow. What's the mood in the ${c.me} camp?`, `${big(c)[0].toUpperCase() + big(c).slice(1)} is here. Nervous?`],
    answers: (c) => [
      { tone: 'calm', say: [`Focused. It's three points like any other, and we'll treat it that way.`, `Calm. The players know what to do.`] },
      { tone: 'bold', say: [`Never better. My players can't wait to get out there.`, `Nervous? We've been counting down the days.`] },
      { tone: 'fiery', say: [`This one is personal. Everybody in this club knows what it means. We are going to war.`, `I don't want calm tomorrow. I want blood and thunder.`] },
      { tone: 'witty', say: [`I slept like a baby. Woke up every two hours and cried.`, `Nervous? I've already chewed through three pens this morning.`] },
    ],
  },
  {
    id: 'open-message', cat: 'open',
    ask: (c) => [`Any message for the ${c.me} supporters before ${big(c)}?`, `What do you want to say to your fans tonight?`],
    answers: (c) => [
      { tone: 'calm', say: [`Thank you. Bring the noise, and we'll bring everything we have.`] },
      { tone: 'fiery', say: [`Make it hell for them. Ninety minutes, no breathing space.`, `I want ${c.venue === 'home' ? c.stadium : 'our end'} shaking. They have to feel it.`], fx: { crowd: 0.6, morale: 0.5, fire: 0.3, stake: 0.6 } },
      { tone: 'bold', say: [`Get the party ready. Tomorrow night is ours.`], fx: { crowd: 0.4, stake: 1.0, morale: 0.5 } },
      { tone: 'humble', say: [`Stay with us whatever happens. We need you more than ever.`], fx: { crowd: 0.3, stake: -0.5 } },
    ],
  },
  {
    id: 'open-prep', cat: 'open',
    ask: () => [`How has the week of preparation gone?`, `Talk us through your preparation for this one.`],
    answers: (c) => [
      { tone: 'calm', say: [`Normal week. Good sessions, no drama.`] },
      { tone: 'mind', say: [`We've watched every one of their matches this season. Twice. There are no secrets left.`, `Let's just say we've prepared something special. They'll find out at kick-off.`] },
      { tone: 'witty', say: [`Lots of video. Lots of coffee. Not much sleep. The usual.`] },
      { tone: 'bold', say: [`Sharpest I've seen this group all season. ${c.opp} picked the wrong week to play us.`] },
    ],
  },

  // ---- the table
  {
    id: 'table-above', cat: 'table', when: (c) => c.myPos != null && c.oppPos != null && c.pts > 0,
    ask: (c) => [`You're ${ord(c.myPos)}, ${c.opp} are ${ord(c.oppPos)}, ${c.pts} point${c.pts === 1 ? '' : 's'} behind you. Does the table matter tomorrow?`, `${c.pts} point${c.pts === 1 ? '' : 's'} clear of ${c.opp}. Can you stretch the gap?`],
    answers: (c) => [
      { tone: 'calm', say: [`The table never matters in a game like this. Form goes out of the window.`] },
      { tone: 'bold', say: [`The table doesn't lie. We are above them for a reason.`, `Stretch it? I want to bury them in the table.`] },
      { tone: 'fiery', say: [`They've been looking up at us all season and they'll be looking up at us after tomorrow.`] },
      { tone: 'humble', say: [`A few points is nothing. They can catch us with one good night.`] },
    ],
  },
  {
    id: 'table-below', cat: 'table', when: (c) => c.myPos != null && c.oppPos != null && c.pts < 0,
    ask: (c) => [`${c.opp} are ${-c.pts} point${c.pts === -1 ? '' : 's'} ahead of you. Is this a chance to close the gap?`, `You're ${ord(c.myPos)} and they're ${ord(c.oppPos)}. Are they simply better than you this season?`],
    answers: (c) => [
      { tone: 'calm', say: [`One game at a time. Win tomorrow and the gap takes care of itself.`] },
      { tone: 'bold', say: [`Better? Ask me again after the final whistle.`, `The table says they're ahead. The table hasn't played us yet.`], fx: { morale: 0.8, fire: 0.25, stake: 0.8 } },
      { tone: 'fiery', say: [`They've had it easy. Tomorrow they meet a team that's sick of hearing their name.`] },
      { tone: 'humble', say: [`They've earned their place. We have to be at our very best.`], fx: { morale: 0.1, doubt: 0.3, stake: -0.6 } },
    ],
  },
  {
    id: 'table-level', cat: 'table', when: (c) => c.myPos != null && c.pts === 0,
    ask: (c) => [`You're level on points with ${c.opp}. Who blinks first?`, `Nothing between you in the table. Is tomorrow a six-pointer?`],
    answers: () => [
      { tone: 'calm', say: [`It's three points. Big ones, but three points.`] },
      { tone: 'bold', say: [`Not us. We don't blink.`] },
      { tone: 'mind', say: [`They do. They've been looking over their shoulder at us for weeks.`] },
      { tone: 'witty', say: [`I've been practising not blinking in the mirror all week. I think I'm ready.`] },
    ],
  },
  {
    id: 'table-title', cat: 'table', w: 1.4, when: (c) => c.myPos != null && c.myPos <= 2,
    ask: (c) => [`You're ${ord(c.myPos)}. Is ${big(c)} the night your title challenge is made or broken?`, `Can a team that wants the title afford to slip up here?`],
    answers: () => [
      { tone: 'calm', say: [`Nothing is decided tomorrow. There's a long way to go.`], fx: { morale: 0.2, stake: -0.3 } },
      { tone: 'bold', say: [`Champions win nights like this. Simple as that.`], fx: { morale: 0.7, fire: 0.3, stake: 1.1 } },
      { tone: 'humble', say: [`Title? Let's not get carried away. We just want to win a football match.`] },
      { tone: 'fiery', say: [`If we can't win this one, we don't deserve the trophy. I've told the players exactly that.`], fx: { morale: 1.0, fire: 0.3, stake: 1.3 } },
    ],
  },
  {
    id: 'table-bottom', cat: 'table', w: 1.2, when: (c) => c.myPos != null && c.myPos >= 6,
    ask: (c) => [`You're down in ${ord(c.myPos)}. Can ${big(c)} save your season?`, `It hasn't been a great season. Is this your chance to put it right?`],
    answers: () => [
      { tone: 'calm', say: [`Our season is long. But yes, a win here would change the mood.`] },
      { tone: 'fiery', say: [`Write us off. Go on. That's exactly what I want you to do.`], fx: { morale: 1.0, fire: 0.1, stake: 0.5 } },
      { tone: 'humble', say: [`We've let our fans down. Tomorrow we have to give them something back.`], fx: { morale: 0.4, stake: -0.2, crowd: 0.3 } },
      { tone: 'bold', say: [`One derby win and nobody will remember the table.`] },
    ],
  },

  // ---- favourite or underdog
  {
    id: 'str-fav', cat: 'strength', when: (c) => c.fav === 'fav',
    ask: (c) => [`On paper you're the stronger side. Is there a danger of complacency?`, `Everyone expects ${c.me} to win. Is that pressure or confidence?`],
    answers: (c) => [
      { tone: 'calm', say: [`Paper doesn't win matches. My players know that.`], fx: { morale: 0.35 } },
      { tone: 'bold', say: [`We are the better team. We'll show it.`, `Pressure is a privilege. We're the favourites because we've earned it.`], fx: { morale: 0.4, fire: 0.6, stake: 0.9 } },
      { tone: 'humble', say: [`${c.opp} are dangerous. Anyone who thinks this is easy hasn't watched them.`], fx: { morale: 0.3, doubt: 0.15, stake: -0.6 } },
      { tone: 'fiery', say: [`If we lose this, I'll be the first to say it: unacceptable.`], fx: { morale: 0.8, fire: 0.3, stake: 1.4 } },
    ],
  },
  {
    id: 'str-dog', cat: 'strength', when: (c) => c.fav === 'dog',
    ask: (c) => [`${c.opp} look stronger on paper. How do you beat them?`, `Most people expect you to lose tomorrow. Do they have a point?`],
    answers: (c) => [
      { tone: 'calm', say: [`We stay organised, we stay patient, and we take our chances.`] },
      { tone: 'bold', say: [`Let them think that. Underdogs bite.`, `Paper? I'll give them some paper. They can write their excuses on it.`], fx: { morale: 1.0, fire: 0.2, stake: 0.8 } },
      { tone: 'humble', say: [`They're better than us. We need a perfect night.`], fx: { morale: -0.2, doubt: 0.35, stake: -0.9 } },
      { tone: 'mind', say: [`All the pressure is on them. If they don't win, it's a disaster for them. For us it's a free hit.`], fx: { morale: 0.5, doubt: 0.55 } },
    ],
  },
  {
    id: 'str-even', cat: 'strength', when: (c) => c.fav === 'even',
    ask: () => [`The two squads look very even. What decides a match like this?`, `Hard to split these two teams. Where will it be won?`],
    answers: (c) => [
      { tone: 'calm', say: [`Small details. A set piece, a mistake, a moment of quality.`] },
      { tone: 'bold', say: [`Hunger. And nobody is hungrier than us.`] },
      { tone: 'mind', say: [`Nerves. And I know which dressing room will be the quieter one tomorrow.`] },
      { tone: 'witty', say: [`Probably ${c.myStar}. Don't tell him I said that, his head is big enough.`], fx: { morale: 0.3, pmod: { who: 'myStar', v: 1 }, fans: 300 } },
    ],
  },

  // ---- form
  {
    id: 'form-good', cat: 'form', when: (c) => c.streak.k === 'W' && c.streak.n >= 2 || c.streak.k === 'U' && c.streak.n >= 3,
    ask: (c) => [`${c.streak.n} ${c.streak.k === 'W' ? 'wins' : 'games unbeaten'} in a row. Are you unstoppable right now?`, `You're flying. Does a run like this make you favourites tomorrow?`],
    answers: () => [
      { tone: 'calm', say: [`Every run ends sometime. We just make sure it isn't tomorrow.`] },
      { tone: 'bold', say: [`Unstoppable? Ask the last few teams who tried.`], fx: { morale: 0.7, fire: 0.5, stake: 0.8 } },
      { tone: 'humble', say: [`Form counts for nothing in a game like this. We start from zero.`] },
      { tone: 'witty', say: [`I'm not changing my socks until we lose. My wife is praying they beat us.`], fx: { morale: 0.4, fire: 0.1, fans: 500 } },
    ],
  },
  {
    id: 'form-bad', cat: 'form', when: (c) => c.streak.k === 'L' && c.streak.n >= 2,
    ask: (c) => [`${c.streak.n} defeats in a row. Is this the worst possible time to face ${c.opp}?`, `Results haven't been good. Is the dressing room still with you?`],
    answers: (c) => [
      { tone: 'calm', say: [`We've been unlucky, not bad. That changes tomorrow.`] },
      { tone: 'fiery', say: [`Worst time? It's the best time. My players are angry, and angry is good.`], fx: { morale: 1.1, fire: 0.3, stake: 0.7, ref: 1.1 } },
      { tone: 'humble', say: [`We've not been good enough. I take the blame, all of it.`], fx: { morale: 0.5, stake: -0.6 } },
      { tone: 'mind', say: [`${c.opp} will think we're there for the taking. Let them.`], fx: { morale: 0.4, doubt: 0.2 } },
    ],
  },
  {
    id: 'form-theirs-hot', cat: 'form', when: (c) => c.oppStreak.k === 'W' && c.oppStreak.n >= 2,
    ask: (c) => [`${c.opp} have won ${c.oppStreak.n} in a row. How do you stop them?`, `They're in great form. Does that worry you?`],
    answers: (c) => [
      { tone: 'calm', say: [`Good teams have good runs. We've prepared for the best version of them.`] },
      { tone: 'bold', say: [`Every run needs someone to end it. Why not us?`] },
      { tone: 'mind', say: [`Good runs make teams comfortable. Comfortable teams get caught.`], fx: { morale: 0.3, doubt: 0.5 } },
      { tone: 'witty', say: [`They've been beating teams that weren't us.`], fx: { morale: 0.5, fire: 0.35, fans: 400 } },
    ],
  },
  {
    id: 'form-theirs-cold', cat: 'form', when: (c) => c.oppStreak.k === 'L' && c.oppStreak.n >= 2,
    ask: (c) => [`${c.opp} have lost their last ${c.oppStreak.n}. Is this the perfect time to play them?`, `They're struggling. Are you expecting an easy night?`],
    answers: (c) => [
      { tone: 'calm', say: [`There's no such thing as an easy derby. A wounded team is a dangerous team.`], fx: { morale: 0.3 } },
      { tone: 'bold', say: [`We'll put them out of their misery.`], fx: { morale: 0.5, fire: 0.9, stake: 0.9 } },
      { tone: 'mind', say: [`I feel for ${c.oppMgr}. It's lonely when the results don't come. Tomorrow won't help.`], fx: { morale: 0.3, doubt: 0.6, fire: 0.2 } },
      { tone: 'humble', say: [`Form means nothing tomorrow. They'll raise their game.`] },
    ],
  },

  // ---- the last meeting
  {
    id: 'h2h-won', cat: 'h2h', when: (c) => c.h2h?.res === 'W',
    ask: (c) => [`You won the last meeting ${c.h2h!.score}. Do you have their number?`, `Last time out you beat them ${c.h2h!.score}. Same again?`],
    answers: (c) => [
      { tone: 'calm', say: [`That game is history. They'll have learned from it.`] },
      { tone: 'bold', say: [`We know how to beat them. We've done it before and we'll do it again.`] },
      { tone: 'witty', say: [`I've got that match on DVD. I watch it before bed.`], fx: { morale: 0.4, fire: 0.5, fans: 600 } },
      { tone: 'fiery', say: [`They've been thinking about that night ever since. Good. Let them think.`] },
    ],
  },
  {
    id: 'h2h-lost', cat: 'h2h', when: (c) => c.h2h?.res === 'L',
    ask: (c) => [`They beat you ${c.h2h!.score.split('-').reverse().join('-')} last time. Is this about revenge?`, `How much has that last defeat against ${c.opp} hurt?`],
    answers: () => [
      { tone: 'calm', say: [`Revenge is for films. We want three points.`] },
      { tone: 'fiery', say: [`It's still burning. Every player in that dressing room remembers it.`], fx: { morale: 1.1, fire: 0.4, stake: 0.7 } },
      { tone: 'humble', say: [`They were better than us that day. Fair play to them.`], fx: { morale: 0.1, doubt: 0.2, stake: -0.4 } },
      { tone: 'bold', say: [`That was a different team. We've grown up since then.`] },
    ],
  },
  {
    id: 'h2h-draw', cat: 'h2h', when: (c) => c.h2h?.res === 'D',
    ask: (c) => [`It finished ${c.h2h!.score} last time. Who's going to find the winner tomorrow?`],
    answers: (c) => [
      { tone: 'calm', say: [`Whoever makes fewer mistakes.`] },
      { tone: 'bold', say: [`${c.myStar}. Put your money on it.`], fx: { morale: 0.5, pmod: { who: 'myStar', v: 2 }, fire: 0.3, stake: 0.5 } },
      { tone: 'witty', say: [`Draws are like kissing your sister. I'm not doing that twice.`], fx: { morale: 0.5, fans: 500 } },
      { tone: 'mind', say: [`They were happy with a draw last time. That tells you everything about their ambition.`], fx: { morale: 0.3, doubt: 0.4, fire: 0.2 } },
    ],
  },
  {
    id: 'h2h-first', cat: 'h2h', w: 0.7, when: (c) => !c.h2h,
    ask: (c) => [`This is the first time you've faced ${c.opp}. What do you know about them?`],
    answers: (c) => [
      { tone: 'calm', say: [`Enough. We've done our homework.`] },
      { tone: 'mind', say: [`More than they know about us. That's a promise.`], fx: { morale: 0.3, doubt: 0.5 } },
      { tone: 'witty', say: [`They wear shirts, they kick a ball. I'll know more at half-time.`], fx: { morale: 0.3, fire: 0.3, fans: 400 } },
      { tone: 'bold', say: [`I know they've never played anyone like us.`] },
    ],
  },

  // ---- players
  {
    id: 'pl-oppstar', cat: 'oppstar', w: 1.3,
    ask: (c) => [`How do you stop ${c.oppStar}?`, `${c.oppStar} is their key man. Does he worry you?`, `Is ${last(c.oppStar)} the best player in this match?`],
    answers: (c) => [
      { tone: 'calm', say: [`As a team. One player can't stop him, eleven can.`], fx: { morale: 0.3 } },
      { tone: 'bold', say: [`He hasn't met our back line yet.`, `He's good. ${c.myStar} is better.`], fx: { morale: 0.5, fire: 0.4, pmod: { who: 'myStar', v: 1 } } },
      { tone: 'mind', say: [`He's a good player. A bit over-hyped, if I'm honest. Let's see how he likes being kicked for ninety minutes.`], fx: { morale: 0.3, doubt: 0.45, ref: 1.15, fire: 0.2 } },
      { tone: 'humble', say: [`He's world class. We'll need our best defensive performance of the season.`], fx: { morale: 0.1, doubt: 0.1, stake: -0.4 } },
    ],
  },
  {
    id: 'pl-mystar', cat: 'mystar', w: 1.1,
    ask: (c) => [`${c.myStar} is your best player. How important is he tomorrow?`, `Is ${last(c.myStar)} ready for a night like this?`],
    answers: (c) => [
      { tone: 'calm', say: [`Important, like everyone. We don't rely on one man.`] },
      { tone: 'bold', say: [`He's the best player in this league and tomorrow he proves it.`], fx: { morale: 0.4, fire: 0.3, pmod: { who: 'myStar', v: 2 }, stake: 0.4 } },
      { tone: 'witty', say: [`I've told him if he scores he can pick the music on the bus for a month.`], fx: { morale: 0.4, pmod: { who: 'myStar', v: 1 }, fans: 300 } },
      { tone: 'humble', say: [`I'd rather not put pressure on him. Let him play.`], fx: { morale: 0.2 } },
    ],
  },
  {
    id: 'pl-scorer', cat: 'scorer', when: (c) => !!c.scorer && c.goals >= 2,
    ask: (c) => [`${c.scorer} has ${c.goals} goals this season. Can he decide ${big(c)}?`, `Will ${last(c.scorer)} score tomorrow?`],
    answers: (c) => [
      { tone: 'calm', say: [`If the chances come, he usually takes them.`] },
      { tone: 'bold', say: [`I'd bet my house on it.`], fx: { morale: 0.4, pmod: { who: 'scorer', v: 2 }, stake: 0.4, fire: 0.2 } },
      { tone: 'witty', say: [`He'll score. He'll celebrate in front of their fans. I'll pretend to be angry about it.`], fx: { morale: 0.5, fire: 0.5, crowd: 0.2, pmod: { who: 'scorer', v: 1 } } },
      { tone: 'humble', say: [`Goals come from the whole team. I won't single him out.`], fx: { morale: 0.3 } },
    ],
  },
  {
    id: 'pl-struggler', cat: 'struggler', when: (c) => !!c.struggler,
    ask: (c) => [`${c.struggler} has struggled lately. Does he keep his place?`, `Fans are questioning ${last(c.struggler)}. What do you say to them?`],
    answers: (c) => [
      { tone: 'calm', say: [`He's a good player having a quiet spell. It happens.`], fx: { morale: 0.2, pmod: { who: 'struggler', v: 1 } } },
      { tone: 'bold', say: [`I trust him completely. Watch him tomorrow.`], fx: { morale: 0.3, pmod: { who: 'struggler', v: 3 }, stake: 0.3 } },
      { tone: 'fiery', say: [`He knows it isn't good enough. He has one night to show me he cares.`], fx: { morale: 0.2, pmod: { who: 'struggler', v: 0 } } },
      { tone: 'humble', say: [`That's my fault. I've played him out of his best role.`], fx: { morale: 0.3, pmod: { who: 'struggler', v: 2 } } },
    ],
  },
  {
    id: 'pl-captain', cat: 'captain', when: (c) => !!c.cap,
    ask: (c) => [`What does ${c.cap} mean to this team on a night like this?`, `Your captain, ${last(c.cap)}. What will you say to him before kick-off?`],
    answers: (c) => [
      { tone: 'calm', say: [`He's the voice in the dressing room. He keeps everybody's heads cool.`], fx: { morale: 0.3, ref: 0.95 } },
      { tone: 'fiery', say: [`I'll tell him to lead from the front and make them feel every tackle.`], fx: { morale: 0.7, ref: 1.15, fire: 0.3, pmod: { who: 'captain', v: 1 } } },
      { tone: 'bold', say: [`I don't need to say anything. He was born for these games.`], fx: { morale: 0.5, pmod: { who: 'captain', v: 2 } } },
      { tone: 'witty', say: [`"Don't get booked in the first minute." Same speech every week.`], fx: { morale: 0.3, ref: 0.95, fans: 300 } },
    ],
  },
  {
    id: 'pl-injured', cat: 'injury', when: (c) => !!c.injured,
    ask: (c) => [`${c.injured} misses out. How big a blow is that?`],
    answers: (c) => [
      { tone: 'calm', say: [`A big player, but the next man is ready.`] },
      { tone: 'bold', say: [`We'll win it for him.`], fx: { morale: 0.8, stake: 0.6 } },
      { tone: 'humble', say: [`Huge. You don't replace a player like that overnight.`], fx: { morale: -0.2, doubt: 0.2, stake: -0.6 } },
      { tone: 'mind', say: [`Who says he misses out? You'll see the team sheet when ${c.opp} do.`], fx: { morale: 0.2, doubt: 0.4 } },
    ],
  },
  {
    id: 'pl-keeper', cat: 'keeper', w: 0.6, when: (c) => !!c.keeper,
    ask: (c) => [`Your keeper ${c.keeper} could be busy tomorrow. Is he ready?`],
    answers: () => [
      { tone: 'calm', say: [`He's been excellent in training. No concerns.`] },
      { tone: 'bold', say: [`They'll need a rocket to beat him.`], fx: { morale: 0.4, pmod: { who: 'keeper', v: 2 }, fire: 0.2 } },
      { tone: 'witty', say: [`He's been diving at shadows all week. He's ready.`], fx: { morale: 0.3, pmod: { who: 'keeper', v: 1 }, fans: 200 } },
    ],
  },

  // ---- the referee
  {
    id: 'ref-strict', cat: 'ref', when: (c) => c.strict === 2,
    ask: (c) => [`${c.ref} is in charge, one of the strictest referees around. Will you tell your players to calm down?`, `${c.ref} hands out a lot of cards. Does that change your approach?`],
    answers: (c) => [
      { tone: 'calm', say: [`We'll respect the referee and keep eleven men on the pitch.`], fx: { morale: 0.2, ref: 0.85 } },
      { tone: 'fiery', say: [`I hope he's strict with both teams. Last time he wasn't.`], fx: { morale: 0.5, ref: 1.3, fire: 0.2, fans: 300 } },
      { tone: 'mind', say: [`I'm more worried about ${c.opp}. Their players love a dive.`], fx: { morale: 0.2, doubt: 0.3, ref: 1.15, fire: 0.4 } },
      { tone: 'witty', say: [`I've asked him to save some yellow cards for the other games this weekend.`], fx: { morale: 0.3, ref: 1.0, fans: 400 } },
    ],
  },
  {
    id: 'ref-any', cat: 'ref', w: 0.8, when: (c) => c.strict !== 2,
    ask: (c) => [`${c.ref} is the referee. Any thoughts?`, `What do you expect from ${c.ref} tomorrow?`],
    answers: (c) => [
      { tone: 'calm', say: [`A good referee. I'm sure he'll have a good game.`], fx: { ref: 0.9 } },
      { tone: 'fiery', say: [`I want a fair game. That would make a change against ${c.opp}.`], fx: { morale: 0.5, ref: 1.25, fire: 0.3, fans: 300 } },
      { tone: 'witty', say: [`I've sent him a fruit basket. Completely unrelated.`], fx: { morale: 0.2, ref: 1.05, fans: 500 } },
      { tone: 'mind', say: [`He'll have the cameras on him. I just hope he's brave enough to give us what we deserve.`], fx: { morale: 0.2, ref: 1.1, doubt: 0.2 } },
    ],
  },

  // ---- the fans and the venue
  {
    id: 'fans-home', cat: 'fans', when: (c) => c.venue === 'home',
    ask: (c) => [`You're at home. How much will the crowd at ${c.stadium} matter?`, `It'll be a full house at ${c.stadium}. Is that worth a goal?`],
    answers: (c) => [
      { tone: 'calm', say: [`Our fans are always a lift. We have to give them something to shout about.`], fx: { crowd: 0.3 } },
      { tone: 'fiery', say: [`I want them on their feet from the warm-up. Make ${c.opp} wish they'd stayed at home.`], fx: { crowd: 0.8, morale: 0.4, fire: 0.3, stake: 0.5 } },
      { tone: 'bold', say: [`Worth two. Nobody comes to our place and wins on derby day.`], fx: { crowd: 0.6, morale: 0.4, stake: 0.8 } },
      { tone: 'witty', say: [`I've asked the groundsman to leave the grass extra long on their side.`], fx: { crowd: 0.4, morale: 0.2, fans: 500 } },
    ],
  },
  {
    id: 'fans-away', cat: 'fans', when: (c) => c.venue === 'away',
    ask: (c) => [`You're away tomorrow. Their fans will be loud. Can your players handle it?`, `${c.stadium} will be a hostile place. How do you silence it?`],
    answers: (c) => [
      { tone: 'calm', say: [`We focus on ourselves. Noise is just noise.`], fx: { morale: 0.3 } },
      { tone: 'fiery', say: [`We'll make it so quiet you can hear the players breathing.`], fx: { morale: 0.6, fire: 0.6, crowd: 0.3, stake: 0.7 } },
      { tone: 'bold', say: [`My players love playing away. Fifty thousand people telling you you're rubbish? That's motivation.`] },
      { tone: 'mind', say: [`Their fans get nervous quickly. Score first and the crowd turns on them.`], fx: { morale: 0.3, doubt: 0.5 } },
    ],
  },

  // ---- the rival manager
  {
    id: 'mgr-respect', cat: 'mgr', when: (c) => c.human,
    ask: (c) => [`What do you make of ${c.oppMgr} as a manager?`, `Is ${c.oppMgr} a friend or a rival?`],
    answers: (c) => [
      { tone: 'calm', say: [`I respect him. We'll shake hands before and after.`], fx: { morale: 0.1, ref: 0.95 } },
      { tone: 'witty', say: [`A friend for 364 days a year. Tomorrow isn't one of them.`], fx: { morale: 0.4, fire: 0.2, fans: 500 } },
      { tone: 'mind', say: [`He's done well with what he has. I'd be nervous in his shoes.`], fx: { morale: 0.2, doubt: 0.5, fire: 0.2 } },
      { tone: 'fiery', say: [`He talks a lot. Tomorrow we'll see if he can coach as well as he talks.`], fx: { morale: 0.6, fire: 0.8, stake: 0.8, fans: 400 } },
    ],
  },
  {
    id: 'mgr-predict', cat: 'predict', w: 1.1,
    ask: () => [`Give us a prediction.`, `Score prediction for tomorrow?`],
    answers: (c) => [
      { tone: 'calm', say: [`A win. The score doesn't matter.`], fx: { morale: 0.2, stake: 0.2 } },
      { tone: 'bold', say: [`3-0. And I'm being kind.`, `Comfortable win. Write it down.`], fx: { morale: 0.6, fire: 0.7, stake: 1.2 } },
      { tone: 'humble', say: [`I'd take a 1-0 right now and run.`], fx: { morale: 0.1, stake: -0.6 } },
      { tone: 'witty', say: [`${c.me} 5, ${c.opp} 4. Nobody defends. Everybody goes home happy except the coaches.`], fx: { morale: 0.3, fans: 600 } },
    ],
  },
  {
    id: 'mgr-swap', cat: 'swap', w: 0.8,
    ask: (c) => [`Is there any player at ${c.opp} you'd like in your team?`, `If you could take one ${c.opp} player, who would it be?`],
    answers: (c) => [
      { tone: 'calm', say: [`I'm happy with my squad.`], fx: { morale: 0.4 } },
      { tone: 'witty', say: [`Their kit man. Their shirts always look better ironed.`], fx: { morale: 0.3, fire: 0.3, fans: 500 } },
      { tone: 'mind', say: [`${c.oppStar}. Between you and me, I hear he isn't happy there.`], fx: { morale: 0.1, doubt: 0.6, fire: 0.1 } },
      { tone: 'bold', say: [`None of them would get in my team.`], fx: { morale: 0.6, fire: 0.8, stake: 0.6 } },
    ],
  },

  // ---- the board and the pressure
  {
    id: 'board-low', cat: 'board', w: 1.5, when: (c) => c.boardLow,
    ask: (c) => [`There are reports the board is losing patience. Is your job on the line tomorrow?`, `Lose ${big(c)} and are you out of a job?`],
    answers: () => [
      { tone: 'calm', say: [`I don't think about my job. I think about the next match.`] },
      { tone: 'fiery', say: [`If they want to sack me, they know where my office is. Tomorrow I'm busy winning a derby.`], fx: { morale: 0.9, stake: 1.0, fire: 0.2 } },
      { tone: 'humble', say: [`The board has every right to expect more. I'll give them more.`], fx: { morale: 0.3, stake: -0.5 } },
      { tone: 'witty', say: [`I've already packed a bag. It's got my lucky scarf in it.`], fx: { morale: 0.3, fans: 400, stake: -0.2 } },
    ],
  },
  {
    id: 'pressure', cat: 'pressure', w: 0.8,
    ask: (c) => [`Who is under more pressure tomorrow, you or ${c.opp}?`, `What happens if you lose ${big(c)}?`],
    answers: (c) => [
      { tone: 'calm', say: [`Both teams. That's what makes it special.`] },
      { tone: 'mind', say: [`Them, no question. They're the ones with something to lose.`], fx: { morale: 0.3, doubt: 0.6 } },
      { tone: 'bold', say: [`Losing isn't something we've talked about.`], fx: { morale: 0.6, stake: 0.8 } },
      { tone: 'humble', say: [`Us. ${c.fav === 'fav' ? 'Everyone expects us to win.' : 'We have to show we belong at this level.'}`], fx: { morale: 0.2, stake: -0.4 } },
    ],
  },

  // ---- conditions
  {
    id: 'weather', cat: 'weather', w: 0.7, when: (c) => c.weather !== 'clear',
    ask: (c) => [`The forecast says ${c.weather === 'rain' ? 'heavy rain' : c.weather === 'snow' ? 'snow' : c.weather === 'wind' ? 'strong wind' : 'scorching heat'}. Does that help one team more?`],
    answers: (c) => [
      { tone: 'calm', say: [`Same for both teams. We'll adapt.`] },
      { tone: 'bold', say: [`We train in worse than this. ${c.opp} won't enjoy it.`], fx: { morale: 0.5, fire: 0.1 } },
      { tone: 'witty', say: [`I've ordered extra-long studs and a very big umbrella for the dugout.`], fx: { morale: 0.3, fans: 300 } },
    ],
  },

  // ---- the cup final
  {
    id: 'final-mean', cat: 'final', w: 2, when: (c) => c.final,
    ask: (c) => [`What would winning the cup mean to ${c.me}?`, `One game from a trophy. How do you keep the players calm?`],
    answers: () => [
      { tone: 'calm', say: [`Everything. But we can't play the occasion. We play the game.`], fx: { morale: 0.5, ref: 0.95 } },
      { tone: 'fiery', say: [`I don't want calm. I want them desperate. Finals are won by the hungrier team.`], fx: { morale: 1.0, ref: 1.15, stake: 1.0 } },
      { tone: 'bold', say: [`Clear a space in the trophy cabinet. We're bringing it home.`], fx: { morale: 0.7, fire: 0.6, stake: 1.4 } },
      { tone: 'humble', say: [`Reaching the final is already a dream. Tomorrow is a bonus.`], fx: { morale: 0.1, stake: -1.0, doubt: 0.2 } },
    ],
  },

  // ---- replying to the rival manager's own words
  {
    id: 'reply', cat: 'reply', w: 99, when: (c) => !!c.rival,
    ask: (c) => [`${c.oppMgr} said yesterday: "${c.rival!.text}" Your reply?`, `Have you seen what ${c.oppMgr} said? "${c.rival!.text}"`],
    answers: (c) => [
      { tone: 'calm', say: [`He can say what he likes. We do our talking on the pitch.`], fx: { morale: 0.4, ref: 0.95 } },
      { tone: 'fiery', say: [`Big words. I'll remind him of them at the final whistle.`, `Print that and stick it on our dressing-room wall. Thank you, ${c.oppMgr}.`], fx: { morale: 1.0, fire: 0.5, stake: 0.8, fans: 300 } },
      { tone: 'witty', say: [`Did he say that? Bless him. Someone get the man a glass of water.`], fx: { morale: 0.5, doubt: 0.3, fire: 0.3, fans: 600 } },
      { tone: 'mind', say: [`When a manager talks that much before a game, he's trying to convince himself.`], fx: { morale: 0.3, doubt: 0.6 } },
    ],
  },

  // ---- wildcards
  {
    id: 'wild-ritual', cat: 'wild', w: 0.6,
    ask: () => [`Any superstitions before a big game?`],
    answers: (c) => [
      { tone: 'calm', say: [`Same routine as always. Coffee, team talk, game.`] },
      { tone: 'witty', say: [`I wear the same tie I wore when we last beat ${c.opp}. It's starting to smell.`], fx: { morale: 0.3, fans: 500 } },
      { tone: 'mind', say: [`I don't need luck. They're the ones who'll need it.`], fx: { morale: 0.3, doubt: 0.4, fire: 0.2 } },
    ],
  },
  {
    id: 'wild-tactics', cat: 'tactics', w: 0.9,
    ask: (c) => [`Can we expect a surprise from you tactically?`, `Will you change your system for ${c.opp}?`],
    answers: (c) => [
      { tone: 'calm', say: [`We'll play our way. It's worked so far.`] },
      { tone: 'mind', say: [`Maybe. Maybe not. ${c.oppMgr} will have to guess.`], fx: { morale: 0.2, doubt: 0.55 } },
      { tone: 'bold', say: [`No secrets. We'll attack them and they know it. Let's see them stop it.`], fx: { morale: 0.6, fire: 0.4, stake: 0.5 } },
      { tone: 'witty', say: [`I'm thinking of playing nine at the back and our goalkeeper up front.`], fx: { morale: 0.3, fans: 400, doubt: 0.15 } },
    ],
  },
  {
    id: 'wild-history', cat: 'history', w: 0.7, when: (c) => c.derby,
    ask: (c) => [`What makes this rivalry with ${c.opp} so special?`],
    answers: (c) => [
      { tone: 'calm', say: [`Two great clubs, two sets of passionate fans. It's why we do this job.`] },
      { tone: 'fiery', say: [`This city has one team. Tomorrow we remind everybody which one.`], fx: { morale: 0.9, fire: 0.8, crowd: 0.4, stake: 0.8, fans: 400 } },
      { tone: 'witty', say: [`The fans hate each other, the players swap shirts, and the managers lose sleep. Perfect.`], fx: { morale: 0.3, fans: 500 } },
      { tone: 'humble', say: [`It's bigger than any player or manager. We're just looking after it for a while.`], fx: { morale: 0.4, ref: 0.95 } },
    ],
  },
];

// how the room reacts to each tone
const REACT: Record<Tone, string[]> = {
  calm: ['Polite nods around the room.', 'A few pens scribble. Nothing for the front page.', 'Measured. The press officer looks relieved.'],
  humble: ['The room goes quiet. Respectful.', 'A journalist raises an eyebrow. Is he lowering expectations?', 'Honest words. The fans will appreciate that.'],
  bold: ['Murmurs in the room. That will be quoted.', 'Cameras flash. Big words.', 'A journalist whistles. Confident.'],
  fiery: ['The room ERUPTS. Every camera fires at once.', 'Gasps. That one will be on the back pages.', 'The press officer puts his head in his hands.'],
  witty: ['Laughter fills the room.', 'Even the cameramen are laughing.', 'A ripple of laughter. Headline material.'],
  mind: ['Whispers around the room. Was that a dig?', 'Knowing looks. The other dressing room will read this.', 'Sly. Very sly.'],
};

// ---------------------------------------------------------------- building a press conference
const caps = { morale: [-1.2, 1.8], fire: [0, 1.4], doubt: [0, 1.0], ref: [0.85, 1.4], crowd: [0, 1.0], stake: [-1.2, 2.0] } as const;
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));
const r2 = (x: number) => Math.round(x * 100) / 100;

export type StoredAnswer = { tone: Tone; text: string; fx: Fx; react: string };
export type StoredQ = { id: string; cat: string; text: string; answers: StoredAnswer[] };

function tune(fx: Fx, c: Ctx, tone: Tone): Fx {
  const f = { ...fx };
  // big words weigh more for an underdog (belief) and backfire on a favourite (they get fired up)
  if ((tone === 'bold' || tone === 'fiery') && c.fav === 'dog') { f.morale = (f.morale || 0) * 1.25; f.stake = (f.stake || 0) * 1.2; }
  if ((tone === 'bold' || tone === 'fiery') && c.fav === 'fav') f.fire = (f.fire || 0) * 1.3;
  // a final makes every word heavier
  if (c.final) for (const k of ['morale', 'fire', 'stake'] as const) if (f[k]) f[k] = f[k]! * 1.15;
  return f;
}

export function buildQuestions(c: Ctx, seed: number, used: Set<string>): StoredQ[] {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r.next() * xs.length)];
  const ok = BANK.filter((b) => !b.when || b.when(c));
  const chosen: Q[] = [];
  const opener = ok.filter((b) => b.cat === 'open');
  chosen.push(opener.filter((b) => !used.has(b.id))[0] ? pick(opener.filter((b) => !used.has(b.id))) : pick(opener));
  const reply = ok.find((b) => b.cat === 'reply');
  if (reply) chosen.push(reply);
  const final = ok.find((b) => b.cat === 'final');
  if (final) chosen.push(final);
  const cats = new Set(chosen.map((x) => x.cat));
  while (chosen.length < 5) {
    const pool = ok.filter((b) => !cats.has(b.cat) && b.cat !== 'open');
    if (!pool.length) break;
    // fresh questions first: those already asked this season weigh much less
    const ws = pool.map((b) => (b.w ?? 1) * (used.has(b.id) ? 0.15 : 1));
    let x = r.next() * ws.reduce((a, b) => a + b, 0);
    let k = 0;
    while (k < pool.length - 1 && (x -= ws[k]) > 0) k++;
    chosen.push(pool[k]);
    cats.add(pool[k].cat);
  }
  // the reply to the rival goes last, as the climax
  chosen.sort((a, b) => (a.cat === 'open' ? -1 : b.cat === 'open' ? 1 : a.cat === 'reply' ? 1 : b.cat === 'reply' ? -1 : 0));
  return chosen.map((b) => ({
    id: b.id, cat: b.cat, text: pick(b.ask(c)),
    answers: b.answers(c).map((a) => ({ tone: a.tone, text: pick(a.say), fx: tune({ ...BASE[a.tone], ...(a.fx || {}) }, c, a.tone), react: pick(a.react || REACT[a.tone]) })),
  }));
}

/** add up the answers, within limits */
export function totalFx(answers: StoredAnswer[]) {
  const t = { morale: 0, fire: 0, doubt: 0, ref: 1, crowd: 0, stake: 0, fans: 0, players: {} as Record<string, number> };
  for (const a of answers) {
    const f = a.fx;
    t.morale += f.morale || 0; t.fire += f.fire || 0; t.doubt += f.doubt || 0; t.crowd += f.crowd || 0; t.stake += f.stake || 0; t.fans += f.fans || 0;
    if (f.ref) t.ref *= f.ref;
  }
  return {
    morale: r2(clamp(t.morale, caps.morale)), fire: r2(clamp(t.fire, caps.fire)), doubt: r2(clamp(t.doubt, caps.doubt)),
    ref: r2(clamp(t.ref, caps.ref)), crowd: r2(clamp(t.crowd, caps.crowd)), stake: r2(clamp(t.stake, caps.stake)), fans: Math.round(t.fans),
  };
}

/** short words for what an answer did, for the screen */
export function fxChips(f: Fx, ids: Ctx['ids'] | Record<string, string>, names: Record<string, string>) {
  const out: { t: string; good: boolean }[] = [];
  if ((f.morale || 0) >= 0.6) out.push({ t: 'Team fired up', good: true }); else if ((f.morale || 0) >= 0.25) out.push({ t: 'Team lifted', good: true }); else if ((f.morale || 0) < 0) out.push({ t: 'Team deflated', good: false });
  if ((f.fire || 0) >= 0.5) out.push({ t: 'Rival fired up', good: false }); else if ((f.fire || 0) >= 0.25) out.push({ t: 'Rival stung', good: false });
  if ((f.doubt || 0) >= 0.4) out.push({ t: 'Rival rattled', good: true }); else if ((f.doubt || 0) >= 0.2) out.push({ t: 'Seeds of doubt', good: true });
  if ((f.ref || 1) >= 1.1) out.push({ t: 'Referee watching you', good: false }); else if ((f.ref || 1) <= 0.95) out.push({ t: 'Referee on side', good: true });
  if ((f.crowd || 0) >= 0.3) out.push({ t: 'Fans roused', good: true });
  if ((f.stake || 0) >= 0.7) out.push({ t: 'Big promise', good: false }); else if ((f.stake || 0) <= -0.4) out.push({ t: 'Expectations lowered', good: true });
  if ((f.fans || 0) >= 400) out.push({ t: 'Fans love it', good: true });
  if (f.pmod) {
    const nm = names[(ids as any)[f.pmod.who]] || '';
    if (nm) out.push(f.pmod.v > 0 ? { t: `${last(nm)} pumped`, good: true } : { t: `${last(nm)}: make or break`, good: false });
  }
  return out;
}

// ---------------------------------------------------------------- which match, and the context
async function bigMatch(l: Row, clubId: number) {
  const f = await one(
    `SELECT * FROM fixtures WHERE league_id=$1 AND status='scheduled' AND (home_id=$2 OR away_id=$2) ORDER BY day, id LIMIT 1`,
    [l.id, clubId],
  );
  if (!f) return null;
  const [home, away] = await Promise.all([one('SELECT * FROM clubs WHERE id=$1', [f.home_id]), one('SELECT * FROM clubs WHERE id=$1', [f.away_id])]);
  if (!home || !away) return null;
  const derby = isDerby(home, away);
  let final = false;
  if (f.comp === 'cup' && f.round) {
    const cup = await one(`SELECT data FROM papers WHERE league_id=$1 AND day=0 AND kind='cup'`, [l.id]);
    final = cup?.data?.rounds?.[f.round - 1]?.name === 'Final';
  }
  if (!derby && !final) return null;
  return { f, home, away, derby, final: !!final };
}

const streakOf = (form: string[]) => {
  if (!form.length) return { k: null, n: 0 } as Ctx['streak'];
  if (form[0] === 'W') { let n = 0; while (form[n] === 'W') n++; return { k: 'W' as const, n }; }
  if (form[0] === 'L') { let n = 0; while (form[n] === 'L') n++; return { k: 'L' as const, n }; }
  let n = 0; while (form[n] && form[n] !== 'L') n++; return { k: 'U' as const, n };
};

async function recentForm(leagueId: number, clubId: number) {
  const fx = await q(`SELECT home_id, home_goals, away_goals, winner_id FROM fixtures WHERE league_id=$1 AND status='done' AND (home_id=$2 OR away_id=$2) ORDER BY day DESC, id DESC LIMIT 6`, [leagueId, clubId]);
  return fx.map((x) => {
    const [g, a] = x.home_id === clubId ? [x.home_goals, x.away_goals] : [x.away_goals, x.home_goals];
    return x.winner_id ? (x.winner_id === clubId ? 'W' : 'L') : g > a ? 'W' : g < a ? 'L' : 'D';
  });
}

async function contextFor(l: Row, m: NonNullable<Awaited<ReturnType<typeof bigMatch>>>, club: Row, rivalQuote: Ctx['rival']) {
  const { f, home, away } = m;
  const meHome = home.id === club.id;
  const opp = meHome ? away : home;
  const { hs, as } = await previewSides(l, f);
  const me: ESide = meHome ? hs : as, them: ESide = meHome ? as : hs;
  const edge = strengthOf(me, meHome).total - strengthOf(them, !meHome).total;
  const div = club.division || 1;
  const table = f.comp === 'league' ? await standings(l.id, div) : [];
  const pos = (id: number) => { const i = table.findIndex((r: any) => r.id === id); return i < 0 ? null : i + 1; };
  const ptsOf = (id: number) => table.find((r: any) => r.id === id)?.pts ?? 0;
  const [myForm, oppForm] = await Promise.all([recentForm(l.id, club.id), recentForm(l.id, opp.id)]);
  const h = await one(`SELECT home_id, home_goals, away_goals FROM fixtures WHERE league_id=$1 AND status='done' AND ((home_id=$2 AND away_id=$3) OR (home_id=$3 AND away_id=$2)) ORDER BY day DESC LIMIT 1`, [l.id, club.id, opp.id]);
  const h2h = h ? (() => {
    const [g, a] = h.home_id === club.id ? [h.home_goals, h.away_goals] : [h.away_goals, h.home_goals];
    return { res: (g > a ? 'W' : g < a ? 'L' : 'D') as 'W' | 'D' | 'L', score: `${g}-${a}` };
  })() : null;
  const best = (xi: ESide['xi']) => [...xi].sort((a, b) => b.ovr - a.ovr)[0];
  const st = await q(`SELECT player_id, goals, apps, rating_sum FROM pstats WHERE league_id=$1 AND club_id=$2`, [l.id, club.id]);
  const inXI = new Set(me.xi.map((p) => p.id));
  const name = (id?: string | null) => me.xi.find((p) => p.id === id)?.name || null;
  const scorerRow = st.filter((x) => inXI.has(x.player_id)).sort((a, b) => b.goals - a.goals)[0];
  const strugRow = st.filter((x) => inXI.has(x.player_id) && x.apps >= 2 && Number(x.rating_sum) / x.apps < 6.4).sort((a, b) => Number(a.rating_sum) / a.apps - Number(b.rating_sum) / b.apps)[0];
  const out = await one(`SELECT p.name FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 AND s.out_until >= $2 ORDER BY p.ovr DESC LIMIT 1`, [club.id, f.day]);
  const topOut = out && (await one<{ o: number }>(`SELECT MAX(p.ovr) AS o FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1`, [club.id]));
  const injured = out && topOut ? out.name : null;
  const cond = conditionsFor(f.id, l.pool, f.day);
  const keeper = me.xi.find((p) => p.pos === 'GK');
  const star = best(me.xi), oppStar = best(them.xi);
  const user = opp.user_id ? await one('SELECT username FROM users WHERE id=$1', [opp.user_id]) : null;
  const scorer = scorerRow && scorerRow.goals > 0 ? name(scorerRow.player_id) : null;
  const struggler = strugRow ? name(strugRow.player_id) : null;
  const ctx: Ctx = {
    me: club.name, opp: opp.name, oppMgr: user?.username || `the ${opp.name} manager`, human: !!opp.user_id,
    venue: meHome ? 'home' : 'away', stadium: home.stadium || `${home.name} Park`,
    myPos: pos(club.id), oppPos: pos(opp.id), pts: ptsOf(club.id) - ptsOf(opp.id),
    edge, fav: edge >= 1.5 ? 'fav' : edge <= -1.5 ? 'dog' : 'even',
    myForm, oppForm, streak: streakOf(myForm), oppStreak: streakOf(oppForm), h2h,
    myStar: star?.name || 'our captain', oppStar: oppStar?.name || 'their best player',
    scorer, goals: scorerRow?.goals || 0, struggler: struggler && struggler !== star?.name ? struggler : null,
    cap: name(me.captain), keeper: keeper?.name || null, injured,
    ref: cond.referee.name, strict: cond.referee.strict, weather: cond.weather,
    final: m.final, derby: m.derby, boardLow: (club.board ?? 60) < 40, rival: rivalQuote,
    ids: { myStar: star?.id, scorer: scorerRow?.player_id, struggler: strugRow?.player_id, captain: me.captain, keeper: keeper?.id },
  };
  if (!ctx.myPos) { ctx.myPos = null; ctx.oppPos = null; }
  const names = Object.fromEntries(me.xi.filter((x) => Object.values(ctx.ids).includes(x.id)).map((x) => [x.id, x.name]));
  return { ctx, f, opp, meHome, names };
}

// the line a rival quotes back: the spiciest thing said
const SPICE: Tone[] = ['fiery', 'bold', 'mind', 'witty', 'humble', 'calm'];
function spiciest(answers: StoredAnswer[]) {
  return [...answers].sort((a, b) => SPICE.indexOf(a.tone) - SPICE.indexOf(b.tone))[0];
}

// ---------------------------------------------------------------- API
export async function pressView(uid: number, leagueId: number) {
  const l = await getLeague(leagueId);
  const club = await myClub(uid, leagueId);
  if (l.status !== 'running') return { available: false };
  const m = await bigMatch(l, club.id);
  if (!m) return { available: false };
  let p = await one('SELECT * FROM pressers WHERE fixture_id=$1 AND club_id=$2', [m.f.id, club.id]);
  const oppId = m.home.id === club.id ? m.away.id : m.home.id;
  const rivalP = await one('SELECT done, effects FROM pressers WHERE fixture_id=$1 AND club_id=$2', [m.f.id, oppId]);
  if (!p) {
    const rq = rivalP?.done ? (rivalP.effects?.quote as { text: string; tone: Tone } | undefined) || null : null;
    const { ctx, names } = await contextFor(l, m, club, rq ? { text: rq.text, tone: rq.tone } : null);
    const used = new Set((await q(`SELECT jsonb_array_elements(questions)->>'id' AS id FROM pressers WHERE club_id=$1`, [club.id])).map((x) => x.id));
    const qs = buildQuestions(ctx, hashSeed('press', m.f.id, club.id), used);
    const extra = { ids: ctx.ids, names };
    p = await one(
      `INSERT INTO pressers (league_id, fixture_id, club_id, questions, effects) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)
       ON CONFLICT (fixture_id, club_id) DO UPDATE SET fixture_id=EXCLUDED.fixture_id RETURNING *`,
      [l.id, m.f.id, club.id, JSON.stringify(qs), JSON.stringify({ meta: extra })],
    );
  }
  const u = await one('SELECT username FROM users WHERE id=$1', [uid]);
  return presserOut(p!, m, club, rivalP, u?.username);
}

function presserOut(p: Row, m: NonNullable<Awaited<ReturnType<typeof bigMatch>>>, club: Row, rivalP: Row | null, manager?: string) {
  const qs: StoredQ[] = p.questions;
  const ans: { q: number; a: number }[] = p.answers;
  const meta = p.effects?.meta || { ids: {}, names: {} };
  const opp = m.home.id === club.id ? m.away : m.home;
  return {
    available: true, manager: manager || 'Manager',
    fixtureId: m.f.id, kickoff: m.f.kickoff_at, derby: m.derby, final: m.final,
    me: { id: club.id, name: club.name, color1: club.color1, color2: club.color2, shape: club.shape, emblem: club.emblem, short: club.short },
    opp: { id: opp.id, name: opp.name, color1: opp.color1, color2: opp.color2, shape: opp.shape, emblem: opp.emblem, short: opp.short, human: !!opp.user_id },
    venue: m.home.id === club.id ? 'home' : 'away',
    // the effects of an answer stay hidden until it is given
    questions: qs.map((x, i) => ({
      text: x.text,
      answers: x.answers.map((a) => ({ tone: a.tone, face: TONES[a.tone].face, toneName: TONES[a.tone].name, text: a.text })),
      picked: ans.find((y) => y.q === i)?.a ?? null,
      result: ans.find((y) => y.q === i) ? (() => { const a = x.answers[ans.find((y) => y.q === i)!.a]; return { react: a.react, chips: fxChips(a.fx, meta.ids, meta.names) }; })() : null,
    })),
    done: !!p.done,
    summary: p.done ? summaryOf(p) : null,
    rivalDone: !!rivalP?.done,
  };
}

function summaryOf(p: Row) {
  const e = p.effects || {};
  const t = e.total || {};
  const lines: { t: string; good: boolean }[] = [];
  if (t.morale >= 0.8) lines.push({ t: `Your players are fired up (+${t.morale.toFixed(1)})`, good: true });
  else if (t.morale > 0.1) lines.push({ t: `Your players are lifted (+${t.morale.toFixed(1)})`, good: true });
  else if (t.morale < 0) lines.push({ t: `Your players are a bit flat (${t.morale.toFixed(1)})`, good: false });
  const opp = Math.round((t.fire - t.doubt) * 10) / 10;
  if (opp >= 0.3) lines.push({ t: `You fired up the rival (+${opp} for them)`, good: false });
  else if (opp <= -0.2) lines.push({ t: `You got into their heads (${opp} for them)`, good: true });
  if (t.ref >= 1.1) lines.push({ t: `The referee will watch you closely (cards ×${t.ref})`, good: false });
  else if (t.ref <= 0.95) lines.push({ t: `The referee liked your respect (cards ×${t.ref})`, good: true });
  if (t.crowd >= 0.3) lines.push({ t: `The fans will be louder (+${t.crowd.toFixed(1)})`, good: true });
  if (t.stake >= 0.7) lines.push({ t: 'You raised the stakes: a win will mean more, a defeat will hurt more', good: false });
  else if (t.stake <= -0.4) lines.push({ t: 'You lowered expectations: a defeat will hurt less', good: true });
  if (t.fans > 0) lines.push({ t: `+${t.fans} fans loved your words`, good: true });
  for (const [, v] of Object.entries(e.playerNotes || {})) lines.push(v as any);
  return { headline: e.headline, lines };
}

export async function pressAnswer(uid: number, leagueId: number, b: { q: number; a: number }) {
  const l = await getLeague(leagueId);
  const club = await myClub(uid, leagueId);
  const m = await bigMatch(l, club.id);
  if (!m) fail(400, 'There is no press conference now.');
  const p = await one('SELECT * FROM pressers WHERE fixture_id=$1 AND club_id=$2', [m!.f.id, club.id]);
  if (!p) fail(400, 'Open the press conference first.');
  if (p!.done) fail(400, 'You already spoke to the press.');
  const qs: StoredQ[] = p!.questions;
  const ans: { q: number; a: number }[] = p!.answers;
  const u = await one('SELECT username FROM users WHERE id=$1', [uid]);
  const qi = Math.floor(Number(b.q)), ai = Math.floor(Number(b.a));
  if (qi !== ans.length) fail(400, 'Answer the questions in order.');
  if (!qs[qi] || !qs[qi].answers[ai]) fail(400, 'Pick an answer.');
  const next = [...ans, { q: qi, a: ai }];
  const doneNow = next.length >= qs.length;
  const picked = next.map((x) => qs[x.q].answers[x.a]);
  const meta = p!.effects?.meta || { ids: {}, names: {} };
  let effects: any = { ...p!.effects };
  if (doneNow) {
    const total = totalFx(picked);
    // players named in answers: their form for this match
    const players: Record<string, number> = {};
    const playerNotes: Record<string, { t: string; good: boolean }> = {};
    const r = rng(hashSeed('press-p', m!.f.id, club.id));
    for (const a of picked) {
      if (!a.fx.pmod) continue;
      const id = meta.ids?.[a.fx.pmod.who];
      if (!id) continue;
      let v = a.fx.pmod.v;
      // calling a player out is a gamble: he answers on the pitch, or he sulks
      if (v === 0) v = r.next() < 0.55 ? 3 : -3;
      players[id] = Math.max(-3, Math.min(4, (players[id] || 0) + v));
      const nm = meta.names?.[id] || 'He';
      playerNotes[id] = players[id] > 0 ? { t: `${nm}: +${players[id]} form for the match`, good: true } : { t: `${nm} took it badly: ${players[id]} form for the match`, good: false };
    }
    const sp = spiciest(picked);
    const opp = m!.home.id === club.id ? m!.away : m!.home;
    const headline = sp.tone === 'fiery' ? `"${sp.text.split('. ')[0].replace(/\.$/, '')}!" ${club.name} boss goes to war`
      : sp.tone === 'bold' ? `${club.name} boss: "${sp.text.split('. ')[0].replace(/\.$/, '')}"`
      : sp.tone === 'mind' ? `Mind games begin: ${club.name} boss takes aim at ${opp.name}`
      : sp.tone === 'witty' ? `${club.name} boss keeps it light before the big one`
      : sp.tone === 'humble' ? `${club.name} boss plays down expectations`
      : `${club.name} boss stays cool ahead of ${m!.final ? 'the final' : 'the derby'}`;
    effects = { ...effects, total, players, playerNotes, headline, quote: { text: sp.text, tone: sp.tone } };
    await q(`UPDATE pressers SET answers=$2::jsonb, effects=$3::jsonb, done=true WHERE id=$1`, [p!.id, JSON.stringify(next), JSON.stringify(effects)]);
    if (total.fans) await q('UPDATE clubs SET fans=fans+$2 WHERE id=$1', [club.id, total.fans]);
    // the words go public, and the rival hears about them
    await news(l.id, club.id, 'press', `🎙️ ${u?.username || club.name} (${club.name}) before ${m!.final ? 'the final' : 'the derby'}: "${sp.text}"`);
    if (opp.user_id) await notify(opp.user_id, { title: `🎙️ ${club.name} manager spoke about you`, body: `"${sp.text}" Answer him in your own press conference.`, url: `/l/${l.id}?tab=press`, tag: `press-${m!.f.id}` });
  } else {
    await q(`UPDATE pressers SET answers=$2::jsonb WHERE id=$1`, [p!.id, JSON.stringify(next)]);
  }
  const a = qs[qi].answers[ai];
  const p2 = { ...p!, answers: next, done: doneNow, effects };
  const rivalP = await one('SELECT done FROM pressers WHERE fixture_id=$1 AND club_id=$2', [m!.f.id, m!.home.id === club.id ? m!.away.id : m!.home.id]);
  return { ...presserOut(p2, m!, club, rivalP, u?.username), last: { react: a.react, chips: fxChips(a.fx, meta.ids, meta.names) } };
}

/** at kick-off: what both managers said changes the match */
export async function applyPressers(fixtureId: number, hs: ESide, as: ESide, homeId: number) {
  const ps = await q(`SELECT club_id, effects FROM pressers WHERE fixture_id=$1 AND done`, [fixtureId]);
  for (const p of ps) {
    const t = p.effects?.total;
    if (!t) continue;
    const mine = p.club_id === homeId ? hs : as, theirs = p.club_id === homeId ? as : hs;
    const home = p.club_id === homeId;
    mine.boost = (mine.boost || 0) + t.morale + (home ? 0 : t.crowd * 0.5);
    if (home) mine.homeBoost = (mine.homeBoost || 0) + t.crowd;
    theirs.boost = (theirs.boost || 0) + t.fire - t.doubt;
    mine.cardMul = (mine.cardMul || 1) * t.ref;
    for (const [id, v] of Object.entries((p.effects.players || {}) as Record<string, number>)) {
      for (const pl of [...mine.xi, ...mine.bench]) if (pl.id === id) pl.mod = Math.round(((pl.mod || 0) + v) * 10) / 10;
    }
  }
  return ps.map((p) => p.club_id as number);
}

/** after the match: how much the result moves board and fans, and the story for the papers */
export async function pressAftermath(fixtureId: number, clubId: number) {
  const p = await one(`SELECT effects FROM pressers WHERE fixture_id=$1 AND club_id=$2 AND done`, [fixtureId, clubId]);
  return p?.effects?.total ? { stake: Number(p.effects.total.stake) || 0, quote: p.effects.quote as { text: string; tone: Tone } } : null;
}

/** is there a press conference waiting for this club? (for the Today panel and the home screen) */
export async function pressStatus(l: Row, clubId: number) {
  const m = await bigMatch(l, clubId);
  if (!m) return null;
  const p = await one('SELECT done FROM pressers WHERE fixture_id=$1 AND club_id=$2', [m.f.id, clubId]);
  return { done: !!p?.done, final: m.final, derby: m.derby };
}
