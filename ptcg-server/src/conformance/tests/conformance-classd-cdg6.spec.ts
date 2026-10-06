import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, StadiumRef, SCHEMA_VERSION } from '../neutral-types';
import { getCardBySetAndNumber } from '../../sets/tests/test-helpers';
import { PokemonCard } from '../../game/store/card/pokemon-card';

const watchog = (num: string): PokemonCard => getCardBySetAndNumber('cri', num) as PokemonCard;

/**
 * Class-D batch cdg6 (filed 2026-09-30 .. 2026-10-05, re-driven 2026-10-06 on :8090 901f67b0d x :8099). Printed text is
 * quoted from card-data/final/<set>.json.
 *
 *   TA-535 Panpour par-041 Call for Family: "Search your deck for a Basic Pokémon and put it onto your Bench. Then,
 *     shuffle your deck." A search of a hidden deck for a named kind may fail to find (#2171); the prompt was min 1
 *     with no decline on the wire.
 *   TA-541 Cresselia sfa-021 Crescent Purge: "You may turn 1 of your face-down Prize cards face up. If you do, this
 *     attack does 80 more damage." With ONE face-down prize the pick has one outcome (CF-14) and is applied
 *     atomically; a face-up prize is never a candidate.
 *   TA-554 Blowtorch pfl-086: "Discard a Pokémon Tool or Special Energy card from 1 of your opponent's Pokémon, or
 *     discard a Stadium in play." B.71 (addendum 2026-10-02): ONE decision of `discard {owner, target}` templates over
 *     every Tool and Special Energy on the opponent's Pokémon plus the Stadium in play; no mode; collapse at one.
 *   TA-555 Gothitelle pal-092 Read the Stars: "look at the top 2 cards of your opponent's deck and put 1 of them back.
 *     Put the other card on the bottom of their deck." B.73 G1: the single pick names the card PUT BACK.
 *   TA-557 Sizzlipede pbl-009 Bug Out: "Reveal the bottom 7 cards of your deck, and this attack does 50 damage for each
 *     Pokémon you find there that has the Bug Out attack. Then, shuffle any revealed Pokémon back into your deck.
 *     Discard the other cards."
 *   TA-575 Minior par-099 Far-Flying Meteor: "Once during your turn, if this Pokémon is on your Bench, when you attach
 *     an Energy card from your hand to this Pokémon, you may switch it with your Active Pokémon."
 *   TA-601 Watchog cri-071 Snap Inspection: "Flip 3 coins. If any of them are heads, your opponent reveals their hand.
 *     For each heads, choose a card you find there and shuffle it into your opponent's deck."
 */

const GRASS = 'sve-001';
const FIRE = 'sve-002';
const PSYCHIC = 'sve-005';
const BELLSPROUT = 'asc-004'; // Basic
const BIG = 'mew-003'; // Venusaur ex, 340 HP, weak to Fire
const PANPOUR = 'par-041';
const CRESSELIA = 'sfa-021';
const BLOWTORCH = 'pfl-086';
const BRAVERY_CHARM = 'pal-173'; // Pokémon Tool
const JET_ENERGY = 'pal-190'; // Special Energy
const ARTAZON = 'pal-171'; // Stadium
const GOTHITELLE = ['pal-090', 'pal-091', 'pal-092'];
const SIZZLIPEDE = 'pbl-009';
const OGERPON = 'dri-026';
const MINIOR = 'par-099';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, stack: string[], energy: string[] = [], tools: string[] = []): PokemonInPlay {
  return {
    stack: stack.map((printing, i) => ({ iid: i === 0 ? iid : `${iid}s${i}`, printing })),
    energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })),
    tools: tools.map((t, i) => ({ iid: `${iid}t${i}`, printing: t })),
    damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string, faceUp: boolean[] = Array(6).fill(false)): PrizeRef[] {
  return faceUp.map((f, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: f }));
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
interface Opts {
  bench?: PokemonInPlay[]; hand?: string[]; deck?: string[]; aPrizes?: boolean[];
  bActive?: PokemonInPlay; bBench?: PokemonInPlay[]; bDeck?: string[]; stadium?: StadiumRef | null;
}
function board(active: PokemonInPlay, o: Opts = {}): NeutralState {
  const A: PlayerState = { active, bench: o.bench ?? [], hand: cards('ah', o.hand ?? []), deck: cards('ad', o.deck ?? Array(8).fill(GRASS)),
    discard: [], lostZone: [], prizes: prizes('a', o.aPrizes), flags: flags() };
  const B: PlayerState = { active: o.bActive ?? mon('b1', [BIG]), bench: o.bBench ?? [], hand: [],
    deck: cards('bd', o.bDeck ?? Array(8).fill(GRASS)), discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: o.stadium ?? null, players: { A, B } };
}
type Act = { type: string; [k: string]: unknown };
function run(s: NeutralState, actions: unknown[]) {
  return step(s, actions as never);
}
function menu(s: NeutralState, actions: unknown[] = []): Act[] {
  return (run(s, actions).pending?.legalActions ?? []) as unknown as Act[];
}
/** Replays `actions`, answering each system shuffle with the order it offers; reports whether one was asked. */
function runShuffling(s: NeutralState, actions: unknown[]) {
  const acts = [...actions];
  let shuffled = false;
  for (;;) {
    const r = run(s, acts);
    const sh = (r.pending?.legalActions ?? []).find(a => (a as unknown as Act).type === 'shuffle') as unknown as Act | undefined;
    if (r.pending?.actor !== 'system' || sh === undefined) {
      return { r, shuffled };
    }
    shuffled = true;
    acts.push({ actor: 'system', type: 'shuffle', order: sh.deck ?? [] });
  }
}
const ids = (refs: { iid: string }[]): string[] => refs.map(r => r.iid);

// ---------------------------------------------------------------- TA-535
describe('TA-535 Panpour Call for Family may fail to find', () => {
  const call = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Call for Family' };
  const s = () => board(mon('a1', [PANPOUR], [GRASS]), { deck: [BELLSPROUT, GRASS, GRASS, GRASS] });
  it('Call for Family with a Basic in the deck offers the decline next to the pick [TA-535]', () => {
    const m = menu(s(), [call]);
    expect(m.some(a => a.type === 'choose' && a.target === 'ad0')).toBe(true);
    expect(m.some(a => a.type === 'confirm' && a.value === false)).toBe(true);
  });
  it('declining Call for Family benches nothing and keeps all four cards in the deck [TA-535]', () => {
    const r = run(s(), [call, { actor: 'A', type: 'confirm', value: false }]);
    expect(r.status).not.toBe('invalidAction');
    expect(r.state.players.A.bench.length).toBe(0);
    expect(r.state.players.A.deck.length).toBe(4);
  });
  it('control: taking the Basic benches it [TA-535]', () => {
    const r = run(s(), [call, { actor: 'A', type: 'choose', target: 'ad0' }]);
    expect(r.state.players.A.bench.map(b => b.stack[0].iid)).toEqual(['ad0']);
  });
});

// ---------------------------------------------------------------- TA-541
describe('TA-541 Cresselia Crescent Purge with one choosable face-down prize', () => {
  const purge = [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Crescent Purge' }, { actor: 'A', type: 'confirm', value: true }];
  const cress = () => mon('a1', [CRESSELIA], [PSYCHIC, PSYCHIC, PSYCHIC]);
  it('one face-down prize: the face-up turn is applied with no pick and the attack does 160 [TA-541]', () => {
    const r = run(board(cress(), { aPrizes: [false] }), purge);
    const m = (r.pending?.legalActions ?? []) as unknown as Act[];
    expect(m.some(a => a.type === 'choose' && a.target === 'ap0')).toBe(false);
    expect(r.state.players.A.prizes[0].faceUp).toBe(true);
    expect(r.state.players.B.active!.damage).toBe(160);
  });
  it('one face-down and one face-up prize: the face-up one is no candidate; the face-down one turns with no pick [TA-541]', () => {
    const r = run(board(cress(), { aPrizes: [true, false] }), purge);
    const m = (r.pending?.legalActions ?? []) as unknown as Act[];
    expect(m.some(a => a.type === 'choose')).toBe(false);
    expect(r.state.players.A.prizes.map(p => p.faceUp)).toEqual([true, true]);
    expect(r.state.players.B.active!.damage).toBe(160);
  });
  it('every prize already face up: no "may" is asked and the attack does 80 [TA-541]', () => {
    const r = run(board(cress(), { aPrizes: [true, true] }), [purge[0]]);
    const m = (r.pending?.legalActions ?? []) as unknown as Act[];
    expect(m.some(a => a.type === 'confirm')).toBe(false);
    expect(r.state.players.B.active!.damage).toBe(80);
  });
  it('control: two face-down prizes still surface the pick over both (CF-66 open) [TA-541]', () => {
    const m = menu(board(cress(), { aPrizes: [false, false] }), purge);
    expect(m.filter(a => a.type === 'choose').map(a => a.target).sort()).toEqual(['ap0', 'ap1']);
  });
});

// ---------------------------------------------------------------- TA-554
describe('TA-554 Blowtorch picks the discarded card directly (B.71)', () => {
  const play = { actor: 'A', type: 'playItem', card: 'ah0' };
  const full = () => board(mon('a1', [BELLSPROUT]), {
    hand: [BLOWTORCH, FIRE], bActive: mon('b1', [BIG], [JET_ENERGY, GRASS], [BRAVERY_CHARM]),
    stadium: { iid: 'st0', printing: ARTAZON, owner: 'B' },
  });
  it('Tool, Special Energy and Stadium in play: one decision of discard templates, no mode [TA-554]', () => {
    const m = menu(full(), [play]);
    expect(m.some(a => a.type === 'selectOption')).toBe(false);
    expect(m.filter(a => a.type === 'discard').map(a => `${a.owner}:${a.target}`).sort())
      .toEqual(['B:b1e0', 'B:b1t0', 'B:st0']);
  });
  it('discarding the Special Energy leaves the Tool and the Stadium [TA-554]', () => {
    const r = run(full(), [play, { actor: 'A', type: 'discard', owner: 'B', target: 'b1e0' }]);
    expect(r.status).not.toBe('invalidAction');
    expect(ids(r.state.players.B.active!.energy)).toEqual(['b1e1']);
    expect(ids(r.state.players.B.active!.tools)).toEqual(['b1t0']);
    expect(r.state.stadium?.iid).toBe('st0');
    expect(ids(r.state.players.B.discard)).toEqual(['b1e0']);
    expect(ids(r.state.players.A.discard).sort()).toEqual(['ah0', 'ah1']);
  });
  it('discarding the Stadium leaves the Tool and the Special Energy [TA-554]', () => {
    const r = run(full(), [play, { actor: 'A', type: 'discard', owner: 'B', target: 'st0' }]);
    expect(r.state.stadium ?? null).toBe(null);
    expect(ids(r.state.players.B.discard)).toEqual(['st0']);
    expect(ids(r.state.players.B.active!.tools)).toEqual(['b1t0']);
  });
  it('only a Stadium in play (A\'s own): the one candidate collapses and the Stadium is discarded [TA-554]', () => {
    const s = board(mon('a1', [BELLSPROUT]), { hand: [BLOWTORCH, FIRE], stadium: { iid: 'st0', printing: ARTAZON, owner: 'A' } });
    const r = run(s, [play]);
    expect(r.pending?.actor === 'A' && (r.pending.legalActions as unknown as Act[]).some(a => a.type !== 'endTurn'
      && ['discard', 'selectOption'].includes(a.type))).toBe(false);
    expect(r.state.stadium ?? null).toBe(null);
    expect(ids(r.state.players.A.discard).sort()).toEqual(['ah0', 'ah1', 'st0']);
  });
  it('control: no Tool, Special Energy or Stadium: Blowtorch is not offered (B.71 addendum) [TA-554]', () => {
    const s = board(mon('a1', [BELLSPROUT]), { hand: [BLOWTORCH, FIRE], bActive: mon('b1', [BIG], [GRASS]) });
    expect(menu(s).some(a => a.type === 'playItem' && a.card === 'ah0')).toBe(false);
  });
});

// ---------------------------------------------------------------- TA-555
describe('TA-555 Gothitelle Read the Stars: the pick names the card put back (B.73 G1)', () => {
  const use = { actor: 'A', type: 'useAbility', source: 'a1', ability: 'Read the Stars' };
  const s = () => board(mon('a1', GOTHITELLE), { bDeck: [GRASS, FIRE, PSYCHIC, GRASS] });
  it('choose bd0: bd0 goes back on top, bd1 to the bottom [TA-555]', () => {
    const r = run(s(), [use, { actor: 'A', type: 'choose', target: 'bd0' }]);
    expect(ids(r.state.players.B.deck)).toEqual(['bd0', 'bd2', 'bd3', 'bd1']);
  });
  it('choose bd1: bd1 goes back on top, bd0 to the bottom [TA-555]', () => {
    const r = run(s(), [use, { actor: 'A', type: 'choose', target: 'bd1' }]);
    expect(ids(r.state.players.B.deck)).toEqual(['bd1', 'bd2', 'bd3', 'bd0']);
  });
  it('control: the pick is offered over exactly the top two cards [TA-555]', () => {
    expect(menu(s(), [use]).filter(a => a.type === 'choose').map(a => a.target).sort()).toEqual(['bd0', 'bd1']);
  });
});

// ---------------------------------------------------------------- TA-557
describe('TA-557 Sizzlipede Bug Out shuffles back every revealed Pokémon', () => {
  const bugOut = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Bug Out' };
  // Bottom 7 = ad3..ad9 (the deck is listed top first).
  const s = (bottom: string[]) => board(mon('a1', [SIZZLIPEDE], [GRASS, GRASS, GRASS]), {
    deck: [GRASS, GRASS, GRASS, ...bottom], bActive: mon('b1', [PANPOUR]),
  });
  it('a revealed Pokémon without Bug Out (Panpour) goes back into the deck, not the discard [TA-557]', () => {
    const { r, shuffled } = runShuffling(s([SIZZLIPEDE, PANPOUR, GRASS, GRASS, GRASS, GRASS, GRASS]), [bugOut]);
    expect(shuffled).toBe(true);
    expect(r.state.players.B.active!.damage).toBe(50);
    expect(ids(r.state.players.A.discard).sort()).toEqual(['ad5', 'ad6', 'ad7', 'ad8', 'ad9']);
    expect(ids(r.state.players.A.deck).sort()).toEqual(['ad0', 'ad1', 'ad2', 'ad3', 'ad4']);
  });
  it('only Pokémon without Bug Out revealed: no damage, they are shuffled back [TA-557]', () => {
    const { r, shuffled } = runShuffling(s([PANPOUR, GRASS, GRASS, GRASS, GRASS, GRASS, GRASS]), [bugOut]);
    expect(shuffled).toBe(true);
    expect(r.state.players.B.active!.damage).toBe(0);
    expect(ids(r.state.players.A.deck).sort()).toEqual(['ad0', 'ad1', 'ad2', 'ad3']);
  });
  it('control: a revealed Sizzlipede counts 50 and goes back; the Energy is discarded [TA-557]', () => {
    const { r, shuffled } = runShuffling(s([SIZZLIPEDE, GRASS, GRASS, GRASS, GRASS, GRASS, GRASS]), [bugOut]);
    expect(shuffled).toBe(true);
    expect(r.state.players.B.active!.damage).toBe(50);
    expect(ids(r.state.players.A.deck).sort()).toEqual(['ad0', 'ad1', 'ad2', 'ad3']);
    expect(r.state.players.A.discard.length).toBe(6);
  });
  it('control: no Pokémon revealed: no damage, no shuffle, all seven discarded [TA-557]', () => {
    const { r, shuffled } = runShuffling(s([GRASS, GRASS, GRASS, GRASS, GRASS, GRASS, GRASS]), [bugOut]);
    expect(shuffled).toBe(false);
    expect(r.state.players.B.active!.damage).toBe(0);
    expect(r.state.players.A.discard.length).toBe(7);
  });
});

// ---------------------------------------------------------------- TA-575
describe('TA-575 Minior Far-Flying Meteor needs an attach from the hand', () => {
  it('Grass Kagura attaches from the deck to Benched Minior: no Far-Flying Meteor prompt, Minior stays Benched [TA-575]', () => {
    const s = board(mon('a1', [OGERPON], [GRASS]), { bench: [mon('a2', [MINIOR])], deck: [GRASS, FIRE, FIRE, FIRE] });
    const r = run(s, [
      { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Grass Kagura' },
      { actor: 'A', type: 'attachEnergy', card: 'ad0', target: 'a2' },
    ]);
    const m = (r.pending?.legalActions ?? []) as unknown as Act[];
    expect(m.some(a => a.type === 'confirm' && a.value === true)).toBe(false);
    expect(r.state.players.A.active!.stack[0].iid).toBe('a1');
    expect(ids(r.state.players.A.bench[0].energy)).toEqual(['ad0']);
  });
  it('control: attaching from the hand to Benched Minior offers the switch, and accepting it swaps [TA-575]', () => {
    const s = board(mon('a1', [BELLSPROUT]), { bench: [mon('a2', [MINIOR])], hand: [GRASS] });
    const attach = { actor: 'A', type: 'attachEnergy', card: 'ah0', target: 'a2' };
    expect(menu(s, [attach]).some(a => a.type === 'confirm' && a.value === true)).toBe(true);
    const r = run(s, [attach, { actor: 'A', type: 'confirm', value: true }]);
    expect(r.state.players.A.active!.stack[0].iid).toBe('a2');
  });
});

// ---------------------------------------------------------------- TA-601
describe('TA-601 Watchog cri-071 Snap Inspection text', () => {
  const SNAP = 'Flip 3 coins. If any of them are heads, your opponent reveals their hand. '
      + 'For each heads, choose a card you find there and shuffle it into your opponent\'s deck.';
  it('cri-071 Snap Inspection reads as printed [TA-601]', () => {
    expect(watchog('71').attacks[0].text).toBe(SNAP);
  });
  it('cri-097 (the CRI reprint) Snap Inspection reads as printed [TA-601]', () => {
    expect(watchog('97').attacks[0].text).toBe(SNAP);
  });
  it('control: Low Kick is 50 with no text [TA-601]', () => {
    const lowKick = watchog('71').attacks[1];
    expect(lowKick.damage).toBe(50);
    expect(lowKick.text).toBe('');
  });
});
