import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';
import { getCardBySetAndNumber } from '../../sets/tests/test-helpers';
import { PokemonCard } from '../../game/store/card/pokemon-card';

/**
 * Batch g16 (re-driven 2026-10-06 on :8090 bf4bb0f32 x :8099). Printed text is quoted from card-data/final/<set>.json.
 *
 *   TA-287 Leafeon ex pre-006 (and its SAR pre-144, a subclass) Verdant Storm: "This attack does 60 damage for each
 *     Energy attached to all of your opponent's Pokémon." Twinleaf read "This attack foes 60 damage ...".
 *   TA-389 Lisia's Appeal ssp-179: "Switch in 1 of your opponent's Benched Basic Pokémon to the Active Spot. The new
 *     Active Pokémon is now Confused." Antique Jaw Fossil por-068: "This card can't be affected by any Special
 *     Conditions and can't retreat." The Confuse was a raw addSpecialCondition that no immunity could see.
 *   TA-411 Watchog cri-071 / cri-097 Snap Inspection: "Flip 3 coins. If any of them are heads, your opponent reveals
 *     their hand. For each heads, choose a card you find there and shuffle it into your opponent's deck." Compendium
 *     #2356: "You have to do as much as you can. If they have three cards, you have to put all three back into their
 *     deck." The pick was lowered as a discard with a stop, and the reveal was never performed.
 *
 * TA-275 (Mega Pyroar ex "Fiery Big Bang") and TA-276 (Keldeo "Shoot Through") no longer reproduce on bf4bb0f32.
 */

const GRASS = 'sve-001';
const FIRE = 'sve-002';
const WATER = 'sve-003';
const BELLSPROUT = 'asc-004'; // Basic
const BIG = 'mew-003'; // Venusaur ex
const LISIA = 'ssp-179';
const JAW_FOSSIL = 'por-068';
const WATCHOG = 'cri-071';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, stack: string[], energy: string[] = []): PokemonInPlay {
  return {
    stack: stack.map((printing, i) => ({ iid: i === 0 ? iid : `${iid}s${i}`, printing })),
    energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })),
    tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return [0, 1, 2].map(i => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
interface Opts { hand?: string[]; bActive?: PokemonInPlay; bBench?: PokemonInPlay[]; bHand?: string[] }
function board(active: PokemonInPlay, o: Opts = {}): NeutralState {
  const A: PlayerState = { active, bench: [], hand: cards('ah', o.hand ?? []), deck: cards('ad', Array(8).fill(GRASS)),
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: o.bActive ?? mon('b1', [BIG]), bench: o.bBench ?? [], hand: cards('bh', o.bHand ?? []),
    deck: cards('bd', Array(8).fill(GRASS)), discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
type Act = { type: string; [k: string]: unknown };
function run(s: NeutralState, actions: unknown[]) {
  return step(s, actions as never);
}
/**
 * Replays `actions`, answering each system shuffle with the order it offers, except that the opponent's former hand
 * cards (bh*) are placed in the MIDDLE of the deck so B's next-turn draw (top or bottom) cannot take one back.
 */
function middle(order: string[]): string[] {
  const rest = order.filter(i => !i.startsWith('bh'));
  const half = Math.floor(rest.length / 2);
  return [...rest.slice(0, half), ...order.filter(i => i.startsWith('bh')), ...rest.slice(half)];
}
function runShuffling(s: NeutralState, actions: unknown[]) {
  const acts = [...actions];
  for (;;) {
    const r = run(s, acts);
    const sh = (r.pending?.legalActions ?? []).find(a => (a as unknown as Act).type === 'shuffle') as unknown as Act | undefined;
    if (r.pending?.actor !== 'system' || sh === undefined) {
      return r;
    }
    acts.push({ actor: 'system', type: 'shuffle', order: middle((sh.deck ?? []) as string[]) });
  }
}
const ids = (refs: { iid: string }[]): string[] => refs.map(r => r.iid);

// ---------------------------------------------------------------- TA-287
describe('TA-287 Leafeon ex Verdant Storm text', () => {
  const VERDANT = "This attack does 60 damage for each Energy attached to all of your opponent's Pokémon.";
  it('pre-006 Verdant Storm reads as printed [TA-287]', () => {
    expect((getCardBySetAndNumber('pre', '6') as PokemonCard).attacks[0].text).toBe(VERDANT);
  });
  it('pre-144 (the SAR subclass) Verdant Storm reads as printed [TA-287]', () => {
    expect((getCardBySetAndNumber('pre', '144') as PokemonCard).attacks[0].text).toBe(VERDANT);
  });
  it('pre-006 Moss Agate reads as printed, with the accented Pokémon [TA-287]', () => {
    expect((getCardBySetAndNumber('pre', '6') as PokemonCard).attacks[1].text).toBe('Heal 100 damage from each of your Benched Pokémon.');
  });
  it('control: pre-006 attack names and Verdant Storm damage are as printed [TA-287]', () => {
    const c = getCardBySetAndNumber('pre', '6') as PokemonCard;
    expect(c.attacks.map(a => a.name)).toEqual(['Verdant Storm', 'Moss Agate']);
    expect(c.attacks[0].damage).toBe(60);
  });
});

// ---------------------------------------------------------------- TA-389
describe("TA-389 Lisia's Appeal onto an Antique Jaw Fossil", () => {
  const play = [{ actor: 'A', type: 'playSupporter', card: 'ah0' }];
  it("Lisia's Appeal switches the Antique Jaw Fossil in and it is not Confused [TA-389]", () => {
    const r = run(board(mon('a1', [BELLSPROUT]), { hand: [LISIA], bBench: [mon('b2', [JAW_FOSSIL])] }), play);
    expect(r.status).not.toBe('invalidAction');
    expect(r.state.players.B.active!.stack[0].printing).toBe(JAW_FOSSIL);
    expect(r.state.players.B.active!.conditions).toEqual([]);
  });
  it("control: Lisia's Appeal switches in a Basic Pokémon and Confuses it [TA-389]", () => {
    const r = run(board(mon('a1', [BELLSPROUT]), { hand: [LISIA], bBench: [mon('b2', [BELLSPROUT])] }), play);
    expect(r.state.players.B.active!.stack[0].iid).toBe('b2');
    expect(r.state.players.B.active!.conditions).toEqual(['confused']);
  });
  it("control: Enamorus V's Ability protection does not stop Lisia's Appeal's Confuse (a Supporter, not an Ability) [TA-389]", () => {
    // Enamorus V lor-082: "Prevent all effects of your opponent's Pokémon's Abilities done to each of your Pokémon that
    // has any [P] Energy attached, except any Enamorus V." The switched-in Basic has a Psychic Energy. (Holds because the
    // prefab names the TARGET's owner as effect.player, which Enamorus V's guard skips.)
    const r = run(board(mon('a1', [BELLSPROUT]), { hand: [LISIA], bActive: mon('b1', ['lor-082']),
      bBench: [mon('b2', [BELLSPROUT], ['sve-005'])] }), play);
    expect(r.state.players.B.active!.stack[0].iid).toBe('b2');
    expect(r.state.players.B.active!.conditions).toEqual(['confused']);
  });
});

// ---------------------------------------------------------------- TA-411
describe('TA-411 Watchog Snap Inspection', () => {
  const atk = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Snap Inspection' };
  const flip = (face: 'heads' | 'tails') => ({ actor: 'system', type: 'flip', face });
  const s = (num = WATCHOG) => board(mon('a1', [num], [GRASS]), { bHand: [FIRE, WATER] });
  it('three heads against a two-card hand put both cards into the deck with no pick and no stop [TA-411]', () => {
    const acts = [atk, flip('heads'), flip('heads'), flip('heads')];
    const m = (run(s(), acts).pending?.legalActions ?? []) as unknown as Act[];
    expect(m.some(a => a.type === 'discard')).toBe(false);
    expect(m.some(a => a.type === 'confirm' && a.value === false)).toBe(false);
    const r = runShuffling(s(), acts);
    // B has drawn one card for its turn; neither former hand card is back in hand
    expect(r.state.players.B.hand.length).toBe(1);
    expect(ids(r.state.players.B.hand)).not.toContain('bh0');
    expect(ids(r.state.players.B.hand)).not.toContain('bh1');
    expect(ids(r.state.players.B.deck)).toEqual(jasmine.arrayContaining(['bh0', 'bh1']));
    expect(r.state.players.B.discard.length).toBe(0);
  });
  it('cri-097 (the CRI reprint): three heads against a two-card hand offers no stop [TA-411]', () => {
    const m = (run(s('cri-097'), [atk, flip('heads'), flip('heads'), flip('heads')]).pending?.legalActions ?? []) as unknown as Act[];
    expect(m.some(a => a.type === 'confirm' && a.value === false)).toBe(false);
    expect(m.some(a => a.type === 'discard')).toBe(false);
  });
  it('one heads against a two-card hand offers a choose of either card, no discard and no stop [TA-411]', () => {
    const m = (run(s(), [atk, flip('heads'), flip('tails'), flip('tails')]).pending?.legalActions ?? []) as unknown as Act[];
    expect(m.filter(a => a.type === 'choose').map(a => a.target).sort()).toEqual(['bh0', 'bh1']);
    expect(m.some(a => a.type === 'discard')).toBe(false);
    expect(m.some(a => a.type === 'confirm')).toBe(false);
  });
  it('one heads: the chosen card goes into the deck and the other stays in hand [TA-411]', () => {
    const r = runShuffling(s(), [atk, flip('heads'), flip('tails'), flip('tails'), { actor: 'A', type: 'choose', target: 'bh1' }]);
    expect(ids(r.state.players.B.hand)).toContain('bh0');
    expect(ids(r.state.players.B.hand)).not.toContain('bh1');
    expect(ids(r.state.players.B.deck)).toContain('bh1');
    expect(r.state.players.B.discard.length).toBe(0);
  });
  it('any heads: the opponent reveals their hand to both players [TA-411]', () => {
    const r = run(s(), [atk, flip('heads'), flip('tails'), flip('tails')]);
    expect(r.events.filter(e => e.kind === 'reveal'))
      .toEqual([{ kind: 'reveal', owner: 'B', cards: ['bh0', 'bh1'], from: 'hand', to: 'all' }]);
  });
  it('control: three tails reveal nothing and move nothing [TA-411]', () => {
    const r = runShuffling(s(), [atk, flip('tails'), flip('tails'), flip('tails')]);
    expect(r.events.some(e => e.kind === 'reveal')).toBe(false);
    // B has drawn for its turn (bd0); both former hand cards are still in hand
    expect(ids(r.state.players.B.hand)).toEqual(['bh0', 'bh1', 'bd0']);
  });
});
