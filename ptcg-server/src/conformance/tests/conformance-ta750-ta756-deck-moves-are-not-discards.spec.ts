import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-750 / TA-756 — two picks that put a card into the deck were raised as CHOOSE_CARD_TO_DISCARD, and the adapter keys
 * the `discard` verb on that message (CF-8), so they were offered as `discard {destination: discardPile}`:
 *   - Up-Tempo ssp-052: "You must put a card from your hand on the bottom of your deck in order to use this Ability."
 *   - Team Star Grunt svi-195: "Put an Energy attached to your opponent's Active Pokémon on top of their deck." — also
 *     asked when only one Energy is attached (CF-14: a forced pick collapses).
 * Energy Swatter's TA-704 shape: the prompt names the real destination. Up-Tempo uses CHOOSE_CARD_TO_PUT_ON_BOTTOM
 * (offered as choose {op: moveTo, destination: deckBottom}); Grunt uses CHOOSE_CARD_TO_DECK and cannot be cancelled.
 * Mutation guard: put back CHOOSE_CARD_TO_DISCARD on either card → its first test sees `discard`.
 */

const WATER = 'sve-003', GRASS = 'sve-001', FILLER = 'pal-090';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function pip(stack: CardRef[], energy: CardRef[] = []): PokemonInPlay {
  return { stack, energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(tag: string, over: Partial<PlayerState>): PlayerState {
  return {
    active: null, bench: [], hand: [], discard: [], lostZone: [],
    deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: WATER })),
    prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false })),
    flags: flags(), ...over,
  };
}
function state(A: PlayerState, B: PlayerState): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B },
  };
}
type La = { type: string; target?: string; op?: string; destination?: string };
const offered = (r: ReturnType<typeof step>): La[] => (r.pending?.legalActions ?? []) as unknown as La[];

describe('TA-750 — Up-Tempo ssp-052 offers its cost as a move to the bottom of the deck', () => {
  const upTempo = () => state(
    player('a', { active: pip([{ iid: 'a1s0', printing: 'ssp-052' }]), hand: [{ iid: 'ah0', printing: WATER }, { iid: 'ah1', printing: GRASS }] }),
    player('b', { active: pip([{ iid: 'b1s0', printing: FILLER }]) }),
  );
  const use = { actor: 'A', type: 'useAbility', source: 'a1s0', ability: 'Up-Tempo' } as unknown as NeutralAction;

  it('the cost pick is choose {op: moveTo, destination: deckBottom}, not discard', () => {
    const r = step(upTempo(), [use]);
    expect(offered(r).map(a => `${a.type}:${a.target}:${a.op}:${a.destination}`).sort())
      .toEqual(['choose:ah0:moveTo:deckBottom', 'choose:ah1:moveTo:deckBottom']);
  });
  it('the chosen card goes to the bottom of the deck, then the draw refills the hand', () => {
    const r = step(upTempo(), [use, { actor: 'A', type: 'choose', target: 'ah0' } as unknown as NeutralAction]);
    const A = r.state.players.A;
    expect(A.discard).toEqual([]);
    expect(A.hand.length).toBe(5);
    expect(A.hand.map(c => c.iid)).not.toContain('ah0');
    expect(A.deck[A.deck.length - 1].iid).toBe('ah0');
  });
});

describe('TA-756 — Team Star Grunt svi-195 puts the Energy on top of the deck', () => {
  const grunt = (energy: CardRef[]) => state(
    player('a', { active: pip([{ iid: 'a1s0', printing: FILLER }]), hand: [{ iid: 'grunt', printing: 'svi-195' }] }),
    player('b', { active: pip([{ iid: 'b1s0', printing: FILLER }], energy) }),
  );
  const play = { actor: 'A', type: 'playSupporter', card: 'grunt' } as unknown as NeutralAction;

  it('two Energy: the pick is choose, not discard', () => {
    const r = step(grunt([{ iid: 'b1e1', printing: WATER }, { iid: 'b1e2', printing: GRASS }]), [play]);
    expect(offered(r).map(a => `${a.type}:${a.target}`).sort()).toEqual(['choose:b1e1', 'choose:b1e2']);
  });
  it('one Energy: the pick collapses (A is back at its main) and the Energy is on top of B\'s deck', () => {
    const r = step(grunt([{ iid: 'b1e1', printing: WATER }]), [play]);
    expect(offered(r).some(a => a.target === 'b1e1')).toBe(false);
    const B = r.state.players.B;
    expect(B.active?.energy).toEqual([]);
    expect(B.deck[0].iid).toBe('b1e1');
    expect(B.discard).toEqual([]);
  });
});
