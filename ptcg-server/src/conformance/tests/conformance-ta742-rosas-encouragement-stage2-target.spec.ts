import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-742: Rosa's Encouragement por-084: "You can use this card only if you have more Prize cards remaining than your
 * opponent. Attach up to 2 Basic Energy cards from your discard pile to 1 of your Stage 2 Pokémon." twinleaf put
 * `stage: STAGE_2` in the prompt's CARD filter, which is matched against the Energy cards, so nothing could be picked
 * and the prompt (min 0) closed empty. Found by bug report 1560088930920173701. Board: A has 6 Prizes left to B's 3,
 * Cynthia's Garchomp ex dri-104 (Stage 2) on the Bench beside a Basic Active, 2 Basic Fighting in the discard.
 */

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function mon(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(tag: string, prizeCount: number, over: Partial<PlayerState>): PlayerState {
  const deck: CardRef[] = Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}d${i}`, printing: 'sve-003' }));
  const prizes: PrizeRef[] = Array.from({ length: prizeCount }, (_, i) => ({ iid: `${tag}p${i}`, printing: 'sve-003', faceUp: false }));
  return { active: null, bench: [], hand: [], deck, discard: [], lostZone: [], prizes, flags: flags(), ...over };
}
function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 5, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player('A', 6, {
        active: mon('a0', 'pal-090'), bench: [mon('a1', 'dri-104'), mon('a2', 'pal-090')],
        hand: [{ iid: 'ah0', printing: 'por-084' }], discard: [{ iid: 'ax0', printing: 'sve-006' }, { iid: 'ax1', printing: 'sve-006' }],
      }),
      B: player('B', 3, { active: mon('b0', 'pal-090') }),
    },
  } as NeutralState;
}

describe('TA-742 Rosa\'s Encouragement attaches to a Stage 2 Pokemon', () => {
  it('[TA-742 por-084] the attach is offered, only onto the Stage 2, and both Energy land on it', () => {
    const actions: never[] = [{ actor: 'A', type: 'playSupporter', card: 'ah0' } as never];
    let r = step(board(), actions);
    const offered = r.pending?.legalActions ?? [];
    expect(offered.length).toBeGreaterThan(0);
    // "up to 2" on a Trainer is 1..2 (compendium #2301): no stop before the first attach.
    expect(offered.some(a => a.type === 'confirm')).toBe(false);
    for (const a of offered) {
      const target = (a as { target?: string }).target;
      if (target !== undefined) { expect(target).toBe('a1'); }
    }
    for (let i = 0; i < 4 && r.pending && r.pending.descriptor !== 'main'; i++) {
      const pick = (r.pending.legalActions ?? []).find(a => (a as { target?: string }).target === 'a1') ?? r.pending.legalActions[0];
      actions.push(pick as never);
      r = step(board(), actions);
    }
    expect(r.state.players.A.bench[0].energy.map(c => c.iid).sort()).toEqual(['ax0', 'ax1']);
    expect(r.state.players.A.active!.energy.length).toBe(0);
    expect(r.state.players.A.bench[1].energy.length).toBe(0);
  });
});
