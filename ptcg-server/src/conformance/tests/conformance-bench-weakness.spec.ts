import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-600: Weakness and Resistance are never applied to damage done to a Benched Pokémon, unless the card says so
 * (rulebook: "When Benched Pokémon take damage, do not apply Weakness or Resistance"). Two defects, one class:
 * DealDamageEffect applied Weakness to ANY target (Moltres mew-146 Blazing Flight did 240 to a Fire-weak Benched
 * Bellsprout), and THIS_ATTACK_DOES_X_DAMAGE_TO_X_OF_YOUR_OPPONENTS_POKEMON compared the attack's defender (always the
 * Active) instead of the chosen target, so every Bench hit took the Weakness path. The engine now skips W/R for a
 * non-Active DealDamageEffect target unless `applyWeaknessToBench` is set ("Also apply Weakness and Resistance for
 * Benched Pokémon": Galvantula, Beheeyem through the prefab's flag; Espeon PLF explicitly).
 */
function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function pip(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing = 'sve-001'): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string): PrizeRef[] { return cards(tag, 3).map(c => ({ ...c, faceUp: false })); }
function player(over: Partial<PlayerState>, tag: string): PlayerState {
  return { active: null, bench: [], hand: [], deck: cards(`${tag}d`, 6), discard: [], lostZone: [], prizes: prizes(`${tag}p`), flags: flags(), ...over };
}
function game(a: Partial<PlayerState>, b: Partial<PlayerState>): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: player(a, 'a'), B: player(b, 'b') } } as unknown as NeutralState;
}
const benchDamage = (s: NeutralState, iid: string) => s.players.B.bench.find(p => p.stack[0].iid === iid)!.damage;
const damagedHp = (events: unknown[], iid: string) =>
  (events as Array<{ kind: string; target?: string; hp?: number }>).filter(e => e.kind === 'damaged' && e.target === iid).map(e => e.hp);

describe('TA-600: no Weakness or Resistance for a Benched Pokémon unless the card says so', () => {
  it('Moltres mew-146 Blazing Flight: 120 to a Fire-weak Benched Bellsprout, not 240 [TA-600]', () => {
    const fire = (i: number) => ({ iid: `ae${i}`, printing: 'sve-002' });
    const board = game({ active: pip('a1', 'mew-146', [fire(0), fire(1), fire(2)]) },
      { active: pip('b1', 'twm-187'), bench: [pip('bb1', 'asc-004')] });
    const atk = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Blazing Flight' } as never;
    const d = (t: string) => ({ actor: 'A', type: 'discard', owner: 'A', target: t }) as never;
    const res = step(board, [atk, d('ae0'), d('ae1')]);
    expect(damagedHp(res.events, 'bb1')).toEqual([120]);
  });

  it('Cynthia\'s Milotic dri-053 Aqua Split: 30 to a Water-weak Benched Charmander, not 60 [TA-600]', () => {
    const water = (i: number) => ({ iid: `ae${i}`, printing: 'sve-003' });
    const board = game({ active: pip('a1', 'dri-053', [water(0), water(1)]) },
      { active: pip('b1', 'twm-187'), bench: [pip('bb1', 'mew-004'), pip('bb2', 'mew-004')] });
    const atk = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Aqua Split' } as never;
    const choose = (t: string) => ({ actor: 'A', type: 'choose', target: t }) as never;
    const res = step(board, [atk, choose('bb1'), choose('bb2')]);
    expect(res.status).not.toBe('invalidAction');
    expect(benchDamage(res.state, 'bb1')).toBe(30);
    expect(benchDamage(res.state, 'bb2')).toBe(30);
  });

  it('opt-in: Galvantula unm-062 Live Wire ("Also apply Weakness and Resistance for Benched Pokémon") does 100 to a Lightning-weak Benched Dondozo [TA-600]', () => {
    const board = game({ active: pip('a1', 'unm-062', [{ iid: 'ae0', printing: 'sve-004' }]) },
      { active: pip('b1', 'twm-187'), bench: [pip('bb1', 'svi-061')] });
    const atk = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Live Wire' } as never;
    const paused = step(board, [atk]);
    const pick = (paused.pending?.legalActions ?? []).find(a => (a as { target?: string }).target === 'bb1') as never;
    const res = step(board, [atk, pick]);
    expect(benchDamage(res.state, 'bb1')).toBe(100);
  });
});
