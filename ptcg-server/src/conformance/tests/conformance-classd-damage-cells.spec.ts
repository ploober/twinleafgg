import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * Class-D (2026-09-30) card damage / target findings, each quoted from card-data/final:
 *  - TA-522 Pupitar obf-106 Blasting Tackle (60): "This attack also does 20 damage to 1 of your Benched Pokémon."
 *  - TA-523 Tangrowth meg-007 Pumped-Up Whip (120+, cost GGCC): "If this Pokémon has at least 2 extra Energy attached
 *    (in addition to this attack's cost), this attack does 140 more damage."
 *  - TA-536 Latios par-073 Luster Purge (180): "Discard 3 Energy from this Pokémon."
 *  - TA-540 Arcanine ex svi-032 Raging Claws (30+): "This attack does 10 more damage for each damage counter on this
 *    Pokémon."
 *  - TA-547 Bulbasaur mew-001 / mew-166 Leech Seed (20): "Heal 20 damage from this Pokémon."
 * Each has a control cell where the card is right on the base.
 */

const GRASS = 'sve-001';
const FIRE = 'sve-002';
const PSYCHIC = 'sve-005';
const FIGHTING = 'sve-006';
const DEFENDER = 'meg-181';   // Mega Latias ex, 280 HP, no Weakness, no Resistance
const FILLER = 'jtg-080';     // Larvitar, 70 HP Basic

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
function mon(iid: string, stack: string[], energy: CardRef[] = [], damage = 0): PokemonInPlay {
  return { stack: stack.map((printing, i) => ({ iid: `${iid}s${i}`, printing })), energy, tools: [], damage, conditions: [], markers: markers() };
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, GRASS).map(c => ({ ...c, faceUp: false }));
}
function board(active: PokemonInPlay, aBench: PokemonInPlay[] = [], bBench: PokemonInPlay[] = []): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    format: 'unlimited',
    players: {
      A: player({ active, bench: aBench, deck: cards('ad', 6, GRASS), prizes: prizes('ap', 6) }),
      B: player({ active: mon('b1', [DEFENDER]), bench: bBench, deck: cards('bd', 6, GRASS), prizes: prizes('bp', 6) }),
    },
  } as NeutralState;
}
function attack(name: string): never {
  return { actor: 'A', type: 'declareAttack', source: 'a1s0', name } as never;
}
type Act = { type: string; target?: string; card?: string };
function acts(r: ReturnType<typeof step>): Act[] {
  return (r.pending?.legalActions ?? []) as unknown as Act[];
}

describe('TA-522: Pupitar obf-106 Blasting Tackle hits 1 of YOUR Benched Pokémon', () => {
  const pupitar = () => mon('a1', [FILLER, 'obf-106'], cards('a1e', 2, FIGHTING));

  it('one Benched Pokémon each side: A\'s takes 20, B\'s takes none [TA-522]', () => {
    const r = step(board(pupitar(), [mon('ab1', [FILLER])], [mon('bb1', [FILLER])]), [attack('Blasting Tackle')]);
    expect(r.pending?.actor === 'A' && acts(r).some(a => a.target === 'bb1s0')).toBe(false);
    expect(r.state.players.B.active?.damage).toBe(60);
    expect(r.state.players.A.bench[0]?.damage).toBe(20);
    expect(r.state.players.B.bench[0]?.damage).toBe(0);
  });

  it('two Benched Pokémon of A\'s: the choice offers only A\'s Bench [TA-522]', () => {
    const r = step(board(pupitar(), [mon('ab1', [FILLER]), mon('ab2', [FILLER])], [mon('bb1', [FILLER])]), [attack('Blasting Tackle')]);
    const targets = acts(r).map(a => a.target).sort();
    expect(targets).toEqual(['ab1s0', 'ab2s0']);
  });

  it('A has no Bench, B has one: no bench damage, B\'s Bench untouched [TA-522]', () => {
    const r = step(board(pupitar(), [], [mon('bb1', [FILLER])]), [attack('Blasting Tackle')]);
    expect(r.state.players.B.active?.damage).toBe(60);
    expect(r.state.players.B.bench[0]?.damage).toBe(0);
    expect(r.pending?.actor).toBe('B');
  });

  it('control: no Bench on either side: 60 to the Active only [TA-522]', () => {
    const r = step(board(pupitar()), [attack('Blasting Tackle')]);
    expect(r.state.players.B.active?.damage).toBe(60);
  });
});

describe('TA-523: Tangrowth meg-007 Pumped-Up Whip measures extra Energy against its own cost and adds 140', () => {
  const tangrowth = (n: number, damage = 0) => mon('a1', ['meg-006', 'meg-007'], cards('a1e', n, GRASS), damage);

  it('4 Energy (no extra): 120 [TA-523]', () => {
    expect(step(board(tangrowth(4)), [attack('Pumped-Up Whip')]).state.players.B.active?.damage).toBe(120);
  });

  it('5 Energy (1 extra): 120 [TA-523]', () => {
    expect(step(board(tangrowth(5)), [attack('Pumped-Up Whip')]).state.players.B.active?.damage).toBe(120);
  });

  it('6 Energy (2 extra): 260 [TA-523]', () => {
    expect(step(board(tangrowth(6)), [attack('Pumped-Up Whip')]).state.players.B.active?.damage).toBe(260);
  });

  it('control: Absorb does 30 and heals 30 [TA-523]', () => {
    const r = step(board(tangrowth(2, 50)), [attack('Absorb')]);
    expect(r.state.players.B.active?.damage).toBe(30);
    expect(r.state.players.A.active?.damage).toBe(20);
  });
});

describe('TA-536: Latios par-073 Luster Purge discards 3 Energy, not all', () => {
  const latios = (n: number) => mon('a1', ['par-073'], cards('a1e', n, PSYCHIC));

  it('4 Energy: the player chooses which 3 to discard; 1 stays; 180 [TA-536]', () => {
    const b = board(latios(4));
    const first = step(b, [attack('Luster Purge')]);
    expect(first.pending?.actor).toBe('A');
    const offered = acts(first);
    expect(offered.length).toBe(4);
    expect(offered.every(a => a.type === 'discard')).toBe(true);
    let path: never[] = [attack('Luster Purge')];
    let r = first;
    for (let i = 0; i < 3 && r.pending?.actor === 'A' && acts(r).every(a => a.type === 'discard'); i++) {
      const pick = acts(r).find(a => a.target !== 'a1e3' && a.type === 'discard') as never;
      path = [...path, pick];
      r = step(b, path);
    }
    expect(r.state.players.B.active?.damage).toBe(180);
    expect(r.state.players.A.active?.energy.map(e => e.iid)).toEqual(['a1e3']);
    expect(r.state.players.A.discard.length).toBe(3);
  });

  it('control: exactly 3 Energy: all 3 discarded with no choice, 180 [TA-536]', () => {
    const r = step(board(latios(3)), [attack('Luster Purge')]);
    expect(r.state.players.B.active?.damage).toBe(180);
    expect(r.state.players.A.active?.energy.length).toBe(0);
    expect(r.state.players.A.discard.length).toBe(3);
  });
});

describe('TA-540: Arcanine ex svi-032 Raging Claws adds 10 per damage counter', () => {
  const arcanine = (damage: number) => mon('a1', ['svi-031', 'svi-032'], cards('a1e', 2, FIRE), damage);

  it('2 damage counters (20 damage): 50 [TA-540]', () => {
    expect(step(board(arcanine(20)), [attack('Raging Claws')]).state.players.B.active?.damage).toBe(50);
  });

  it('control: no damage counters: 30 [TA-540]', () => {
    expect(step(board(arcanine(0)), [attack('Raging Claws')]).state.players.B.active?.damage).toBe(30);
  });
});

describe('TA-547: Bulbasaur Leech Seed heals 20', () => {
  for (const printing of ['mew-001', 'mew-166']) {
    const bulbasaur = (damage: number) => mon('a1', [printing], [{ iid: 'a1e0', printing: GRASS }, { iid: 'a1e1', printing: GRASS }], damage);

    it(`${printing}: 40 damage on it, Leech Seed leaves 20 [TA-547]`, () => {
      const r = step(board(bulbasaur(40)), [attack('Leech Seed')]);
      expect(r.state.players.B.active?.damage).toBe(20);
      expect(r.state.players.A.active?.damage).toBe(20);
    });

    it(`control ${printing}: 20 damage on it, Leech Seed leaves 0 [TA-547]`, () => {
      expect(step(board(bulbasaur(20)), [attack('Leech Seed')]).state.players.A.active?.damage).toBe(0);
    });
  }
});
