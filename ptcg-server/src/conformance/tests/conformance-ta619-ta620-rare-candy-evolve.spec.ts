import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-619 / TA-620 — Rare Candy svi-191.
 *
 * Card text (rare-candy.ts): "Choose 1 of your Basic Pokemon in play. If you have a Stage 2 card in your hand that
 * evolves from that Pokemon, put that card onto the Basic Pokemon to evolve it. You can't use this card during your
 * first turn or on a Basic Pokemon that was put into play this turn."
 *
 * [TA-619] (adapter, CF-14 / B.25): the Stage 2 pick is raised as CHOOSE_CARD_TO_EVOLVE over the player's own HAND,
 * `min: 1, allowCancel: false`. With exactly one fitting Stage 2 it has one resolution and collapses; with two it is
 * a decision and surfaces. Driven 2026-10-06 on the scenario board (Pidgey mew-016 Active, Asleep, 20 damage):
 * one fitting (obf-164)          -> rotomancer COLLAPSES and evolves; twinleaf c6ea52669 surfaced choose{ah1}
 * two fitting (obf-164, mew-018) -> BOTH surface choose{ah1, ah2}   <-- the negative control
 * The hand is the acting player's own visible zone, so the #903 hidden-zone hazard (a search may fail to find) does
 * not reach it.
 *
 * [TA-620] (engine): "This counts as evolving that Pokémon ... and removes Special Conditions on that Pokémon"
 * (compendium #1132; #287 "refers to evolution rules that remove Special Conditions"). The clearing now happens at
 * the EvolveEffect choke point, so the drag-evolve path must still clear exactly once and Rare Candy now clears too.
 * Damage counters stay.
 */

const PIDGEY = 'mew-016';
const PIDGEOTTO = 'mew-017';
const PIDGEOT = 'mew-018';
const PIDGEOT_EX = 'obf-164';
const CHARIZARD_EX = 'obf-125';
const RARE_CANDY = 'svi-191';
const OPP = 'meg-003';
const FILLER = 'sve-001';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState>, tag: string): PlayerState {
  return {
    active: null, bench: [], hand: [], discard: [], lostZone: [], flags: flags(),
    prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: FILLER, faceUp: false })),
    deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: FILLER })) as CardRef[],
    ...over,
  };
}
function pidgey(conditions: string[]): PokemonInPlay {
  return { stack: [{ iid: 'a1', printing: PIDGEY }], energy: [], tools: [], damage: 20, conditions, markers: markers() } as PokemonInPlay;
}
function board(hand: CardRef[], conditions: string[] = ['asleep']): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 5, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: pidgey(conditions), hand }, 'a'),
      B: player({ active: { stack: [{ iid: 'b1', printing: OPP }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() } }, 'b'),
    },
  };
}
const candy: CardRef = { iid: 'ah0', printing: RARE_CANDY };
const play: NeutralAction = { actor: 'A', type: 'playItem', card: 'ah0' } as NeutralAction;
const top = (p: PokemonInPlay | null) => p!.stack[p!.stack.length - 1].printing;
const chooses = (r: ReturnType<typeof step>) =>
  (r.pending?.legalActions ?? []).filter(a => (a as { type: string }).type === 'choose').map(a => (a as { target?: string }).target).sort();

describe('[TA-619] Rare Candy svi-191: the CHOOSE_CARD_TO_EVOLVE hand pick collapses when forced (CF-14)', () => {
  it('[TA-619] one fitting Stage 2: no choose pending, the Stage 2 is on the Basic', () => {
    const r = step(board([candy, { iid: 'ah1', printing: PIDGEOT_EX }]), [play]);
    expect(chooses(r)).toEqual([]);
    expect(top(r.state.players.A.active)).toBe(PIDGEOT_EX);
  });

  it('[TA-619] one fitting Stage 2 beside a non-fitting one (blocked): collapses onto the fitting one', () => {
    const r = step(board([candy, { iid: 'ah1', printing: PIDGEOT_EX }, { iid: 'ah2', printing: CHARIZARD_EX }]), [play]);
    expect(chooses(r)).toEqual([]);
    expect(top(r.state.players.A.active)).toBe(PIDGEOT_EX);
    expect(r.state.players.A.hand.map(c => c.printing)).toEqual([CHARIZARD_EX]);
  });

  it('[TA-619] negative control: two fitting Stage 2 surface the pick with both', () => {
    const r = step(board([candy, { iid: 'ah1', printing: PIDGEOT_EX }, { iid: 'ah2', printing: PIDGEOT }]), [play]);
    expect(chooses(r)).toEqual(['ah1', 'ah2']);
    expect(top(r.state.players.A.active)).toBe(PIDGEY);
  });
});

describe('[TA-620] an EvolveEffect removes Special Conditions (#1132, #287), whatever path dispatched it', () => {
  const two = (conditions: string[]) => board([candy, { iid: 'ah1', printing: PIDGEOT_EX }, { iid: 'ah2', printing: PIDGEOT }], conditions);
  const pickPidgeot: NeutralAction = { actor: 'A', type: 'choose', target: 'ah2' } as NeutralAction;

  it('[TA-620] Rare Candy onto an Asleep Basic: the Stage 2 is not Asleep, damage stays', () => {
    const r = step(two(['asleep']), [play, pickPidgeot]);
    const a = r.state.players.A.active!;
    expect(top(a)).toBe(PIDGEOT);
    expect(a.conditions).toEqual([]);
    expect(a.damage).toBe(20);
  });

  it('[TA-620] Rare Candy onto a Paralyzed + Poisoned + Burned Basic: every Special Condition is removed', () => {
    const r = step(two(['paralyzed', 'poisoned', 'burned']), [play, pickPidgeot]);
    const a = r.state.players.A.active!;
    expect(top(a)).toBe(PIDGEOT);
    expect(a.conditions).toEqual([]);
  });

  it('[TA-620] Rare Candy, the forced (one-candidate) path: the scenario row\'s end state', () => {
    const r = step(board([candy, { iid: 'ah1', printing: PIDGEOT_EX }]), [play]);
    const a = r.state.players.A.active!;
    expect(top(a)).toBe(PIDGEOT_EX);
    expect(a.conditions).toEqual([]);
    expect(a.damage).toBe(20);
    expect(r.state.players.A.discard.map(c => c.printing)).toEqual([RARE_CANDY]);
  });

  it('[TA-620] drag-evolve (unchanged behaviour, now via the choke point): Confused cleared once, one evolved event', () => {
    const r = step(board([{ iid: 'ah1', printing: PIDGEOTTO }], ['confused', 'poisoned']),
      [{ actor: 'A', type: 'evolve', card: 'ah1', target: 'a1' } as NeutralAction]);
    const a = r.state.players.A.active!;
    expect(top(a)).toBe(PIDGEOTTO);
    expect(a.conditions).toEqual([]);
    expect(a.damage).toBe(20);
    const evolved = (r.events ?? []).filter(e => (e as { kind?: string }).kind === 'evolved');
    expect(evolved.length).toBe(1);
  });
});
