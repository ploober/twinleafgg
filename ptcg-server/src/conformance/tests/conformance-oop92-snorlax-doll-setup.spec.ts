import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, CardRef, SCHEMA_VERSION, NeutralAction } from '../neutral-types';

/**
 * OOP-92 — Snorlax Doll par-175: "If this card is in your hand when you are setting up to play, you may put it face
 * down in the Active Spot or on your Bench as if it were a 120-HP Basic [C] Pokémon." snorlax-doll.ts declared
 * `cardTag = [PLAY_DURING_SETUP]`, but Card.tags reads `_tags`, so the setup reducer never saw the tag and the Doll
 * was never offered.
 *
 * Mutation guard: restore `cardTag` in place of `_tags` and the starter-offer cell goes red; the control pins that a
 * hand without the Doll still offers only the Basic.
 */

const DROWZEE = 'sit-060';
const DOLL = 'par-175';
const GRASS = 'sve-001';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function deck(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function player(d: CardRef[]): PlayerState {
  return { active: null, bench: [], hand: [], deck: d, discard: [], lostZone: [], prizes: [], flags: flags() };
}
function preDeal(a: CardRef[], b: CardRef[]): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 0, activePlayer: 'A', firstPlayer: null, phase: 'setup', outcome: 'ongoing',
    stadium: null, players: { A: player(a), B: player(b) },
  } as NeutralState;
}
const fill = (n: number) => Array.from({ length: n }, () => GRASS);
const shuffle = (d: CardRef[]): NeutralAction => ({ actor: 'system', type: 'shuffle', order: d.map(c => c.iid) } as NeutralAction);
const flip = (face: 'heads' | 'tails'): NeutralAction => ({ actor: 'system', type: 'flip', face } as NeutralAction);
const confirm = (actor: 'A' | 'B', value: boolean): NeutralAction => ({ actor, type: 'confirm', value } as NeutralAction);

const B = deck('b', [GRASS, DROWZEE, ...fill(18)]);
function starters(a: CardRef[]): string[] {
  const r = step(preDeal(a, B), [flip('heads'), confirm('A', true), shuffle(a), shuffle(B)]);
  return (r.pending?.legalActions || []).map(x => (x as { target?: string }).target as string).filter(Boolean).sort();
}

describe('OOP-92 Snorlax Doll can be placed during setup', () => {
  it('with Drowzee and Snorlax Doll in the opening hand, both are starter candidates [OOP-92 par-175]', () => {
    expect(starters(deck('a', [DROWZEE, DOLL, ...fill(18)]))).toEqual(['a0', 'a1']);
  });

  it('placed as the starting Active, the Doll is IN PLAY as a Pokemon (getPokemons knows it) [OOP-92 par-175]', () => {
    const a = deck('a', [DOLL, DROWZEE, ...fill(18)]);
    const actions: NeutralAction[] = [flip('heads'), confirm('A', true), shuffle(a), shuffle(B),
      { actor: 'A', type: 'choose', target: 'a0' } as NeutralAction, confirm('A', false)];
    let r = step(preDeal(a, B), actions);
    for (let i = 0; i < 6 && r.state.phase === 'setup' && r.pending; i++) {
      const next = r.pending.legalActions.find(x => x.type === 'choose') || r.pending.legalActions[0];
      actions.push(next as NeutralAction);
      r = step(preDeal(a, B), actions);
    }
    expect(r.state.phase).toBe('main');
    expect(r.state.players.A.active?.stack.map(c => c.printing)).toEqual([DOLL]);
  });

  it('control: without the Doll only the Basic is offered [OOP-92 par-175]', () => {
    expect(starters(deck('a', [DROWZEE, GRASS, ...fill(18)]))).toEqual(['a0']);
  });
});
