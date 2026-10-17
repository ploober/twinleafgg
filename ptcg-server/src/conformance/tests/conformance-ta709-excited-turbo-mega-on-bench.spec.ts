import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-709 — Excited Turbo pfl-018 (Oricorio ex) looks for the [R] Mega Evolution Pokémon ex only in the Active Spot.
 *
 * Card text (card-data/final/pfl.json): "As often as you like during your turn, if you have any [Fire] Mega Evolution
 * Pokémon ex in play, you may use this Ability. Attach a Basic [Fire] Energy card from your hand to 1 of your Benched
 * [Fire] Pokémon."
 *
 * "In play" is the Active Spot and the Bench. The card file searched `player.active.cards` only, so with Oricorio ex
 * Active and the Mega ex Benched (the usual board) the Ability was refused with CANNOT_USE_POWER. Rotomancer b39e56c47
 * attaches the Fire Energy to the Benched Mega ex (driven 2026-10-17).
 *
 * The prompt also took the defaults min 0 and max = hand size, so the attach could be declined or repeated; "Attach a
 * Basic [Fire] Energy card" is exactly one (min 1, max 1), and with one card and one target the pick collapses.
 */

const ORICORIO = 'pfl-018';
const NUMEL = 'meg-021';
const MEGA_CAMERUPT = 'meg-022';
const GOTHITA = 'pal-090';
const FIRE = 'sve-002';
const WATER = 'sve-003';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function prizes(tag: string, n: number): PrizeRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: WATER, faceUp: false }));
}
function mon(stack: CardRef[]): PokemonInPlay {
  return { stack, energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function deck(tag: string, n: number): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: WATER }));
}

/** A's turn: Oricorio ex Active; the [R] Mega ex is Benched (or absent), beside a non-[R] Gothita. */
function board(megaOnBench: boolean, fire = 1): NeutralState {
  const bench = [mon([{ iid: 'ab1', printing: GOTHITA }])];
  if (megaOnBench) {
    bench.push(mon([{ iid: 'ab2', printing: NUMEL }, { iid: 'ab3', printing: MEGA_CAMERUPT }]));
  } else {
    bench.push(mon([{ iid: 'ab2', printing: NUMEL }]));
  }
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon([{ iid: 'a1', printing: ORICORIO }]), bench,
        hand: [{ iid: 'ah0', printing: FIRE }, { iid: 'ah1', printing: WATER }, ...(fire > 1 ? [{ iid: 'ah2', printing: FIRE }] : [])], deck: deck('ad', 3), prizes: prizes('ap', 6),
      }),
      B: player({ active: mon([{ iid: 'b1', printing: GOTHITA }]), deck: deck('bd', 3), prizes: prizes('bp', 6) }),
    },
  } as NeutralState;
}

const use: NeutralAction = { actor: 'A', type: 'useAbility', source: 'a1', ability: 'Excited Turbo' } as NeutralAction;

describe('TA-709 Excited Turbo pfl-018: a [R] Mega Evolution Pokémon ex anywhere in play enables the Ability', () => {
  type Slot = { stack: CardRef[]; energy: CardRef[] };
  type Resp = { status: string; state: NeutralState };

  it('the Mega ex on the Bench: the Fire Energy goes onto it [TA-709 pfl-018]', () => {
    const r = step(board(true), [use]) as unknown as Resp;
    expect(r.status).toBe('awaitingAction');
    const camerupt = (r.state.players.A.bench as Slot[]).find(s => s.stack.some(c => c.iid === 'ab3'));
    expect(camerupt?.energy.map(c => c.iid)).toEqual(['ah0']);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ah1']);
  });

  it('two Fire Energy in hand: the pick offers no decline and attaches exactly one ("a Basic [Fire] Energy card") [TA-709 pfl-018]', () => {
    const r = step(board(true, 2), [use]) as unknown as Resp & { pending: { legalActions: NeutralAction[] } };
    expect(r.pending.legalActions.map(a => a.type)).toEqual(['attachEnergy', 'attachEnergy']);
    const pick = { actor: 'A', type: 'attachEnergy', card: 'ah2', target: 'ab2' } as NeutralAction;
    const r2 = step(board(true, 2), [use, pick]) as unknown as Resp & { pending: { descriptor: string } };
    expect(r2.pending.descriptor).toBe('main');
    const camerupt = (r2.state.players.A.bench as Slot[]).find(s => s.stack.some(c => c.iid === 'ab3'));
    expect(camerupt?.energy.map(c => c.iid)).toEqual(['ah2']);
    expect(r2.state.players.A.hand.map(c => c.iid)).toEqual(['ah0', 'ah1']);
  });

  it('no Mega ex in play: the Ability is refused [TA-709 pfl-018]', () => {
    const r = step(board(false), [use]) as unknown as Resp;
    expect(r.status).toBe('invalidAction');
  });
});
