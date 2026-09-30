import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-493 — an attack whose cost is met may be used; the part that cannot happen does nothing (#352 "you do as much
 * of the attack as you can"; #1962 Summoning Gate "if you use this attack when your Bench is full, the attack does
 * nothing"; TA-97). The Ability rule B.29 / #2306 does not carry over to attacks.
 *
 *   Tinkatink pal-101 Scrap Pickup — "Put an Item card from your discard pile into your hand."
 *   Groudon par-093 Swelling Power — "Attach a Basic [F] Energy card from your hand to 1 of your Pokémon."
 *   Chi-Yu par-029 Flare Bringer — "Attach up to 2 Basic [R] Energy cards from your discard pile to 1 of your Pokémon."
 *
 * Each handler threw on the empty operand, so the attack probe withheld the attack; Scrap Pickup also ran an Item
 * card's body (preventDefault on the attack, and moving Tinkatink from the hand to the discard).
 *
 * Mutation guards: restore any throw and its "offered" cell goes red; restore the Item body and the Scrap Pickup
 * resolution cell goes red.
 */

const GRASS = 'sve-001';
const FIRE = 'sve-002';
const FIGHTING = 'sve-006';
const BELLSPROUT = 'asc-004';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, energy: string[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })), tools: [], damage: 0,
    conditions: [], markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false } };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function deck(tag: string): CardRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS }));
}
function board(active: PokemonInPlay, discard: string[] = [], hand: string[] = []): NeutralState {
  const A: PlayerState = { active, bench: [mon('a2', BELLSPROUT)], hand: hand.map((printing, i) => ({ iid: `ah${i}`, printing })),
    deck: deck('a'), discard: discard.map((printing, i) => ({ iid: `ax${i}`, printing })), lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', BELLSPROUT), bench: [mon('b2', BELLSPROUT)], hand: [], deck: deck('b'), discard: [],
    lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const attack = (name: string) => ({ actor: 'A', type: 'declareAttack', source: 'a1', name } as unknown as NeutralAction);
function offers(s: NeutralState, name: string): boolean {
  return (step(s, []).pending?.legalActions || []).some(a => a.type === 'declareAttack' && (a as { name?: string }).name === name);
}

describe('TA-493 an attack is usable when its effect has nothing to act on', () => {
  it('Scrap Pickup is offered with no Item in the discard, and the turn passes [TA-493 pal-101]', () => {
    const s = board(mon('a1', 'pal-101', [GRASS]));
    expect(offers(s, 'Scrap Pickup')).toBe(true);
    expect(step(s, [attack('Scrap Pickup')]).state.activePlayer).toBe('B');
  });
  it('Scrap Pickup with an Item puts it in the hand and leaves Tinkatink in play [TA-493 pal-101]', () => {
    const r = step(board(mon('a1', 'pal-101', [GRASS]), ['svi-181']), [attack('Scrap Pickup')]);
    expect(r.state.players.A.hand.map(c => c.iid)).toContain('ax0');
    expect(r.state.players.A.active!.stack.map(c => c.printing)).toEqual(['pal-101']);
  });
  it('Swelling Power is offered with no Basic [F] Energy in hand [TA-493 par-093]', () => {
    expect(offers(board(mon('a1', 'par-093', [GRASS]), [], [GRASS]), 'Swelling Power')).toBe(true);
  });
  it('Swelling Power with a Basic [F] in hand still attaches it [TA-493 par-093]', () => {
    const r = step(board(mon('a1', 'par-093', [GRASS]), [], [FIGHTING]), [attack('Swelling Power')]);
    expect((r.pending?.legalActions || []).some(a => a.type === 'attachEnergy')).toBe(true);
  });
  it('Flare Bringer is offered with no Basic [R] Energy in the discard [TA-493 par-029]', () => {
    expect(offers(board(mon('a1', 'par-029', [FIRE])), 'Flare Bringer')).toBe(true);
  });
});
