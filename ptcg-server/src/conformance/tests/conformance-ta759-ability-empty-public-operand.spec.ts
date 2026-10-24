import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction, ConditionToken,
} from '../neutral-types';

/**
 * TA-759 (B.27 / B.29 rule 1: an Ability whose required operand is empty in public view cannot be used; #13, #49) —
 * five Abilities were offered with nothing to act on:
 *  - Spike-Clad jtg-085 / jtg-166 (Lycanroc): "Attach up to 2 Spiky Energy cards from your discard pile" — no Spiky Energy
 *    in the discard pile.
 *  - Enriching Melody pbl-020 / pbl-088 (Primarina): "Heal all damage from 1 of your Pokémon" — none of them damaged.
 *  - Wafting Heal tef-015 (Whimsicott): "heal all damage from your Active [G] Pokémon" — the Active has no damage.
 *  - Battle-Hardened pre-054 / sfa-025 (Bloodmoon Ursaluna): "attach up to 2 Basic [F] Energy cards from your hand" — no
 *    Basic [F] Energy in the hand (it asked, then threw on yes).
 *  - Busybody Nurse svi-145 (Blissey): "Your Active Pokémon recovers from all Special Conditions" — none.
 * Each has a control with the operand present, so the gate cannot pass by never offering.
 * Mutation guard: drop any one gate -> its "withheld" cell sees the confirm (or the useAbility) again.
 */

const GRASS = 'sve-001', PSYCHIC = 'sve-005', FIGHTING = 'sve-006', WATER = 'sve-003', FILLER = 'asc-004';
const SPIKY = 'jtg-159', ROCKRUFF = 'jtg-084', BRIONNE = 'pbl-019', COTTONEE = 'wht-004';

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

const confirmOffered = (r: ReturnType<typeof step>): boolean => offered(r).some(a => a.type === 'confirm');
const base = (A: Partial<PlayerState>) => state(player('a', A), player('b', { active: pip([{ iid: 'b1s0', printing: FILLER }]) }));
const evolve = { actor: 'A', type: 'evolve', card: 'ah0', target: 'a1s0' } as unknown as NeutralAction;
const damaged = (p: PokemonInPlay, d: number): PokemonInPlay => ({ ...p, damage: d });

describe('TA-759 — Spike-Clad (Lycanroc) needs a Spiky Energy in the discard pile', () => {
  for (const printing of ['jtg-085', 'jtg-166']) {
    const board = (discard: CardRef[]) => base({ active: pip([{ iid: 'a1s0', printing: ROCKRUFF }]), hand: [{ iid: 'ah0', printing }], discard });
    it(`empty discard: not offered [TA-759 ${printing}]`, () => {
      const r = step(board([]), [evolve]);
      expect(r.status).not.toBe('invalidAction');
      expect(confirmOffered(r)).toBe(false);
    });
    it(`a Spiky Energy in the discard: offered [TA-759 ${printing} control]`, () => {
      expect(confirmOffered(step(board([{ iid: 'adc0', printing: SPIKY }]), [evolve]))).toBe(true);
    });
  }
});

describe('TA-759 — Enriching Melody (Primarina) needs a damaged Pokémon', () => {
  for (const printing of ['pbl-020', 'pbl-088']) {
    const board = (d: number) => base({ active: pip([{ iid: 'a1s0', printing: BRIONNE }]), bench: [damaged(pip([{ iid: 'ab1s0', printing: FILLER }]), d)], hand: [{ iid: 'ah0', printing }] });
    it(`no damage in play: not offered [TA-759 ${printing}]`, () => {
      const r = step(board(0), [evolve]);
      expect(r.status).not.toBe('invalidAction');
      expect(confirmOffered(r)).toBe(false);
    });
    it(`a damaged Benched Pokémon: offered [TA-759 ${printing} control]`, () => {
      expect(confirmOffered(step(board(30), [evolve]))).toBe(true);
    });
  }
});

describe('TA-759 — Wafting Heal (Whimsicott tef-015) needs damage on the Active', () => {
  const board = (d: number) => base({ active: damaged(pip([{ iid: 'a1s0', printing: COTTONEE }], [{ iid: 'a1e0', printing: GRASS }]), d), hand: [{ iid: 'ah0', printing: 'tef-015' }] });
  it('the Active undamaged: not offered [TA-759 tef-015]', () => {
    const r = step(board(0), [evolve]);
    expect(r.status).not.toBe('invalidAction');
    expect(confirmOffered(r)).toBe(false);
  });
  it('the Active damaged: offered [TA-759 tef-015 control]', () => {
    expect(confirmOffered(step(board(20), [evolve]))).toBe(true);
  });
});

describe('TA-759 — Battle-Hardened (Bloodmoon Ursaluna) needs a Basic [F] Energy in the hand', () => {
  for (const printing of ['sfa-025', 'pre-054']) {
    const board = (hand: CardRef[]) => base({ active: pip([{ iid: 'a1s0', printing: FILLER }]), hand: [{ iid: 'ah0', printing }, ...hand] });
    const bench = { actor: 'A', type: 'benchBasic', card: 'ah0' } as unknown as NeutralAction;
    it(`Grass and Psychic Energy in hand: not offered [TA-759 ${printing}]`, () => {
      const r = step(board([{ iid: 'ah1', printing: GRASS }, { iid: 'ah2', printing: PSYCHIC }]), [bench]);
      expect(r.status).not.toBe('invalidAction');
      expect(confirmOffered(r)).toBe(false);
    });
    it(`a Basic [F] Energy in hand: offered [TA-759 ${printing} control]`, () => {
      expect(confirmOffered(step(board([{ iid: 'ah1', printing: FIGHTING }]), [bench]))).toBe(true);
    });
  }
});

describe('TA-759 — Busybody Nurse (Blissey svi-145) needs a Special Condition on the Active', () => {
  const board = (conditions: ConditionToken[]) => base({
    active: { ...pip([{ iid: 'a1s0', printing: FILLER }]), conditions },
    bench: [pip([{ iid: 'ab1s0', printing: 'svi-145' }])],
  });
  const nurse = (r: ReturnType<typeof step>) => (offered(r) as Array<La & { ability?: string }>).some(a => a.type === 'useAbility' && a.ability === 'Busybody Nurse');
  it('no Special Condition: not offered [TA-759 svi-145]', () => {
    expect(nurse(step(board([]), []))).toBe(false);
  });
  it('the Active Poisoned: offered [TA-759 svi-145 control]', () => {
    expect(nurse(step(board(['poisoned']), []))).toBe(true);
  });
});
