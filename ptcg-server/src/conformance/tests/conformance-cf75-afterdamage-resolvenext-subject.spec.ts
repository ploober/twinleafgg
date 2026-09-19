import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * CF-75 — the AfterDamage simultaneous batch must carry `subject` on its resolveNext candidates, exactly
 * as the KO-window batch already does (CF-38, openapi v0.7.2 pinned v0.7.3: `subject` is REQUIRED on every
 * resolveNext candidate of the three kinds).
 *
 * `store.resolveSimultaneous` (the AfterDamage batch, #1874) built candidates as `{ card, effect }` with NO
 * `subject`, while `resolveKnockOutReactions` built `{ card, effect, subject }`. Both feed `askResolveNext`,
 * which emits `subject` to the wire only when the actor carries one — so every damage-response order-pick
 * (Smog Signals dri-125, Shell Spikes por-017, Handheld Fan twm-150) emitted subject-less candidates.
 * Rotomancer emits and REQUIRES `subject` there, so replaying twinleaf's subject-less action on rotomancer
 * returns invalidAction (CF-75; walls re162 + ~29 graviton dri-125/resolveNext rows).
 *
 * Board: A's Koffing dri-125 (Smog Signals, a "when damaged" search) wears Adversity Policy cri-074 (its own
 * "when damaged" cardText) — two after-damage reactions on ONE Pokémon. Rolycoly asc-118's Mud-Slap (20) is
 * non-lethal on 70 HP, so this is the AfterDamage batch, NOT the KO window. Both candidates are ABOUT the
 * Koffing, so both must carry `subject` = the Koffing's iid.
 *
 * Mutation guard: revert resolveSimultaneous to `{ card, effect }` and both candidates lose `subject`.
 */

const KOFFING = 'dri-125';
const ADVERSITY_POLICY = 'cri-074';
const ROLYCOLY = 'asc-118';   // Mud-Slap: 20
const FIGHT = 'sve-006';
const WATER = 'sve-003';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function wd(ps: PlayerState, tag: string): PlayerState {
  return {
    ...ps,
    prizes: Array.from({ length: 3 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false })),
    deck: Array.from({ length: 4 }, (_, i) => ({ iid: `${tag}d${i}`, printing: WATER })),
  };
}
// A's Koffing wearing Adversity Policy, with two Koffings in the deck so Smog Signals' search is live.
const koffing = (): PokemonInPlay => ({
  stack: [{ iid: 'k0', printing: KOFFING }],
  energy: [], tools: [{ iid: 'kt0', printing: ADVERSITY_POLICY }], damage: 0, conditions: [], markers: markers(),
});
const rolycoly = (): PokemonInPlay => ({
  stack: [{ iid: 'r0', printing: ROLYCOLY }],
  energy: [{ iid: 're0', printing: FIGHT }], tools: [], damage: 0, conditions: [], markers: markers(),
});

function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 6, activePlayer: 'B', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: { ...wd(player({ active: koffing() }), 'A'), deck: [
        { iid: 'ak0', printing: KOFFING }, { iid: 'ak1', printing: KOFFING },
        { iid: 'ad0', printing: WATER }, { iid: 'ad1', printing: WATER },
      ] },
      B: wd(player({ active: rolycoly() }), 'B'),
    },
  };
}

const attack: NeutralAction = { actor: 'B', type: 'declareAttack', source: 'r0', name: 'Mud-Slap' };
type Offer = { type: string; kind?: string; source?: string; ability?: string; subject?: string };
const offers = (r: ReturnType<typeof step>): Offer[] => (r.pending?.legalActions ?? []) as unknown as Offer[];

describe('CF-75 the AfterDamage batch carries `subject` on its resolveNext candidates', () => {
  it('a non-lethal hit on Koffing+Adversity Policy raises two resolveNext candidates, both carrying subject=the Koffing', () => {
    const r = step(board(), [attack]);
    const rn = offers(r).filter(o => o.type === 'resolveNext');
    // Two after-damage reactions on one Pokémon -> an order pick with two candidates.
    expect(rn.length).toBe(2);
    // Every candidate must carry `subject` = the damaged Koffing's iid (openapi v0.7.3).
    for (const c of rn) {
      expect(c.subject).toBe('k0');
    }
  });
});
