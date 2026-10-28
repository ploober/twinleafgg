import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * Compendium #2400 (Pitch Black FAQ): "If I have Miraidon in the active spot and my opponent uses Cranidos' 'Push Down'
 * attack to KO Miraidon, can I still use Miraidon's 'Photon Cord' Ability? And if so, can I choose to have it move the
 * energy to itself? — Yes, you would still have the opportunity to use Photon Cord. However, even though Miraidon is on the
 * bench due to Push Down you cannot move the Energy onto itself." Miraidon pbl-028 Photon Cord: "If this Pokémon is in the
 * Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon, move up to 2 Basic [L] Energy cards
 * from this Pokémon to 1 of your Benched Pokémon." Cranidos pbl-044 Push Down 70: "Switch out your opponent's Active
 * Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"
 */

const GRASS = 'sve-001', FIGHTING = 'sve-006', LIGHTNING = 'sve-004';
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, damage = 0, energy: string[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })), tools: [], damage,
    conditions: [], markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false } };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function side(tag: string, active: PokemonInPlay, bench: PokemonInPlay[]): PlayerState {
  return { active, bench, hand: [], deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS })),
    discard: [], lostZone: [], prizes: prizes(tag), flags: flags() };
}
function board(attacker: PokemonInPlay): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main',
    outcome: 'ongoing', stadium: null,
    players: { A: side('a', attacker, [mon('a2', 'asc-004')]),
      B: side('b', mon('b1', 'pbl-028', 50, [LIGHTNING, LIGHTNING]), [mon('b2', 'asc-004'), mon('b3', 'asc-004')]) } };
}
const act = (a: object) => a as unknown as NeutralAction;
const pushDown = act({ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Push Down' });
const promoteB2 = act({ actor: 'B', type: 'promoteBench', target: 'b2' });
const targets = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? []).map(a => (a as { target?: string }).target).filter(Boolean).sort();

describe('Photon Cord after Push Down (#2400)', () => {
  it('Miraidon pushed to the Bench and Knocked Out: Photon Cord is offered [TA-797 pbl-028 pushed]', () => {
    const r = step(board(mon('a1', 'pbl-044', 0, [FIGHTING, FIGHTING])), [pushDown, promoteB2]);
    expect(r.pending?.actor).toBe('B');
    expect(targets(r)).toEqual(['b1e0', 'b1e1']);
  });
  it('the Energy goes to the other Benched Pokémon, never onto Miraidon itself [TA-797 pbl-028 not-itself]', () => {
    const b = board(mon('a1', 'pbl-044', 0, [FIGHTING, FIGHTING]));
    let acts: NeutralAction[] = [pushDown, promoteB2];
    for (let i = 0; i < 6; i++) {
      const r = step(b, acts);
      const la = (r.pending?.legalActions ?? []) as { type: string; target?: string }[];
      if (r.pending?.actor !== 'B' || !la.some(x => x.target === 'b1e0' || x.target === 'b1e1' || x.target === 'b3')) { break; }
      expect(la.some(x => x.target === 'b1')).toBe(false);
      const next = la.find(x => x.target === 'b1e0' || x.target === 'b1e1') ?? la.find(x => x.target === 'b3');
      acts = [...acts, next as unknown as NeutralAction];
    }
    const end = step(b, acts);
    const b3 = end.state.players.B.bench.find(s => s.stack[0].iid === 'b3');
    expect(b3?.energy.length).toBeGreaterThan(0);
  });
});
