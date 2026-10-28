import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, CardRef, SCHEMA_VERSION, NeutralAction } from '../neutral-types';

/**
 * Setup (CF-84 walk, B.67). Cinderace meg-028 Explosiveness: "If this Pokémon is in your hand when you are setting up to
 * play, you may put it face down in the Active Spot." (card-data/final/meg.json).
 *   TA-464: such a card may fill ONLY the Active Spot, never the Bench.
 *   TA-465: a hand whose only starter is such a card may decline it and mulligan instead (#139 "you can choose to put it
 *           out as your Active OR show you have no basics and mulligan... YOU DECIDE").
 *   TA-466: the compensation Bench pick (after the opponent's extra mulligans) offers only the Basics just drawn
 *           (Rulebook, mulligan step 3: "If any of those cards are Basic Pokémon, they may be put onto the Bench").
 */

const BELLSPROUT = 'asc-004';
const CINDERACE = 'meg-028';
const GRASS = 'sve-001';
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
const deck = (tag: string, printings: string[]): CardRef[] => printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
const player = (d: CardRef[]): PlayerState => ({ active: null, bench: [], hand: [], deck: d, discard: [], lostZone: [], prizes: [], flags: flags() });
const preDeal = (a: CardRef[], b: CardRef[]): NeutralState => ({
  schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 0, activePlayer: 'A', firstPlayer: null, phase: 'setup', outcome: 'ongoing',
  stadium: null, players: { A: player(a), B: player(b) },
} as NeutralState);
const fill = (n: number) => Array.from({ length: n }, () => GRASS);
const shuffle = (ids: string[]): NeutralAction => ({ actor: 'system', type: 'shuffle', order: ids } as NeutralAction);
const inOrder = (d: CardRef[]) => shuffle(d.map(c => c.iid));
const flip = (face: 'heads' | 'tails'): NeutralAction => ({ actor: 'system', type: 'flip', face } as NeutralAction);
const confirm = (actor: 'A' | 'B', value: boolean): NeutralAction => ({ actor, type: 'confirm', value } as NeutralAction);
const choose = (actor: 'A' | 'B', target: string): NeutralAction => ({ actor, type: 'choose', target } as NeutralAction);
type Offer = { type: string; target?: string; destination?: string; value?: boolean };
const offers = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? []) as unknown as Offer[];

describe('Setup: may-starters and the compensation Bench pick', () => {
  // TA-464 board: A's opening 7 holds Bellsprout a0, Cinderace a1 and Bellsprout a2; B holds a Bellsprout. The second
  // Bellsprout keeps A's Bench pick open after the Active, so "Cinderace is not offered for the Bench" is asked of A's
  // own pending (with one Basic the pick would close and the check would read B's pending — vacuous).
  const A464 = deck('a', [BELLSPROUT, CINDERACE, BELLSPROUT, ...fill(17)]);
  const B464 = deck('b', [BELLSPROUT, ...fill(19)]);
  const DEAL464 = [flip('heads'), confirm('A', true), inOrder(A464), inOrder(B464)];

  it('Cinderace is offered as the Active [TA-464 meg-028 active-ok]', () => {
    const r = step(preDeal(A464, B464), DEAL464);
    expect(offers(r).filter(o => o.type === 'choose').map(o => [o.target, o.destination])).toEqual([['a0', 'active'], ['a1', 'active'], ['a2', 'active']]);
  });
  it('after a Basic goes Active, Cinderace is not offered for the Bench [TA-464 meg-028 menu]', () => {
    const r = step(preDeal(A464, B464), [...DEAL464, choose('A', 'a0')]);
    expect(r.pending?.actor).toBe('A');
    expect(offers(r).some(o => o.target === 'a2' && o.destination === 'bench')).toBe(true);
    expect(offers(r).some(o => o.target === 'a1')).toBe(false);
  });
  it('choosing Cinderace for the Bench is refused [TA-464 meg-028 exec]', () => {
    const r = step(preDeal(A464, B464), [...DEAL464, choose('A', 'a0'), choose('A', 'a1')]);
    expect(r.status).toBe('invalidAction');
    expect(r.index).toBe(5);
  });

  // TA-465 board: A's opening 7 holds Cinderace and no Basic; B holds a Bellsprout.
  const A465 = deck('a', [CINDERACE, ...fill(6), BELLSPROUT, ...fill(12)]);
  const B465 = deck('b', [BELLSPROUT, ...fill(19)]);
  const DEAL465 = [flip('heads'), confirm('A', true), inOrder(A465), inOrder(B465)];

  it('a lone Cinderace may be declined [TA-465 meg-028 decline-offered]', () => {
    const r = step(preDeal(A465, B465), DEAL465);
    expect(r.pending?.actor).toBe('A');
    expect(offers(r).some(o => o.type === 'confirm' && o.value === false)).toBe(true);
    expect(offers(r).some(o => o.type === 'choose' && o.target === 'a0' && o.destination === 'active')).toBe(true);
  });
  it('declining means no Basic: B places first, then A mulligans [TA-465 meg-028 decline-mulligans]', () => {
    const r = step(preDeal(A465, B465), [...DEAL465, confirm('A', false)]);
    expect(r.pending?.actor).toBe('B');
    expect(offers(r).some(o => o.type === 'choose' && o.target === 'b0' && o.destination === 'active')).toBe(true);
    expect(r.state.players.A.active).toBeNull();
  });
  it('control: accepting puts Cinderace in the Active Spot [TA-465 meg-028 accept]', () => {
    const r = step(preDeal(A465, B465), [...DEAL465, choose('A', 'a0')]);
    expect(r.state.players.A.active?.stack[0].iid).toBe('a0');
  });

  // TA-466 board: B keeps a second Bellsprout b1 in hand; A mulligans once; B draws 1 (Bellsprout b13).
  const A466 = deck('a', [...fill(13), BELLSPROUT, ...fill(7)]);
  const B466 = deck('b', [BELLSPROUT, BELLSPROUT, ...fill(11), BELLSPROUT, ...fill(6)]);
  const A466first = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a20'];
  const A466second = ['a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a20'];
  const TO_COMP = [flip('heads'), confirm('A', true), shuffle(A466first), inOrder(B466), choose('B', 'b0'), confirm('B', false),
    shuffle(A466second), choose('A', 'a13'), { actor: 'B', type: 'selectOption', option: 0 } as NeutralAction];

  it('the compensation pick offers the drawn Basic and not the kept one [TA-466 asc-004 menu]', () => {
    const r = step(preDeal(A466, B466), TO_COMP);
    expect(r.pending?.actor).toBe('B');
    expect(offers(r).filter(o => o.type === 'choose').map(o => o.target)).toEqual(['b13']);
  });
  it('choosing the kept Basic there is refused [TA-466 asc-004 exec]', () => {
    const r = step(preDeal(A466, B466), [...TO_COMP, choose('B', 'b1')]);
    expect(r.status).toBe('invalidAction');
  });
});
