import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-479 — Grand Tree scr-136 under New Moon (Lunatone obf-092 + Solrock in play): "prevent all effects of
 * any Stadium done to your Pokémon in play". B.70 (official FAQ: Stadium evolution under New Moon — "no, you
 * can't"): a protected Basic is out of Grand Tree's reach, and with every evolvable Basic protected the use is
 * refused (#2030: a known valid evolution path is required to use Grand Tree). twinleaf's use-Stadium effect
 * never consulted New Moon (UseStadiumEffect is not a StadiumEffect), so the protected Charmander evolved.
 *
 * Incidental on the same board (TA-480): Lunatone and Solrock were offered as evolve targets although neither
 * has a Stage 1 — the candidate pool is the Basics a known Stage 1 evolves from (#2030).
 *
 * TA-481: "that player may search their deck" over a hidden deck — the player may voluntarily fail to find
 * (CF-32 / TA-145 shape): the search is min 0, the decline is the zero-take, and the deck is still shuffled.
 *
 * Mutation guard: drop the IS_STADIUM_EFFECT_BLOCKED filter in grand-tree.ts and the New Moon cell goes red;
 * the no-Solrock control pins that the Stadium still works when New Moon is inactive.
 */

const LUNATONE = 'obf-092';
const SOLROCK = 'meg-075';
const CHARMANDER = 'obf-026';
const CHARMELEON = 'obf-027';
const GRAND_TREE = 'scr-136';
const MUNKIDORI = 'twm-095';
const FIRE = 'sve-002';
const GRASS = 'sve-001';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function board(withSolrock: boolean): NeutralState {
  const bench = withSolrock ? [mon('bb0', SOLROCK), mon('bb1', CHARMANDER)] : [mon('bb1', CHARMANDER)];
  const A: PlayerState = { active: mon('a0', LUNATONE), bench, hand: [{ iid: 'ah0', printing: FIRE }],
    deck: [{ iid: 'ad0', printing: CHARMELEON }, { iid: 'ad1', printing: FIRE }, { iid: 'ad2', printing: FIRE }],
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b0', MUNKIDORI), bench: [], hand: [], deck: [{ iid: 'bd0', printing: GRASS }],
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 5, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: { iid: 'st0', printing: GRAND_TREE, owner: 'A' } as any, players: { A, B } };
}
const useStadium = { actor: 'A', type: 'useStadium' } as unknown as NeutralAction;

function stageOf(r: ReturnType<typeof step>, iid: string): string[] {
  const slot = [r.state.players.A.active, ...r.state.players.A.bench].find(s => s && s.stack.some(c => c.iid === iid));
  return slot ? slot.stack.map(c => c.printing) : [];
}

describe('TA-479 Grand Tree cannot evolve a New Moon-protected Basic', () => {
  it('New Moon active, every evolvable Basic protected: Grand Tree cannot be used (#2030) [TA-479 scr-136 obf-092]', () => {
    const r = step(board(true), [useStadium]);
    expect(r.status).toBe('invalidAction');
    expect(stageOf(r, 'bb1')).toEqual([CHARMANDER]);
  });

  it('control, no Solrock: Grand Tree evolves Charmander [TA-479 scr-136]', () => {
    const r = step(board(false), [useStadium, { actor: 'A', type: 'choose', target: 'ad0' } as unknown as NeutralAction]);
    expect(r.status).not.toBe('invalidAction');
    expect(stageOf(r, 'bb1')).toEqual([CHARMANDER, CHARMELEON]);
  });

  it('the Stage 1 search may fail to find: a decline takes zero and still shuffles [TA-481 scr-136]', () => {
    const decline = { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction;
    const offered = step(board(false), [useStadium]);
    expect(JSON.stringify((offered as any).pending)).toContain('"value":false');
    const r = step(board(false), [useStadium, decline]);
    expect(r.status).not.toBe('invalidAction');
    expect(stageOf(r, 'bb1')).toEqual([CHARMANDER]);
    expect(JSON.stringify((r as any).pending)).toContain('shuffle');
  });

  it('control, no Solrock: only Charmander is an evolve target - Lunatone has no Stage 1 [TA-480 scr-136]', () => {
    const r = step(board(false), [useStadium]);
    expect(r.status).toBe('awaitingAction');
    // The one valid target collapses (CF-14); the next decision is the Charmeleon search, not a target pick.
    expect(JSON.stringify((r as any).pending)).not.toContain('"a0"');
  });
});
