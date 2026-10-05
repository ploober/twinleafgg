import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, Location,
  SCHEMA_VERSION,
} from '../neutral-types';

/**
 * B.81 / CF-92 (contract 0.13.0): one `moved` event per card per physical pluck-and-place, `{owner, card, origin,
 * destination, visibility}`, with `Location` objects at both ends. Twinleaf derives it from a before/after board
 * diff per dispatch plus the mid-decision fix-up legs at a pause (moved-events.ts, driver.ts).
 *
 * The harness holds the trace to the ZONE-REPLAY law (initialState + legs = the response's board); `replays`
 * below is that law in miniature (places only), run on every cell so a leg the diff gets wrong — or a move it
 * misses — reds here before it reds on the wire.
 *
 * Mutation guards: drop the `deriveMoved` push in `dispatchAndCollect` and the draw / discard / KO cells red;
 * drop the step()-level push and the Burning Charge pick-1 cell reds (the lift into transit has no leg);
 * drop the `revealedSince` recording and the Tyme reveal cell reds (`owner`, not `public`).
 */

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;

const TYME = 'ssp-190';
const BELLSPROUT = 'asc-004';
const GRASS = 'sve-001';
const FIRE = 'sve-002';
const CARNELIAN = 'pre-074';
const BURNING = 'pre-014';
const ULTRA_BALL = 'meg-131';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function basic(iid: string, printing = BELLSPROUT, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing = GRASS): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n).map(c => ({ ...c, faceUp: false }));
}
function game(a: PlayerState, b: PlayerState): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A: a, B: b },
  };
}

function moved(events: NeutralEvent[]): Moved[] {
  return events.filter((e): e is Moved => e.kind === 'moved');
}

/** Every card's place, keyed as the harness keys it (in-play by stack + role, else by owner + zone). */
function places(state: NeutralState): Map<string, string> {
  const m = new Map<string, string>();
  const stack = (section: string, pip: PokemonInPlay | null) => {
    if (!pip || pip.stack.length === 0) { return; }
    const b = pip.stack[0].iid;
    pip.stack.forEach(c => m.set(c.iid, `${section}:${b}:pokemon`));
    pip.energy.forEach(c => m.set(c.iid, `${section}:${b}:energy`));
    pip.tools.forEach(c => m.set(c.iid, `${section}:${b}:tool`));
  };
  for (const who of ['A', 'B'] as const) {
    const p = state.players[who];
    stack('active', p.active);
    p.bench.forEach(b => stack('bench', b));
    p.hand.forEach(c => m.set(c.iid, `${who}.hand`));
    p.deck.forEach(c => m.set(c.iid, `${who}.deck`));
    p.discard.forEach(c => m.set(c.iid, `${who}.discardPile`));
    p.lostZone.forEach(c => m.set(c.iid, `${who}.lostZone`));
    p.prizes.forEach(c => m.set(c.iid, `${who}.prizes`));
    (p.resolving ?? []).forEach(c => m.set(c.iid, `${who}.resolving`));
    (p.transit ?? []).forEach(c => m.set(c.iid, `${who}.transit`));
  }
  if (state.stadium) { m.set(state.stadium.iid, 'stadium'); }
  return m;
}
function place(owner: string, loc: Location): string {
  if (loc.zone === 'active' || loc.zone === 'bench') { return `${loc.zone}:${loc.pokemon}:${loc.role}`; }
  if (loc.zone === 'stadium') { return 'stadium'; }
  return `${owner}.${loc.zone}`;
}

/** The zone-replay law, places only: the initial board with the trace's legs applied is the response's board. */
function replays(initial: NeutralState, res: { events: NeutralEvent[]; state: NeutralState }): string[] {
  const at = places(initial);
  const problems: string[] = [];
  for (const e of moved(res.events)) {
    const was = at.get(e.card);
    const from = place(e.owner, e.origin);
    if (was !== from) { problems.push(`${e.card}: leg from ${from} but the board had it at ${was}`); }
    at.set(e.card, place(e.owner, e.destination));
  }
  const shown = places(res.state);
  for (const [iid, p] of shown) {
    if (at.get(iid) !== p) { problems.push(`${iid}: legs end at ${at.get(iid)} but the board shows ${p}`); }
  }
  return problems;
}

describe('B.81 moved: the physical layer, derived per dispatch', () => {
  const quiet = () => game(
    player({ active: basic('a1'), hand: [{ iid: 'ah0', printing: GRASS }], deck: cards('ad', 6), prizes: prizes('ap', 3) }),
    player({ active: basic('b1'), deck: cards('bd', 6), prizes: prizes('bp', 3) }));

  it('a quiescent board emits nothing', () => {
    const res = step(quiet(), []);
    expect(moved(res.events)).toEqual([]);
  });

  it('the start-of-turn draw is one leg per card, deck -> hand, known to the owner; the trace replays', () => {
    const initial = quiet();
    const res = step(initial, [{ actor: 'A', type: 'endTurn' } as never]);
    const legs = moved(res.events);
    expect(legs).toEqual([{ kind: 'moved', owner: 'B', card: 'bd0', origin: { zone: 'deck' }, destination: { zone: 'hand' }, visibility: 'owner' }]);
    expect(replays(initial, res)).toEqual([]);
  });

  it('attaching an Energy from the hand is hand -> {active, stack, energy}, public', () => {
    const initial = quiet();
    const res = step(initial, [{ actor: 'A', type: 'attachEnergy', card: 'ah0', target: 'a1' } as never]);
    expect(moved(res.events)).toEqual([{ kind: 'moved', owner: 'A', card: 'ah0', origin: { zone: 'hand' },
      destination: { zone: 'active', pokemon: 'a1', role: 'energy' }, visibility: 'public' }]);
    expect(replays(initial, res)).toEqual([]);
  });
});

describe('B.81 moved: Tyme ssp-190 (a lift, a reveal, a return)', () => {
  const board = () => game(
    player({ active: basic('a1'), hand: [{ iid: 'tyme', printing: TYME }, { iid: 'ah-poke', printing: BELLSPROUT }],
      deck: cards('ad', 6), prizes: prizes('ap', 3) }),
    player({ active: basic('b1'), deck: cards('bd', 6), prizes: prizes('bp', 3) }));
  const PLAY = { actor: 'A', type: 'playSupporter', card: 'tyme' } as never;

  it('at the guess: Tyme hand -> resolving (public), the named Pokémon hand -> transit (owner)', () => {
    const initial = board();
    const res = step(initial, [PLAY]);
    const legs = moved(res.events);
    expect(legs).toContain({ kind: 'moved', owner: 'A', card: 'tyme', origin: { zone: 'hand' }, destination: { zone: 'resolving' }, visibility: 'public' });
    expect(legs).toContain({ kind: 'moved', owner: 'A', card: 'ah-poke', origin: { zone: 'hand' }, destination: { zone: 'transit' }, visibility: 'owner' });
    expect(res.state.players.A.transit).toEqual([{ iid: 'ah-poke', printing: BELLSPROUT, origin: { zone: 'hand' }, destination: { zone: 'hand' }, visibility: 'owner' }]);
    expect(replays(initial, res)).toEqual([]);
  });

  it('after the guess: the revealed Pokémon returns transit -> hand PUBLIC, Tyme resolving -> discardPile; the trace replays', () => {
    const initial = board();
    const res = step(initial, [PLAY, { actor: 'B', type: 'selectOption', label: '60' } as never]);
    const legs = moved(res.events).filter(e => e.card === 'ah-poke' || e.card === 'tyme');
    expect(legs).toContain({ kind: 'moved', owner: 'A', card: 'ah-poke', origin: { zone: 'transit' }, destination: { zone: 'hand' }, visibility: 'public' });
    expect(legs).toContain({ kind: 'moved', owner: 'A', card: 'tyme', origin: { zone: 'resolving' }, destination: { zone: 'discardPile' }, visibility: 'public' });
    // the right guess: the opponent draws 4 — four deck -> hand legs, owner-known
    const draws = moved(res.events).filter(e => e.owner === 'B' && e.origin.zone === 'deck' && e.destination.zone === 'hand');
    expect(draws.length).toBe(4);
    expect(draws.every(e => e.visibility === 'owner')).toBe(true);
    expect(replays(initial, res)).toEqual([]);
  });
});

describe('B.81 moved: picks (Burning Charge pre-014, Ultra Ball meg-131)', () => {
  const attacker = () => game(
    player({
      active: { stack: [{ iid: 'a1s0', printing: CARNELIAN }, { iid: 'a1s1', printing: BURNING }],
        energy: [{ iid: 'ae0', printing: FIRE }, { iid: 'ae1', printing: GRASS }], tools: [], damage: 0, conditions: [], markers: markers() },
      bench: [basic('ab1')], deck: cards('ad', 6, FIRE), prizes: prizes('ap', 3),
    }),
    player({ active: basic('b1'), deck: cards('bd', 6), prizes: prizes('bp', 3) }));
  const ATTACK = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Burning Charge' } as never;

  it('a search pick at its pause is deck -> transit (owner): the fix-up leg closes the trace', () => {
    const initial = attacker();
    const res = step(initial, [ATTACK, { actor: 'A', type: 'choose', target: 'ad1' } as never]);
    expect(moved(res.events)).toContain({ kind: 'moved', owner: 'A', card: 'ad1', origin: { zone: 'deck' }, destination: { zone: 'transit' }, visibility: 'owner' });
    expect(replays(initial, res)).toEqual([]);
  });

  it('once attached, each searched Energy has a leg ending on the Active as energy; the trace replays', () => {
    const initial = attacker();
    const res = step(initial, [ATTACK,
      { actor: 'A', type: 'choose', target: 'ad1' } as never, { actor: 'A', type: 'choose', target: 'ad2' } as never,
      { actor: 'A', type: 'choose', target: 'a1s0' } as never]);
    for (const iid of ['ad1', 'ad2']) {
      const last = moved(res.events).filter(e => e.card === iid).pop();
      expect(last?.destination).toEqual({ zone: 'active', pokemon: 'a1s0', role: 'energy' });
      expect(last?.visibility).toBe('public');
    }
    expect(replays(initial, res)).toEqual([]);
  });

  it('a cost discard pick is hand -> discardPile (public) at once (#916)', () => {
    const initial = game(
      player({ active: basic('a1'),
        hand: [{ iid: 'ub', printing: ULTRA_BALL }, { iid: 'h1', printing: GRASS }, { iid: 'h2', printing: GRASS }, { iid: 'h3', printing: GRASS }],
        deck: [{ iid: 'dp', printing: BELLSPROUT }, ...cards('ad', 5)], prizes: prizes('ap', 3) }),
      player({ active: basic('b1'), deck: cards('bd', 6), prizes: prizes('bp', 3) }));
    const res = step(initial, [{ actor: 'A', type: 'playItem', card: 'ub' } as never,
      { actor: 'A', type: 'discard', owner: 'A', target: 'h1' } as never]);
    expect(moved(res.events)).toContain({ kind: 'moved', owner: 'A', card: 'ub', origin: { zone: 'hand' }, destination: { zone: 'resolving' }, visibility: 'public' });
    expect(moved(res.events)).toContain({ kind: 'moved', owner: 'A', card: 'h1', origin: { zone: 'hand' }, destination: { zone: 'discardPile' }, visibility: 'public' });
    expect(replays(initial, res)).toEqual([]);
  });
});

describe('B.81 moved: a Knock Out is one leg per card of the stack, and the Prize is a leg', () => {
  // B's Bellsprout (60 HP) carrying 50 damage; A's Eevee (pre-074 is the PRE alt-art of the SSP Eevee) uses
  // Reckless Charge [C][C] for 30: the KO. B has a bencher, so B's promote and A's Prize pick follow.
  const EEVEE = CARNELIAN;
  const board = () => {
    const g = game(
      player({
        active: { stack: [{ iid: 'a1s0', printing: EEVEE }], energy: [{ iid: 'ae0', printing: FIRE }, { iid: 'ae1', printing: FIRE }],
          tools: [], damage: 0, conditions: [], markers: markers() },
        bench: [basic('ab1')], deck: cards('ad', 6, FIRE), prizes: prizes('ap', 2),
      }),
      player({ active: basic('b1', BELLSPROUT, [{ iid: 'be0', printing: GRASS }]), bench: [basic('bb1')], deck: cards('bd', 6), prizes: prizes('bp', 3) }));
    g.players.B.active!.damage = 50;
    return g;
  };
  const ATTACK = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Reckless Charge' } as never;

  it('the KO\'d Pokémon and its Energy each have a leg active -> discardPile (public), named by stack and role', () => {
    const initial = board();
    const res = step(initial, [ATTACK]);
    expect(res.events.some(e => e.kind === 'ko')).toBe(true);
    const legs = moved(res.events);
    expect(legs.filter(e => e.destination.zone === 'discardPile' && e.owner === 'B').map(e => e.card).sort()).toEqual(['b1', 'be0']);
    expect(legs.find(e => e.card === 'b1')?.origin).toEqual({ zone: 'active', pokemon: 'b1', role: 'pokemon' });
    expect(legs.find(e => e.card === 'be0')?.origin).toEqual({ zone: 'active', pokemon: 'b1', role: 'energy' });
    expect(legs.filter(e => e.owner === 'B').every(e => e.visibility === 'public')).toBe(true);
    expect(replays(initial, res)).toEqual([]);
  });

  it('the taken Prize is one leg prizes -> hand, known to its owner; the trace replays through the KO and the take', () => {
    const initial = board();
    const first = step(initial, [ATTACK]);
    const take = first.pending?.legalActions.find(a => (a as { type: string }).type === 'takePrize');
    const promote = first.pending?.legalActions.find(a => (a as { type: string }).type === 'choose');
    const next = take ?? promote;
    expect(next).toBeDefined();
    const res = step(initial, [ATTACK, { actor: first.pending!.actor, ...(next as object) } as never]);
    if (take !== undefined) {
      const prize = moved(res.events).find(e => e.owner === 'A' && e.origin.zone === 'prizes');
      expect(prize?.destination).toEqual({ zone: 'hand' });
      expect(prize?.visibility).toBe('owner');
    } else {
      const up = moved(res.events).find(e => e.card === 'bb1');
      expect(up?.origin).toEqual({ zone: 'bench', pokemon: 'bb1', role: 'pokemon' });
      expect(up?.destination).toEqual({ zone: 'active', pokemon: 'bb1', role: 'pokemon' });
    }
    expect(replays(initial, res)).toEqual([]);
  });
});

describe('B.81 / B.80: a Prize taken with its reaction open (Lucky Bonus, Chansey mew-113)', () => {
  // The taker has lifted the Prize and seen it; the engine keeps it in the pile until the reaction resolves. The
  // wire shows it in transit {prizes, owner} (N-0275 §2c: a card its owner has seen is never hidden). Mutation
  // guard: drop the `CardList.transit.set` in chansey.ts and the first cell reds (Chansey still on the Prize row).
  const CHANSEY = 'mew-113';
  const board = () => {
    const g = game(
      player({
        active: { stack: [{ iid: 'a1', printing: CARNELIAN }], energy: [{ iid: 'ae0', printing: FIRE }, { iid: 'ae1', printing: FIRE }],
          tools: [], damage: 0, conditions: [], markers: markers() },
        bench: [basic('ab1')], deck: cards('ad', 6, FIRE),
        prizes: [{ iid: 'chansey', printing: CHANSEY, faceUp: false }, { iid: 'ap1', printing: GRASS, faceUp: false }],
      }),
      player({ active: basic('b1', BELLSPROUT, [{ iid: 'be0', printing: GRASS }]), bench: [basic('bb1')], deck: cards('bd', 6), prizes: prizes('bp', 3) }));
    g.players.B.active!.damage = 50;
    return g;
  };
  const ATTACK = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Reckless Charge' } as never;
  const TAKE = { actor: 'A', type: 'takePrize', index: 0 } as never;

  it('while the reaction is open the Prize is in transit {prizes, owner}, off the Prize row, with its leg', () => {
    const initial = board();
    const res = step(initial, [ATTACK, TAKE]);
    expect(res.pending?.actor).toBe('A');
    expect((res.pending?.legalActions ?? []).every(a => (a as { type: string }).type === 'confirm')).toBe(true);
    expect(res.state.players.A.prizes.map(c => c.iid)).toEqual(['ap1']);
    expect(res.state.players.A.transit).toEqual([{ iid: 'chansey', printing: CHANSEY, origin: { zone: 'prizes' }, visibility: 'owner' }]);
    expect(moved(res.events)).toContain({ kind: 'moved', owner: 'A', card: 'chansey', origin: { zone: 'prizes' }, destination: { zone: 'transit' }, visibility: 'owner' });
    expect(replays(initial, res)).toEqual([]);
  });

  it('declined: the Prize goes transit -> hand, known to its owner; the trace replays', () => {
    const initial = board();
    const declined = step(initial, [ATTACK, TAKE, { actor: 'A', type: 'confirm', value: false } as never]);
    expect(declined.state.players.A.hand.map(c => c.iid)).toContain('chansey');
    expect(declined.state.players.A.transit).toEqual([]);
    expect(moved(declined.events).filter(e => e.card === 'chansey').pop()).toEqual(
      { kind: 'moved', owner: 'A', card: 'chansey', origin: { zone: 'transit' }, destination: { zone: 'hand' }, visibility: 'owner' });
    expect(replays(initial, declined)).toEqual([]);
  });

  // TA-592 (fixed): accepting faulted with "Generator is already running" — chansey.ts yielded TAKE_X_PRIZES with a
  // `() => next()` the prefab fires SYNCHRONOUSLY when the remaining Prize pick is forced, re-entering the running
  // generator. Mutation guards (each measured red): restore the yield + callback -> the two forced-accept cells
  // throw; restore the full-array `blocked` -> the two-Prizes-left cell; drop the take of the other Prizes -> the
  // three two-Prize KO cells; drop the count at the take -> 6 cells; read `coinFlip.result` inline -> the flip-pause
  // cell; one ChoosePrizePrompt per Prize group again (check-effect.ts) -> 3 of the two-Prize KO cells.
  const ACCEPT = { actor: 'A', type: 'confirm', value: true } as never;
  const flip = (face: 'heads' | 'tails') => ({ actor: 'system', type: 'flip', face }) as never;

  it('accepted: Chansey transit -> Bench (public), then a coin flip [TA-592]', () => {
    const initial = board();
    const res = step(initial, [ATTACK, TAKE, ACCEPT]);
    expect(res.pending?.legalActions.map(a => (a as { type: string }).type)).toContain('flip');
    expect(res.state.players.A.bench.map(b => b.stack[0].iid)).toEqual(['ab1', 'chansey']);
    expect(res.state.players.A.transit).toEqual([]);
    expect(res.state.players.A.hand.map(c => c.iid)).not.toContain('chansey');
    expect(moved(res.events).filter(e => e.card === 'chansey').pop()).toEqual(
      { kind: 'moved', owner: 'A', card: 'chansey', origin: { zone: 'transit' }, destination: { zone: 'bench', pokemon: 'chansey', role: 'pokemon' }, visibility: 'public' });
    expect(replays(initial, res)).toEqual([]);
  });

  it('accepted, heads: A takes 1 more Prize (the last one) and the trace replays [TA-592]', () => {
    const initial = board();
    const res = step(initial, [ATTACK, TAKE, ACCEPT, flip('heads')]);
    expect(res.state.players.A.prizes).toEqual([]);
    expect(res.state.players.A.hand.map(c => c.iid)).toContain('ap1');
    expect(res.state.players.A.bench.map(b => b.stack[0].iid)).toEqual(['ab1', 'chansey']);
    expect(replays(initial, res)).toEqual([]);
  });

  it('accepted, heads, two Prizes left: either remaining Prize may be taken, and the taken one is in the hand [TA-592]', () => {
    // chansey.ts blocked `player.prizes.indexOf(...)` — a FULL-array index — but `blocked` indexes the NON-EMPTY
    // piles, and Chansey's own pile is empty by then: the first remaining Prize was blocked in its place.
    const initial = board();
    initial.players.A.prizes.push({ iid: 'ap2', printing: FIRE, faceUp: false });
    const res = step(initial, [ATTACK, TAKE, ACCEPT, flip('heads')]);
    expect(res.pending?.legalActions.map(a => (a as { index?: number }).index)).toEqual([0, 1]);
    const took = step(initial, [ATTACK, TAKE, ACCEPT, flip('heads'), TAKE]);
    expect(took.state.players.A.hand.map(c => c.iid)).toContain('ap1');
    expect(took.state.players.A.prizes.map(c => c.iid)).toEqual(['ap2']);
    expect(replays(initial, took)).toEqual([]);
  });

  it('while the reaction is open the Prize already counts as taken this turn [TA-592]', () => {
    // The Prize has been taken (lifted off the row, seen by its taker); only where it goes is open.
    const res = step(board(), [ATTACK, TAKE]);
    expect(res.state.players.A.flags.prizesTakenThisTurn).toBe(1);
    const declined = step(board(), [ATTACK, TAKE, { actor: 'A', type: 'confirm', value: false } as never]);
    expect(declined.state.players.A.flags.prizesTakenThisTurn).toBe(1);
  });

  it('at the coin-flip pause nothing has been decided by the flip yet [TA-592]', () => {
    // chansey.ts read `coinFlip.result` inline; an unscripted flip pauses with the result unset, which the card
    // read as heads — the last Prize was already in the hand at the pause and went back on tails.
    const res = step(board(), [ATTACK, TAKE, ACCEPT]);
    expect(res.state.players.A.prizes.map(c => c.iid)).toEqual(['ap1']);
    expect(res.state.players.A.hand.map(c => c.iid)).not.toContain('ap1');
    expect(res.state.players.A.flags.prizesTakenThisTurn).toBe(1);
  });

  describe('a two-Prize Knock Out with Chansey among the picks [TA-592]', () => {
    // Pre-fix the intercept prevented the WHOLE DrawPrizesEffect, so the other Prize taken with Chansey was never
    // moved: a Pokémon ex KO paid one Prize. And Prizes are taken one at a time (compendium #809: "Whenever you
    // take more than one prize in a single action, each prize can be taken one at a time"), so Chansey's reaction
    // opens when Chansey is taken, before the next pick — pre-fix the picks were collected first, and Chansey
    // was shown in the hand at pick 1 and back in transit at pick 2.
    const exBoard = () => {
      const g = board();
      g.players.A.prizes.push({ iid: 'ap2', printing: FIRE, faceUp: false });
      g.players.B.active = basic('b1', 'wht-020', [{ iid: 'be0', printing: GRASS }]);   // Reshiram ex: 2 Prizes
      g.players.B.active!.damage = 200;
      return g;
    };
    const DECLINE = { actor: 'A', type: 'confirm', value: false } as never;

    it('Chansey first: the reaction opens at once, Chansey in transit, one Prize taken', () => {
      const initial = exBoard();
      const res = step(initial, [ATTACK, TAKE]);
      expect((res.pending?.legalActions ?? []).every(x => (x as { type: string }).type === 'confirm')).toBe(true);
      expect((res.state.players.A.transit ?? []).map(c => c.iid)).toEqual(['chansey']);
      expect(res.state.players.A.prizes.map(c => c.iid)).toEqual(['ap1', 'ap2']);
      expect(res.state.players.A.flags.prizesTakenThisTurn).toBe(1);
      expect(replays(initial, res)).toEqual([]);
    });

    it('declined: the second Prize is picked next; both end in the hand, two taken this turn', () => {
      const initial = exBoard();
      const mid = step(initial, [ATTACK, TAKE, DECLINE]);
      expect(mid.pending?.legalActions.map(x => (x as { type: string }).type)).toEqual(['takePrize', 'takePrize']);
      const res = step(initial, [ATTACK, TAKE, DECLINE, TAKE]);
      expect(res.state.players.A.hand.map(c => c.iid).sort()).toEqual(['ap1', 'chansey']);
      expect(res.state.players.A.prizes.map(c => c.iid)).toEqual(['ap2']);
      expect(res.state.players.A.flags.prizesTakenThisTurn).toBe(2);
      expect(replays(initial, res)).toEqual([]);
    });

    it('accepted, tails: Chansey on the Bench, then the second pick; two taken this turn', () => {
      const initial = exBoard();
      const res = step(initial, [ATTACK, TAKE, ACCEPT, flip('tails'), TAKE]);
      expect(res.state.players.A.hand.map(c => c.iid)).toEqual(['ap1']);
      expect(res.state.players.A.bench.map(b => b.stack[0].iid)).toEqual(['ab1', 'chansey']);
      expect(res.state.players.A.prizes.map(c => c.iid)).toEqual(['ap2']);
      expect(res.state.players.A.flags.prizesTakenThisTurn).toBe(2);
      expect(replays(initial, res)).toEqual([]);
    });

    it('Chansey second: the first Prize is in the hand before Chansey is picked', () => {
      const initial = exBoard();
      const res = step(initial, [ATTACK, { actor: 'A', type: 'takePrize', index: 1 } as never, TAKE]);
      expect(res.state.players.A.hand.map(c => c.iid)).toEqual(['ap1']);
      expect((res.state.players.A.transit ?? []).map(c => c.iid)).toEqual(['chansey']);
      expect(res.state.players.A.flags.prizesTakenThisTurn).toBe(2);
      expect(replays(initial, res)).toEqual([]);
    });
  });

  it('accepted, tails: no more Prize; the last Prize stays on the row [TA-592]', () => {
    const initial = board();
    const res = step(initial, [ATTACK, TAKE, ACCEPT, flip('tails')]);
    expect(res.state.players.A.prizes.map(c => c.iid)).toEqual(['ap1']);
    expect(res.state.players.A.bench.map(b => b.stack[0].iid)).toEqual(['ab1', 'chansey']);
    expect(replays(initial, res)).toEqual([]);
  });
});
