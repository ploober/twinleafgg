import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-629 follow-up: Geeta obf-188 ("Search your deck for up to 2 Basic Energy cards and attach them to 1 of your
 * Pokémon. Then, shuffle your deck. ...") is still resolving at its shuffle: a Trainer goes to the discard pile after
 * its effect, and the shuffle is part of it. The TA-629 fix raised the shuffle after Geeta's own discard, so the shuffle
 * pause showed Geeta in the discard pile (rotomancer shows it resolving). Found by the TA-629 re-fuzz.
 */

const E = 'sve-001';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, E).map(c => ({ ...c, faceUp: false }));
}
function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon('a1', 'asc-004'), bench: [mon('ab1', 'asc-004')],
        hand: [{ iid: 'g', printing: 'obf-188' }], deck: cards('ad', 6, E), prizes: prizes('ap', 6),
      }),
      B: player({ active: mon('b1', 'asc-004'), deck: cards('bd', 6, E), prizes: prizes('bp', 6) }),
    },
  };
}

const play = { actor: 'A', type: 'playSupporter', card: 'g' } as never;
const choose = (target: string) => ({ actor: 'A', type: 'choose', target } as never);
const atShuffle = (r: ReturnType<typeof step>) => {
  expect(r.pending?.legalActions.some(a => a.type === 'shuffle')).toBe(true);
  expect(r.state.players.A.discard.map(c => c.iid)).not.toContain('g');
};

describe('TA-629: Geeta obf-188 is still resolving at its shuffle', () => {
  it('attach 2 Energy: at the shuffle pause Geeta is not yet in the discard pile [TA-629 obf-188]', () => {
    atShuffle(step(board(), [play, choose('ad0'), choose('ad1'), choose('a1')]));
  });

  it('after the shuffle Geeta is in the discard pile [TA-629 obf-188]', () => {
    const acts = [play, choose('ad0'), choose('ad1'), choose('a1')];
    const offered = step(board(), acts).pending?.legalActions.find(a => a.type === 'shuffle') as { deck?: string[] } | undefined;
    expect(offered).toBeDefined();
    const r = step(board(), [...acts, { actor: 'system', type: 'shuffle', order: offered?.deck ?? [] } as never]);
    expect(r.pending?.legalActions.some(a => a.type === 'shuffle')).toBe(false);
    expect(r.state.players.A.discard.map(c => c.iid)).toContain('g');
  });
});
