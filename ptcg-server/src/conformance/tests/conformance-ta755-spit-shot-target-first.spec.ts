import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-755 — Spit Shot twm-058 (Cramorant): "Discard all Energy from this Pokémon. This attack does 120 damage to 1 of
 * your opponent's Pokémon." The target is the attacker's Step-D choice (B.89) and no card is chosen, so the Energy stays
 * attached through the pick and the damage and is discarded after it (TA-613's Sonic Ripper shape). The script
 * discarded the Energy first.
 * Mutation guard: discard before the damage prompt again -> the pick cell sees 0 Energy on a1s0.
 */

const WATER = 'sve-003', FILLER = 'asc-004';

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
type La = { type: string; target?: string; actor?: string };
const offered = (r: ReturnType<typeof step>): La[] => (r.pending?.legalActions ?? []) as unknown as La[];


describe('TA-755 — Spit Shot twm-058 chooses the target before the Energy is discarded', () => {
  const board = () => state(
    player('a', { active: pip([{ iid: 'a1s0', printing: 'twm-058' }], [0, 1, 2].map(i => ({ iid: `a1e${i}`, printing: WATER }))) }),
    player('b', { active: pip([{ iid: 'b1s0', printing: FILLER }]), bench: [pip([{ iid: 'bb1s0', printing: FILLER }])] }),
  );
  const declare = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Spit Shot' } as unknown as NeutralAction;

  it('at the target pick the three Energy are still attached [TA-755 twm-058]', () => {
    const r = step(board(), [declare]);
    expect(offered(r).map(a => a.target).sort()).toEqual(['b1s0', 'bb1s0']);
    expect(r.state.players.A.active?.energy.map(e => e.iid)).toEqual(['a1e0', 'a1e1', 'a1e2']);
    expect(r.state.players.A.discard).toEqual([]);
  });
  it('after the pick: 120 on the Benched target, then the Energy is in the discard pile [TA-755 twm-058 after]', () => {
    const r = step(board(), [declare, { actor: 'A', type: 'choose', target: 'bb1s0' } as unknown as NeutralAction]);
    expect((r.events as unknown as Array<{ kind: string; target?: string; hp?: number }>)
      .filter(e => e.kind === 'damaged').map(e => `${e.target}:${e.hp}`)).toEqual(['bb1s0:120']);
    expect(r.state.players.A.active?.energy).toEqual([]);
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['a1e0', 'a1e1', 'a1e2']);
    const kinds = (r.events as unknown as Array<{ kind: string; destination?: { zone: string } }>);
    const dmg = kinds.findIndex(e => e.kind === 'damaged');
    const disc = kinds.findIndex(e => e.kind === 'moved' && e.destination?.zone === 'discardPile');
    expect(dmg).toBeGreaterThanOrEqual(0);
    expect(disc).toBeGreaterThan(dmg);
  });
});
