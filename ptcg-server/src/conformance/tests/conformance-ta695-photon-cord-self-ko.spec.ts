import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-695 — Photon Cord pbl-028 fires on Miraidon's OWN Thunder recoil Knock Out.
 *
 * Photon Cord (card-data/final/pbl.json): "If this Pokémon is in the Active Spot and is Knocked Out by damage from an
 * attack from your opponent's Pokémon, move up to 2 Basic [Lightning] Energy cards from this Pokémon to 1 of your
 * Benched Pokémon." Thunder: "This Pokémon also does 30 damage to itself."
 *
 * Miraidon at 90 damage uses Thunder: the 30 recoil Knocks it Out. The Knock Out is by damage from ITS OWN attack,
 * not "from an attack from your opponent's Pokémon", so Photon Cord does not fire: the attached Energy are discarded
 * with Miraidon. Rotomancer agrees (RE-145, fixed there 2026-09-07). Twinleaf gated the Ability on the player-level
 * DAMAGE_DEALT_MARKER alone, which the recoil sets too, so it pended `moveEnergy` and the [L] landed on the Bencher.
 *
 * The opponent's-attack path (the Ability DOES fire) is conformance-ta446-photon-cord-no-decline-at-zero.spec.ts.
 */

const MIRAIDON = 'pbl-028';
const BELLSPROUT = 'asc-004';
const GRENINJA_EX = 'twm-106';   // 310 HP: survives the 90
const LIGHTNING = 'sve-004';
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
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, WATER).map(c => ({ ...c, faceUp: false }));
}
function mon(iid: string, printing: string, energy: string[], damage = 0): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: energy.map((p, i) => ({ iid: `${iid}e${i}`, printing: p })), tools: [], damage, conditions: [], markers: markers() };
}

/** A's turn. Miraidon Active at 90 damage with two Basic [L]; a Benched Pokémon that could receive them. */
function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon('a1', MIRAIDON, [LIGHTNING, LIGHTNING], 90), bench: [mon('ab1', BELLSPROUT, [])],
        hand: cards('ah', 1, WATER), deck: cards('ad', 6, WATER), prizes: prizes('ap', 6),
      }),
      B: player({
        active: mon('b1', GRENINJA_EX, [WATER, WATER]), bench: [mon('bb1', BELLSPROUT, [])],
        hand: cards('bh', 1, WATER), deck: cards('bd', 6, WATER), prizes: prizes('bp', 6),
      }),
    },
  } as NeutralState;
}

const thunder: NeutralAction = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Thunder' };

describe('TA-695 Photon Cord pbl-028 does not fire on a Knock Out by this Pokémon\'s own attack damage', () => {
  it('Thunder\'s recoil Knocks Miraidon Out: no moveEnergy is offered [TA-695]', () => {
    const r = step(board(), [thunder]);
    const la = r.pending?.legalActions ?? [];
    expect(la.map(a => a.type)).not.toContain('moveEnergy');
    expect(r.events.some(e => e.kind === 'ko' && (e as { player: string }).player === 'A' && (e as { target: string }).target === 'a1')).toBe(true);
  });

  it('Thunder\'s recoil Knocks Miraidon Out: both [L] go to the discard pile with it, none to the Bencher [TA-695]', () => {
    const r = step(board(), [thunder]);
    const discard = r.state.players.A.discard.map(c => c.iid);
    expect(discard).toContain('a1');
    expect(discard).toContain('a1e0');
    expect(discard).toContain('a1e1');
    const inPlay = [r.state.players.A.active, ...r.state.players.A.bench].filter((p): p is PokemonInPlay => p !== null);
    for (const p of inPlay) {
      expect(p.energy.map(e => e.iid)).not.toContain('a1e0');
      expect(p.energy.map(e => e.iid)).not.toContain('a1e1');
    }
    expect(r.state.players.B.active?.damage).toBe(90);
  });
});
