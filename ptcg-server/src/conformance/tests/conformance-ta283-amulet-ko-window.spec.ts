import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-283 (B.14, TW-wrong): Amulet of Hope ssp-162 — "If the Pokémon this card is attached to is Knocked Out by damage
 * from an attack from your opponent's Pokémon, search your deck for up to 3 cards and put them into your hand. Then,
 * shuffle your deck." (card-data/final/ssp.json). The KO-triggered Tool effect resolves BEFORE the opponent takes a
 * Prize card and before the owner promotes: #810 ("the opponent takes their prize(s) as soon as all triggered effects
 * have finished resolving"), #808 (Wishful Baton: "Taking prizes is the last step"), #1918 (Cursed Duster, a Tool on
 * the Knocked Out Pokémon: "before you take your Prize Cards"). Twinleaf bf4bb0f32 ran the search at
 * BetweenTurnsEffect: Prize, then promotion, then the search.
 */

const FIRE = 'sve-002';
const WATER = 'sve-003';
const GRASS = 'sve-001';
const BELLSPROUT = 'asc-004'; // Basic Grass, 60 HP
const SALANDIT = 'asc-020';   // Basic Fire, Fire Claws [R] 30

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, stack: string[], energy: string[] = [], damage = 0, tools: string[] = []): PokemonInPlay {
  return {
    stack: stack.map((printing, i) => ({ iid: i === 0 ? iid : `${iid}s${i}`, printing })),
    energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })),
    tools: tools.map((t, i) => ({ iid: `${iid}t${i}`, printing: t })), damage, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function ps(tag: string, active: PokemonInPlay, bench: PokemonInPlay[], deck: number): PlayerState {
  return { active, bench, hand: [], deck: cards(`${tag}d`, Array(deck).fill(WATER)), discard: [], lostZone: [],
    prizes: prizes(tag), flags: flags() };
}
/** B's Salandit (Fire Claws 30) Knocks Out A's 40-damage Bellsprout (60 HP); `tool` = whether it wears the Amulet. */
function board(tool: boolean, aDeck = 4): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'B', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: {
      A: ps('a', mon('a1', [BELLSPROUT], [], 40, tool ? ['ssp-162'] : []), [mon('ab0', [BELLSPROUT])], aDeck),
      B: ps('b', mon('b1', [SALANDIT], [FIRE, FIRE]), [mon('b2', [BELLSPROUT])], 4) } };
}
type Act = { type: string; actor?: string; target?: string; deck?: string[] };
const acts = (r: ReturnType<typeof step>): Act[] => (r.pending?.legalActions ?? []) as unknown as Act[];
const ATTACK = { actor: 'B', type: 'declareAttack', source: 'b1', name: 'Fire Claws' };

describe('TA-283: Amulet of Hope ssp-162 resolves in the Knock Out window, before Prizes and promotion', () => {
  it('[TA-283] the first decision after the Knock Out is the Amulet owner\'s search, not the opponent\'s Prize', () => {
    const r = step(board(true), [ATTACK] as never);
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('A');
    expect(acts(r).some(a => a.type === 'takePrize')).toBe(false);
    expect(acts(r).some(a => a.type === 'choose')).toBe(true);
    expect(r.state.players.B.prizes.length).toBe(6);
    expect(r.state.players.A.bench.length).toBe(1);
  });

  it('[TA-283] the search and its shuffle finish first; then B takes a Prize, then A promotes', () => {
    const seq: unknown[] = [ATTACK];
    let r = step(board(true), seq as never);
    const order: string[] = [];
    for (let i = 0; i < 10 && r.status === 'awaitingAction'; i++) {
      const offers = acts(r);
      if (offers.some(a => a.type === 'declareAttack' || a.type === 'endTurn')) { break; }
      const a = offers.find(o => o.type === 'confirm') ?? offers[0];
      order.push(a.type === 'confirm' ? 'choose' : a.type);
      seq.push(a.type === 'shuffle' ? { actor: 'system', type: 'shuffle', order: a.deck ?? [] }
        : a.type === 'confirm' ? { ...a, value: false } : a);
      r = step(board(true), seq as never);
    }
    const collapsed = order.filter((t, i) => i === 0 || t !== order[i - 1]);
    expect(collapsed.indexOf('choose')).toBe(0);
    expect(collapsed.indexOf('takePrize')).toBeGreaterThan(0);
    expect(collapsed.indexOf('promoteBench')).toBeGreaterThan(collapsed.indexOf('takePrize'));
    expect(r.state.players.A.hand.length).toBeGreaterThan(0);
    expect(r.state.players.B.hand.length).toBe(1); // the Prize
  });

  it('[TA-283] an empty deck: the owed shuffle (TA-250) is emitted before the Prize is pending', () => {
    const r = step(board(true, 0), [ATTACK] as never);
    expect(r.status).toBe('awaitingAction');
    const kinds = (r.events ?? []).map(e => (e as { kind: string }).kind);
    expect(kinds).toContain('shuffled');
    expect(r.pending!.actor).toBe('B');
    expect(acts(r).every(a => a.type === 'takePrize')).toBe(true);
    expect(r.state.players.B.prizes.length).toBe(6);
  });

  it('control [TA-283]: without the Amulet the first decision after the Knock Out is B\'s Prize', () => {
    const r = step(board(false), [ATTACK] as never);
    expect(r.status).toBe('awaitingAction');
    expect(r.pending!.actor).toBe('B');
    expect(acts(r).some(a => a.type === 'takePrize')).toBe(true);
  });
});
