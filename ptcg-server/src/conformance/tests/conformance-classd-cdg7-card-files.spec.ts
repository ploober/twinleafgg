import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * Seven class-D card findings (2026-09-30 batch), each re-driven on twinleaf ec9f093d5 (:8090) x rotomancer :8099
 * before the fix (rows r262/r265, r363, r283, r434/r437, r473/r474, r503/r506, r705 of
 * docs/fuzz-20260929-unlimited-classD). Printed text is quoted from card-data/final/<set>.json.
 *
 *   TA-496 Blastoise ex mew-009 Twin Cannons: "Discard up to 2 Basic [Water] Energy cards from your hand. This attack
 *     does 140 damage for each card you discarded in this way." The pick took ANY Energy card, min 1 with a cancel
 *     that kept the printed 140, and the attack was withheld with no Energy in hand. An attack's "up to 2" is 0..2
 *     (#2301), and 0 discarded is 0 damage.
 *   TA-498 Tympole obf-050 Screw Tail / TA-499 Ekans mew-023 Acid Spray: "Flip a coin. If heads, discard an Energy
 *     from your opponent's Active Pokémon." A guard above the flip skipped it when the Defending Pokémon had no
 *     Energy; the flip is a step of the attack (#1661, TA-306). The flip also ran before the base damage (TA-494's
 *     family A, #649); it now runs after it, as Yveltal sfa-035 does.
 *   TA-500 Arboliva svi-023 Enriching Oil: "When you play this Pokémon from your hand to evolve 1 of your Pokémon
 *     during your turn, you may heal all damage from 1 of your Pokémon." It was gated on the deck being non-empty;
 *     the operand is a damaged Pokémon (B.29, #2306). After the "may" is accepted, the heal pick is not a second may.
 *   TA-501 Forretress ex pal-005 Exploding Energy: "... search your deck for up to 5 Basic [Grass] Energy cards and
 *     attach them to your Pokémon in any way you like. Then, shuffle your deck. If you searched your deck in this
 *     way, this Pokémon is Knocked Out." Taking 0 skipped the KO; taking any put 999 damage on it before the shuffle
 *     (and shuffled once per card).
 *   TA-502 Skwovet svi-151 Nest Stash: "Once during your turn, you may shuffle your hand and put it on the bottom of
 *     your deck. If you put any cards on the bottom of your deck in this way, draw a card." The hand went to the
 *     bottom in hand order, with no shuffle.
 *   TA-503 Garbodor par-117 Chuck: "Discard any number of Pokémon Tool cards from your hand. This attack does 50
 *     damage for each card you discarded in this way." 0 discarded left the printed 50.
 */

const GRASS = 'sve-001';
const WATER = 'sve-003';
const PSYCHIC = 'sve-005';
const DARK = 'sve-007';
const BELLSPROUT = 'asc-004';
const BIG = 'mew-003'; // Venusaur ex, 340 HP: a defender that survives
const TOOL = 'pal-173'; // Bravery Charm

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, stack: string[], energy: string[] = [], damage = 0): PokemonInPlay {
  return {
    stack: stack.map((printing, i) => ({ iid: i === 0 ? iid : `${iid}s${i}`, printing })),
    energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })),
    tools: [], damage, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function board(active: PokemonInPlay, bench: PokemonInPlay[], opts: { hand?: string[]; deck?: string[]; bActive?: PokemonInPlay } = {}): NeutralState {
  const A: PlayerState = { active, bench, hand: cards('ah', opts.hand ?? []), deck: cards('ad', opts.deck ?? Array(8).fill(PSYCHIC)),
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: opts.bActive ?? mon('b1', [BIG]), bench: [], hand: [], deck: cards('bd', Array(8).fill(GRASS)),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
type Act = { type: string; [k: string]: unknown };
const A = (o: object) => ({ actor: 'A', ...o }) as never;
const SYS = (o: object) => ({ actor: 'system', ...o }) as never;
const STOP = A({ type: 'confirm', value: false });
function run(s: NeutralState, actions: unknown[]) { return step(s, actions as never); }
function legal(r: ReturnType<typeof step>): Act[] { return (r.pending?.legalActions ?? []) as unknown as Act[]; }
function events(r: ReturnType<typeof step>): Act[] { return (r.events ?? []) as unknown as Act[]; }
function flipPending(r: ReturnType<typeof step>): boolean { return legal(r).some(a => a.type === 'flip'); }
function shuffles(r: ReturnType<typeof step>): Array<{ deck?: string[] }> {
  return legal(r).filter(a => a.type === 'shuffle') as Array<{ deck?: string[] }>;
}

// ---------------------------------------------------------------- TA-496
describe('TA-496 Blastoise ex Twin Cannons discards up to 2 Basic Water Energy', () => {
  const BLASTOISE = ['mew-007', 'mew-008', 'mew-009'];
  const ATK = A({ type: 'declareAttack', source: 'a1', name: 'Twin Cannons' });
  const s = (hand: string[]) => board(mon('a1', BLASTOISE, [WATER, WATER]), [mon('a2', [BELLSPROUT])], { hand });

  it('hand of Grass and Psychic Energy: no discard is offered and the attack does 0 damage [TA-496]', () => {
    const r = run(s([GRASS, PSYCHIC]), [ATK]);
    expect(legal(r).some(a => a.type === 'discard')).toBe(false);
    expect(r.state.players.B.active!.damage).toBe(0);
    expect(r.state.players.A.hand.length).toBe(2);
    expect(r.state.activePlayer).toBe('B');
  });
  it('empty hand: Twin Cannons is still offered, and does 0 damage [TA-496]', () => {
    const st = s([]);
    expect(legal(run(st, [])).some(a => a.type === 'declareAttack' && a.name === 'Twin Cannons')).toBe(true);
    const r = run(st, [ATK]);
    expect(r.state.players.B.active!.damage).toBe(0);
  });
  it('Water, Grass, Psychic in hand: only the Water is a discard candidate, and a stop is offered [TA-496]', () => {
    const r = run(s([WATER, GRASS, PSYCHIC]), [ATK]);
    const targets = legal(r).filter(a => a.type === 'discard').map(a => a.target);
    expect(targets).toEqual(['ah0']);
    expect(legal(r).some(a => a.type === 'confirm' && a.value === false)).toBe(true);
  });
  it('stopping at 0 discarded does 0 damage and keeps the Water in hand [TA-496]', () => {
    const r = run(s([WATER, GRASS]), [ATK, STOP]);
    expect(r.state.players.B.active!.damage).toBe(0);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ah0', 'ah1']);
  });
  it('control: two Water discarded do 280 [TA-496]', () => {
    const r = run(s([WATER, WATER, GRASS]), [ATK, A({ type: 'discard', target: 'ah0' }), A({ type: 'discard', target: 'ah1' })]);
    expect(r.state.players.B.active!.damage).toBe(280);
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['ah0', 'ah1']);
  });
  it('control: one Water discarded then stop does 140 [TA-496]', () => {
    const r = run(s([WATER, WATER]), [ATK, A({ type: 'discard', target: 'ah0' }), STOP]);
    expect(r.state.players.B.active!.damage).toBe(140);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ah1']);
  });
});

// ---------------------------------------------------------------- TA-498 / TA-499
function flipBoard(stack: string[], energy: string[], bEnergy: string[]): NeutralState {
  return board(mon('a1', stack, energy), [mon('a2', [BELLSPROUT])], { bActive: mon('b1', [BIG], bEnergy) });
}
const HEADS = SYS({ type: 'flip', face: 'heads' });

describe('TA-498 Tympole obf-050 Screw Tail always flips its coin', () => {
  const ATK = A({ type: 'declareAttack', source: 'a1', name: 'Screw Tail' });
  const s = (bEnergy: string[]) => flipBoard(['obf-050'], [WATER], bEnergy);
  it('Defending Pokémon with no Energy: the coin is still flipped [TA-498]', () => {
    expect(flipPending(run(s([]), [ATK]))).toBe(true);
  });
  it('no Energy, heads: nothing is discarded, 10 damage, turn passes [TA-498]', () => {
    const r = run(s([]), [ATK, HEADS]);
    expect(r.state.players.B.active!.damage).toBe(10);
    expect(r.state.players.B.discard.length).toBe(0);
    expect(r.state.activePlayer).toBe('B');
  });
  it('control: Defending Pokémon with 1 Energy, heads: the Energy is discarded [TA-498]', () => {
    const r = run(s([GRASS]), [ATK, HEADS]);
    expect(r.state.players.B.active!.energy.length).toBe(0);
    expect(r.state.players.B.discard.map(c => c.iid)).toEqual(['b1e0']);
    expect(r.state.players.B.active!.damage).toBe(10);
  });
  it('Screw Tail: the 10 damage is on the Defending Pokémon at the flip (#649) [TA-494]', () => {
    const r = run(s([GRASS]), [ATK]);
    expect(flipPending(r)).toBe(true);
    expect(r.state.players.B.active!.damage).toBe(10);
  });
});

describe('TA-499 Ekans mew-023 Acid Spray always flips its coin', () => {
  const ATK = A({ type: 'declareAttack', source: 'a1', name: 'Acid Spray' });
  const s = (bEnergy: string[]) => flipBoard(['mew-023'], [DARK, DARK], bEnergy);
  it('Defending Pokémon with no Energy: the coin is still flipped [TA-499]', () => {
    expect(flipPending(run(s([]), [ATK]))).toBe(true);
  });
  it('no Energy, heads: nothing is discarded, 30 damage, turn passes [TA-499]', () => {
    const r = run(s([]), [ATK, HEADS]);
    expect(r.state.players.B.active!.damage).toBe(30);
    expect(r.state.players.B.discard.length).toBe(0);
    expect(r.state.activePlayer).toBe('B');
  });
  it('control: Defending Pokémon with 1 Energy, heads: the Energy is discarded [TA-499]', () => {
    const r = run(s([GRASS]), [ATK, HEADS]);
    expect(r.state.players.B.active!.energy.length).toBe(0);
    expect(r.state.players.B.discard.map(c => c.iid)).toEqual(['b1e0']);
    expect(r.state.players.B.active!.damage).toBe(30);
  });
  it('Acid Spray: the 30 damage is on the Defending Pokémon at the flip (#649) [TA-494]', () => {
    const r = run(s([GRASS]), [ATK]);
    expect(flipPending(r)).toBe(true);
    expect(r.state.players.B.active!.damage).toBe(30);
  });
});

// ---------------------------------------------------------------- TA-500
describe('TA-500 Arboliva Enriching Oil is gated on a damaged Pokémon', () => {
  const DOLLIV = ['dri-021', 'dri-022'];
  const EVOLVE = A({ type: 'evolve', card: 'ah0', target: 'a1' });
  const YES = A({ type: 'confirm', value: true });
  it('no damaged Pokémon: evolving does not offer Enriching Oil [TA-500]', () => {
    const r = run(board(mon('a1', DOLLIV), [mon('a2', [BELLSPROUT])], { hand: ['svi-023'] }), [EVOLVE]);
    expect(legal(r).some(a => a.type === 'confirm')).toBe(false);
    expect(r.state.players.A.active!.stack.map(c => c.printing)).toEqual([...DOLLIV, 'svi-023']);
  });
  it('empty deck, Active with 20 damage: Enriching Oil is offered and heals it [TA-500]', () => {
    const st = board(mon('a1', DOLLIV, [], 20), [mon('a2', [BELLSPROUT])], { hand: ['svi-023'], deck: [] });
    expect(legal(run(st, [EVOLVE])).some(a => a.type === 'confirm' && a.value === true)).toBe(true);
    const r = run(st, [EVOLVE, YES]);
    expect(r.state.players.A.active!.damage).toBe(0);
  });
  it('one damaged Pokémon: accepting heals it with no second pick or stop [TA-500]', () => {
    const r = run(board(mon('a1', DOLLIV, [], 20), [mon('a2', [BELLSPROUT])], { hand: ['paf-104'] }), [EVOLVE, YES]);
    expect(legal(r).some(a => a.type === 'choose' || (a.type === 'confirm' && a.value === false))).toBe(false);
    expect(r.state.players.A.active!.damage).toBe(0);
  });
  it('two damaged Pokémon: the pick offers both and no stop [TA-500]', () => {
    const r = run(board(mon('a1', DOLLIV, [], 20), [mon('a2', [BELLSPROUT], [], 10)], { hand: ['svi-023'] }), [EVOLVE, YES]);
    expect(legal(r).filter(a => a.type === 'choose').map(a => a.target).sort()).toEqual(['a1', 'a2']);
    expect(legal(r).some(a => a.type === 'confirm' && a.value === false)).toBe(false);
  });
  it('control: declining leaves the damage [TA-500]', () => {
    const r = run(board(mon('a1', DOLLIV, [], 20), [mon('a2', [BELLSPROUT])], { hand: ['svi-023'] }), [EVOLVE, STOP]);
    expect(r.state.players.A.active!.damage).toBe(20);
  });
});

// ---------------------------------------------------------------- TA-501
describe('TA-501 Forretress ex Exploding Energy: shuffle once, then Knocked Out', () => {
  const FORRETRESS = ['paf-099', 'pal-005'];
  const USE = A({ type: 'useAbility', source: 'a1', ability: 'Exploding Energy' });
  const st = () => board(mon('a1', FORRETRESS, [GRASS]), [mon('a2', [BELLSPROUT])], { deck: [GRASS, GRASS, GRASS, PSYCHIC, PSYCHIC, PSYCHIC] });
  const answer = (r: ReturnType<typeof step>) => SYS({ type: 'shuffle', order: shuffles(r)[0]?.deck ?? [] });
  const koed = (r: ReturnType<typeof step>) =>
    !(r.state.players.A.active?.stack ?? []).some(c => c.printing === 'pal-005')
    && r.state.players.A.discard.some(c => c.printing === 'pal-005');

  it('0 Energy taken: after the shuffle Forretress ex is Knocked Out [TA-501]', () => {
    const atShuffle = run(st(), [USE, STOP]);
    expect(shuffles(atShuffle).length).toBe(1);
    const r = run(st(), [USE, STOP, answer(atShuffle)]);
    expect(koed(r)).toBe(true);
  });
  it('1 Energy taken: Forretress ex is undamaged and in play at the shuffle, Knocked Out after it [TA-501]', () => {
    const acts = [USE, A({ type: 'attachEnergy', card: 'ad0', target: 'a2' }), STOP];
    const atShuffle = run(st(), acts);
    expect(shuffles(atShuffle).length).toBe(1);
    expect(atShuffle.state.players.A.active!.damage).toBe(0);
    expect(atShuffle.state.players.A.active!.stack.some(c => c.printing === 'pal-005')).toBe(true);
    const r = run(st(), [...acts, answer(atShuffle)]);
    expect(koed(r)).toBe(true);
    expect(events(r).some(e => e.kind === 'damaged' && e.target === 'a1')).toBe(false);
  });
  it('2 Energy taken: the deck is shuffled once [TA-501]', () => {
    const acts = [USE, A({ type: 'attachEnergy', card: 'ad0', target: 'a2' }), A({ type: 'attachEnergy', card: 'ad1', target: 'a1' }), STOP];
    const atShuffle = run(st(), acts);
    expect(shuffles(atShuffle).length).toBe(1);
    const r = run(st(), [...acts, answer(atShuffle)]);
    expect(shuffles(r).length).toBe(0);
    expect(koed(r)).toBe(true);
    expect(r.state.players.A.bench.length + (r.state.players.A.active ? 1 : 0)).toBe(1);
  });
});

// ---------------------------------------------------------------- TA-502
describe('TA-502 Skwovet Nest Stash shuffles the hand before bottoming it', () => {
  const USE = A({ type: 'useAbility', source: 'a1', ability: 'Nest Stash' });
  const st = (hand: string[]) => board(mon('a1', ['svi-151']), [mon('a2', [BELLSPROUT])], { hand, deck: Array(6).fill(WATER) });
  it('2-card hand: a shuffle of exactly the hand is pending before anything is drawn [TA-502]', () => {
    const r = run(st([GRASS, PSYCHIC]), [USE]);
    const sh = shuffles(r);
    expect(sh.length).toBe(1);
    expect([...(sh[0].deck ?? [])].sort()).toEqual(['ah0', 'ah1']);
  });
  it('at the shuffle pause the deck is untouched and the hand is in transit hand -> deck bottom (B.80) [TA-502]', () => {
    const r = run(st([GRASS, PSYCHIC]), [USE]);
    const A0 = r.state.players.A;
    expect(A0.deck.map(c => c.iid)).toEqual(['ad0', 'ad1', 'ad2', 'ad3', 'ad4', 'ad5']);
    expect(A0.hand).toEqual([]);
    expect((A0.transit ?? []).map(t => ({ iid: t.iid, origin: t.origin, destination: t.destination }))).toEqual([
      { iid: 'ah0', origin: { zone: 'hand' }, destination: { zone: 'deck', position: 'bottom' } },
      { iid: 'ah1', origin: { zone: 'hand' }, destination: { zone: 'deck', position: 'bottom' } }]);
  });
  it('the answered order is the order at the bottom of the deck, then 1 card is drawn [TA-502]', () => {
    const r = run(st([GRASS, PSYCHIC]), [USE, SYS({ type: 'shuffle', order: ['ah1', 'ah0'] })]);
    const deck = r.state.players.A.deck.map(c => c.iid);
    expect(deck.slice(-2)).toEqual(['ah1', 'ah0']);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ad0']);
  });
  it('1-card hand: a shuffled event for the hand is emitted [TA-502]', () => {
    const r = run(st([GRASS]), [USE]);
    expect(events(r).some(e => e.kind === 'shuffled' && e.zone === 'hand')).toBe(true);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ad0']);
    expect(r.state.players.A.deck.map(c => c.iid).slice(-1)).toEqual(['ah0']);
  });
  it('control: empty hand: Nest Stash is not offered [TA-502]', () => {
    expect(legal(run(st([]), [])).some(a => a.type === 'useAbility' && a.ability === 'Nest Stash')).toBe(false);
  });
});

// ---------------------------------------------------------------- TA-503
describe('TA-503 Garbodor Chuck does 50 per Tool discarded, 0 for none', () => {
  const GARBODOR = ['cri-056', 'par-117'];
  const ATK = A({ type: 'declareAttack', source: 'a1', name: 'Chuck' });
  const st = (hand: string[]) => board(mon('a1', GARBODOR, [DARK]), [mon('a2', [BELLSPROUT])], { hand });
  it('no Tool in hand: Chuck does 0 damage [TA-503]', () => {
    const r = run(st([GRASS, PSYCHIC]), [ATK]);
    expect(r.state.players.B.active!.damage).toBe(0);
    expect(r.state.activePlayer).toBe('B');
  });
  it('a Tool in hand, none discarded: Chuck does 0 damage [TA-503]', () => {
    const r = run(st([TOOL, GRASS]), [ATK, STOP]);
    expect(r.state.players.B.active!.damage).toBe(0);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ah0', 'ah1']);
  });
  it('control: one Tool discarded does 50 [TA-503]', () => {
    const atPick = run(st([TOOL, GRASS]), [ATK]);
    const pick = legal(atPick).find(a => a.target === 'ah0');
    expect(pick).toBeDefined();
    const r = run(st([TOOL, GRASS]), [ATK, A({ ...pick, actor: 'A' }), STOP]);
    expect(r.state.players.B.active!.damage).toBe(50);
    expect(r.state.players.A.discard.map(c => c.iid)).toEqual(['ah0']);
  });
});
