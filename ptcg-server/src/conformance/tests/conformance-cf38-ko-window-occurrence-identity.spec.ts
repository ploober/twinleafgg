import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';
import { resolveNextDecomposer } from '../decomposers/resolve-next';
import { ResolveNextPrompt } from '../../game/store/prompts/resolve-next-prompt';
import { Card } from '../../game/store/card/card';

/**
 * CF-38 REOPENED (N-0209) / TA-432 — the KO window is a simultaneous batch, and one source can fire TWICE.
 *
 * `dri-055` Huntail, Diver's Catch: "When 1 of your [W] Pokémon is Knocked Out by damage from an attack
 * from your opponent's Pokémon, you may put all Basic [W] Energy attached to THAT Pokémon into your hand
 * instead of the discard pile." Team Rocket's Arbok `dri-113` Spinning Tail (30 to each of the opponent's
 * Pokémon) Knocks Out two 30-HP Feebas at once; ONE Huntail fires twice. The printing tuple
 * (kind, source, ability) is identical on both firings — only the KO'd SUBJECT tells them apart, which
 * is the `subject` field openapi v0.7.2 added to `resolveNext`.
 *
 * Before this change (driven 2026-09-17 on `4b88a6c0b`): no decision at KO time at all — both Energy
 * went to the discard, A took Prizes, and ONE merged confirm afterwards rescued both or neither. The
 * KO window was not batched (`resolveSimultaneous` was AfterDamageEffect-only) and candidates were
 * per CARD, so two firings of one card could not even be represented.
 *
 * Mutation guards: (1) drop the sweep-level batch → test 1 sees no resolveNext; (2) drop `subject` from
 * the candidate → test 1's two candidates collide and test 4's guard throws on the real board;
 * (3) resolve in list order instead of the pick → tests 2a/2b reach the same hand; (4) revert huntail.ts
 * to the between-turns rescue → test 3 sees takePrize before the confirm.
 */

const WATER = 'sve-003', DARK = 'sve-007';
const EKANS = 'dri-112', ARBOK = 'dri-113';     // Spinning Tail [D][D][D]: 30 to each of the opponent's Pokémon
const CLAMPERL = 'dri-054', HUNTAIL = 'dri-055';
const FEEBAS = 'ssp-198';                        // 30 HP Water Basic

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function pip(stack: CardRef[], energy: CardRef[] = [], damage = 0): PokemonInPlay {
  return { stack, energy, tools: [], damage, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  const wd = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: Array.from({ length: 3 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false })),
    deck: Array.from({ length: 4 }, (_, i) => ({ iid: `${tag}d${i}`, printing: WATER })),
  });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 6, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A: wd(A, 'A'), B: wd(B, 'B') },
  };
}
const arbok = () => player({ active: pip([{ iid: 'a0', printing: EKANS }, { iid: 'a1', printing: ARBOK }],
  [0, 1, 2].map(i => ({ iid: `ae${i}`, printing: DARK }))) });
const huntailWith = (feebas: number) => player({
  active: pip([{ iid: 'b0', printing: CLAMPERL }, { iid: 'b1', printing: HUNTAIL }]),
  bench: Array.from({ length: feebas }, (_, i) => pip([{ iid: `bb${i}`, printing: FEEBAS }], [{ iid: `be${i}`, printing: WATER }])),
});
const attack: NeutralAction = { actor: 'A', type: 'declareAttack', source: 'a0', name: 'Spinning Tail' };
const pick = (subject: string): NeutralAction =>
  ({ actor: 'B', type: 'resolveNext', kind: 'abilityEffect', source: 'b0', ability: "Diver's Catch", subject } as unknown as NeutralAction);
const confirm = (value: boolean): NeutralAction => ({ actor: 'B', type: 'confirm', value });
type Offer = { type: string; kind?: string; source?: string; ability?: string; subject?: string; actor?: string };
const offers = (r: ReturnType<typeof step>): Offer[] => (r.pending?.legalActions ?? []) as unknown as Offer[];
const iids = (refs: CardRef[]) => refs.map(c => c.iid).sort();

describe('CF-38 KO window — one source, two occurrences, told apart by `subject` (dri-055 Diver\'s Catch)', () => {

  it('1. two KO\'d Feebas under one Huntail raise a resolveNext with two candidates that differ ONLY in subject', () => {
    const r = step(board(arbok(), huntailWith(2)), [attack]);
    const o = offers(r);
    expect(o.map(x => x.type)).toEqual(['resolveNext', 'resolveNext']);
    expect(r.pending!.actor).toBe('B');
    for (const c of o) {
      expect(c.kind).toBe('abilityEffect');
      expect(c.source).toBe('b0'); // the Pokémon-in-play (stack basic), as useAbility spells it — TA-433
      expect(c.ability).toBe("Diver's Catch");
    }
    expect(o.map(x => x.subject).sort()).toEqual(['bb0', 'bb1']);
    // Nothing has resolved yet: both Energy are still where they were, no Prize has been offered.
    expect(iids(r.state.players.B.discard)).toEqual([]);
  });

  it('2a. picking bb1 first: the confirm that follows is bb1\'s — yes rescues be1, then bb0\'s confirm declined', () => {
    const r = step(board(arbok(), huntailWith(2)), [attack, pick('bb1'), confirm(true), confirm(false)]);
    expect(iids(r.state.players.B.hand)).toEqual(['be1']);
    expect(iids(r.state.players.B.discard)).toEqual(['bb0', 'bb1', 'be0']);
    expect(offers(r).map(x => x.type)).toEqual(['takePrize', 'takePrize', 'takePrize']);
  });

  it('2b. picking bb0 first reaches a DIFFERENT hand under the same answers — the order is a real decision', () => {
    const r = step(board(arbok(), huntailWith(2)), [attack, pick('bb0'), confirm(true), confirm(false)]);
    expect(iids(r.state.players.B.hand)).toEqual(['be0']);
    expect(iids(r.state.players.B.discard)).toEqual(['bb0', 'bb1', 'be1']);
  });

  it('3. CONTROL — one KO\'d Feebas: no resolveNext (CF-14), the confirm is raised AT the KO, and yes puts the Energy in hand BEFORE any Prize is taken', () => {
    const r1 = step(board(arbok(), huntailWith(1)), [attack]);
    expect(offers(r1).map(x => x.type)).toEqual(['confirm', 'confirm']);
    expect(r1.pending!.actor).toBe('B');
    const r2 = step(board(arbok(), huntailWith(1)), [attack, confirm(true)]);
    expect(iids(r2.state.players.B.hand)).toEqual(['be0']);
    expect(offers(r2).map(x => x.type)).toEqual(['takePrize', 'takePrize', 'takePrize']);
    expect(r2.state.players.A.prizes.length).toBe(3);
  });

  it('4. the decomposer REFUSES two candidates that share the whole identity tuple (the uniqueness invariant)', () => {
    const huntail = { fullName: 'Huntail DRI' } as unknown as Card;
    const prompt = new ResolveNextPrompt(1, [{ card: huntail, ability: "Diver's Catch" }, { card: huntail, ability: "Diver's Catch" }]);
    const ctx = { cardToIid: new Map<Card, string>([[huntail, 'b1']]) } as never;
    expect(() => resolveNextDecomposer.next(prompt, [], ctx, {} as never)).toThrowError(/uniqueness|identity tuple/);
  });
});
