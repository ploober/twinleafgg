import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * Audit 1: "up to X" in an attack's effect means 0..X (compendium #2301; the one exception is a deck/discard
 * search for "any card you want" that names no kind). The stop is surfaced on the wire ONLY by the prompt's
 * `min` (the decomposer offers `confirm{false}` when picks >= min and max > min). "For each ... you did in this
 * way" damage is computed from the chosen set, so 0 picks gives 0 damage.
 *
 * Card text in the cell comments is quoted from card-data/final/<set>.json (the card oracle), not the TS file.
 */

const E: Record<string, string> = {
  G: 'sve-001', R: 'sve-002', W: 'sve-003', L: 'sve-004', P: 'sve-005', F: 'sve-006', D: 'sve-007', M: 'sve-008',
};

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
/** A Pokemon-in-play; `stack` lists printings bottom (basic) to top. The basic's iid is `iid`. */
function mon(iid: string, stack: string[], energy: string = ''): PokemonInPlay {
  return {
    stack: stack.map((printing, i) => ({ iid: i === 0 ? iid : `${iid}s${i}`, printing })),
    energy: energy.split('').filter(t => t !== '').map((t, i) => ({ iid: `${iid}e${i}`, printing: E[t] })),
    tools: [], damage: 0, conditions: [], markers: markers(),
  };
}
function cards(tag: string, ps: string[]): CardRef[] {
  return ps.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, Array(n).fill(E.M)).map(c => ({ ...c, faceUp: false }));
}

/**
 * A's Active is `attacker` (a stack, bottom first) with `energy`; A's discard and hand hold the given
 * printings; two Erika's Bellsprout on each Bench; B's Active is Venusaur ex mew-003.
 */
function board(attacker: string[], energy: string, opts: { discard?: string[]; hand?: string[]; bEnergy?: string } = {}): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing',
    stadium: null,
    players: {
      A: player({
        active: mon('a1', attacker, energy), bench: [mon('ab1', ['asc-004']), mon('ab2', ['asc-004'])],
        hand: cards('ah', opts.hand ?? [E.G]), deck: cards('ad', [E.R, E.R, E.G, E.W, E.P, E.L, E.F, E.D, E.M, E.M]),
        discard: cards('adc', opts.discard ?? []), prizes: prizes('ap', 3),
      }),
      B: player({
        active: mon('b1', ['mew-003'], opts.bEnergy ?? 'RL'), bench: [mon('bb1', ['asc-004']), mon('bb2', ['asc-004'])],
        hand: cards('bh', [E.G]), deck: cards('bd', Array(10).fill(E.G)), prizes: prizes('bp', 3),
      }),
    },
  } as NeutralState;
}

const A = (o: Record<string, unknown>) => ({ actor: 'A', ...o } as never);
const declare = (name: string) => A({ type: 'declareAttack', source: 'a1', name });
const choose = (target: string) => A({ type: 'choose', target });
const disc = (target: string) => A({ type: 'discard', owner: 'A', target });
const counter = (target: string) => A({ type: 'placeCounter', target });
const stop = A({ type: 'confirm', value: false });

/** The attack's own events: from `attackUsed` up to the end of the turn. */
function attackEvents(events: NeutralEvent[]): NeutralEvent[] {
  const i = events.findIndex(e => e.kind === 'attackUsed');
  const j = events.findIndex(e => e.kind === 'turnEnded');
  return events.slice(i + 1, j < 0 ? undefined : j);
}
const offersStop = (r: ReturnType<typeof step>) =>
  (r.pending?.legalActions ?? []).some(a => a.type === 'confirm' && (a as { value?: boolean }).value === false);
const offered = (r: ReturnType<typeof step>, type: string) =>
  (r.pending?.legalActions ?? []).filter(a => a.type === type).map(a => (a as { target?: string }).target).sort();

describe('TA-682: Iron Leaves twm-019 Recovery Net ("Put up to 2 Pokémon from your discard pile into your hand.") is 0..2', () => {
  const b = () => board(['twm-019'], 'G', { discard: ['asc-004', 'asc-004'] });

  it('twm-019 Recovery Net with two Pokémon in the discard offers both and the stop at the first pick [TA-682]', () => {
    const r = step(b(), [declare('Recovery Net')]);
    expect(offered(r, 'choose')).toEqual(['adc0', 'adc1']);
    expect(offersStop(r)).toBe(true);
  });

  it('twm-019 Recovery Net: after one pick the stop is still offered [TA-682]', () => {
    const r = step(b(), [declare('Recovery Net'), choose('adc0')]);
    expect(offered(r, 'choose')).toEqual(['adc1']);
    expect(offersStop(r)).toBe(true);
  });

  it('twm-019 Recovery Net: a card picked out of the discard pile is in transit as public (a public zone), origin discardPile [TA-689]', () => {
    // Contract (TransitCard.visibility): `public` is "revealed to both players"; a discard pile is public, so a card
    // lifted out of it is public in transit. The mid-pick lift projected every `choose` pick as `owner`.
    const r = step(b(), [declare('Recovery Net'), choose('adc0')]);
    const t = r.state.players.A.transit ?? [];
    expect(t.map(e => e.iid)).toEqual(['adc0']);
    expect(t[0].origin).toEqual({ zone: 'discardPile' });
    expect(t[0].visibility).toBe('public');
  });

  it('twm-019 Recovery Net: stopping at 0 takes nothing; both Pokémon stay in the discard [TA-682]', () => {
    const r = step(b(), [declare('Recovery Net'), stop]);
    expect(r.status).not.toBe('invalidAction');
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['adc0', 'adc1']);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ah0']);
  });

  it('twm-019 Recovery Net: one pick then the stop puts that one card into the hand [TA-682]', () => {
    const r = step(b(), [declare('Recovery Net'), choose('adc1'), stop]);
    expect(r.state.players.A.hand.map(c => c.iid).sort()).toEqual(['adc1', 'ah0']);
    expect(r.state.players.A.discard.map(c => c.iid)).toEqual(['adc0']);
  });
});


describe('Walking Wake calibration: Walking Wake twm-063 Undulating Slice ("Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.")', () => {
  const b = () => board(['twm-063'], 'WWG');

  it('twm-063 Undulating Slice offers the stop at the first counter, and only this Pokémon as a target [Walking Wake calibration]', () => {
    const r = step(b(), [declare('Undulating Slice')]);
    expect(offered(r, 'placeCounter')).toEqual(['a1']);
    expect(offersStop(r)).toBe(true);
  });

  it('twm-063 Undulating Slice: 0 counters placed does 0 damage [Walking Wake calibration]', () => {
    const r = step(b(), [declare('Undulating Slice'), stop]);
    expect(r.status).not.toBe('invalidAction');
    expect(r.state.players.B.active?.damage).toBe(0);
    expect(r.state.players.A.active?.damage).toBe(0);
    expect(attackEvents(r.events).filter(e => e.kind === 'damaged' && (e as { hp?: number }).hp !== 0)).toEqual([]);
  });

  it('twm-063 Undulating Slice: 3 counters placed does 60, with 30 damage on Walking Wake [Walking Wake calibration]', () => {
    const r = step(b(), [declare('Undulating Slice'), counter('a1'), counter('a1'), counter('a1'), stop]);
    expect(r.status).not.toBe('invalidAction');
    expect(r.state.players.B.active?.damage).toBe(60);
    expect(r.state.players.A.active?.damage).toBe(30);
  });
});


describe('TA-683: Kingdra ex sfa-012 King\'s Order ("Put up to 3 [Water] Pokémon from your discard pile onto your Bench.") is 0..3', () => {
  // Horsea sfa-010 is a Basic [W] Pokémon; two of them in the discard, three Bench slots free.
  const b = () => board(['sfa-010', 'sfa-011', 'sfa-012'], 'W', { discard: ['sfa-010', 'sfa-010'] });

  it('sfa-012 King\'s Order with two Basic [W] Pokémon in the discard offers both and the stop at the first pick [TA-683]', () => {
    const r = step(b(), [declare('King\'s Order')]);
    expect(offered(r, 'choose')).toEqual(['adc0', 'adc1']);
    expect(offersStop(r)).toBe(true);
  });

  it('sfa-012 King\'s Order: stopping at 0 benches nothing [TA-683]', () => {
    const r = step(b(), [declare('King\'s Order'), stop]);
    expect(r.status).not.toBe('invalidAction');
    expect(r.state.players.A.bench.length).toBe(2);
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['adc0', 'adc1']);
  });

  it('sfa-012 King\'s Order: one pick then the stop benches that one [TA-683]', () => {
    const r = step(b(), [declare('King\'s Order'), choose('adc0'), stop]);
    expect(r.state.players.A.bench.length).toBe(3);
    expect(r.state.players.A.bench[2].stack.map(c => c.iid)).toEqual(['adc0']);
    expect(r.state.players.A.discard.map(c => c.iid)).toEqual(['adc1']);
  });
});


describe('TA-684: Wugtrio ex tef-060 Tricolor Pump ("Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent\'s Pokémon for each Energy card you discarded in this way. (Don\'t apply Weakness and Resistance for Benched Pokémon.)")', () => {
  // Wiglett svi-056 is the Basic under Wugtrio ex; three Basic Energy in the hand.
  const b = () => board(['svi-056', 'tef-060'], 'W', { hand: [E.W, E.L, E.G] });

  it('tef-060 Tricolor Pump offers the three Energy and the stop at the first pick [TA-684]', () => {
    const r = step(b(), [declare('Tricolor Pump')]);
    expect(offered(r, 'discard')).toEqual(['ah0', 'ah1', 'ah2']);
    expect(offersStop(r)).toBe(true);
  });

  it('tef-060 Tricolor Pump: 0 Energy discarded asks for no target and does no damage [TA-684]', () => {
    const r = step(b(), [declare('Tricolor Pump'), stop]);
    expect(r.status).not.toBe('invalidAction');
    expect(r.pending?.actor).not.toBe('A' as never);
    expect(offered(r, 'choose')).toEqual([]);
    expect(r.state.players.B.active?.damage).toBe(0);
    expect(r.state.players.B.bench.map(p => p.damage)).toEqual([0, 0]);
    expect(r.state.players.A.hand.map(c => c.iid).sort()).toEqual(['ah0', 'ah1', 'ah2']);
  });

  it('tef-060 Tricolor Pump: 2 Energy discarded, then the target pick over every opposing Pokémon, does 120 to the chosen one [TA-684]', () => {
    const mid = step(b(), [declare('Tricolor Pump'), disc('ah0'), disc('ah1'), stop]);
    expect(offered(mid, 'choose')).toEqual(['b1', 'bb1', 'bb2']);
    const r = step(b(), [declare('Tricolor Pump'), disc('ah0'), disc('ah1'), stop, choose('b1')]);
    expect(r.status).not.toBe('invalidAction');
    expect(r.state.players.B.active?.damage).toBe(120);
    expect(r.state.players.B.bench.map(p => p.damage)).toEqual([0, 0]);
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['ah0', 'ah1']);
  });
});

describe('TA-685: Wugtrio ex tef-060 Numbing Hold ("During your opponent\'s next turn, the Defending Pokémon can\'t retreat.")', () => {
  // Venusaur ex mew-003 retreats for [C][C][C][C]; B's Active carries four Energy so a retreat is otherwise offered.
  const b = (hand: string[] = [E.G]) => board(['svi-056', 'tef-060'], 'WW', { hand, bEnergy: 'RLGG' });
  const types = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? []).map(a => a.type);

  it('tef-060 Numbing Hold: on the opponent\'s next turn the Defending Pokémon is not offered a retreat [TA-685]', () => {
    const r = step(b(), [declare('Numbing Hold')]);
    expect(r.state.players.B.active?.damage).toBe(120);
    expect(r.state.activePlayer).toBe('B');
    expect(r.pending?.actor).toBe('B' as never);
    expect(types(r)).not.toContain('retreat');
  });

  it('tef-060 Tricolor Pump (the other attack) leaves the opponent\'s retreat offered [TA-685]', () => {
    // One eligible Energy: the pick completes after it (no stop pending), then the target pick.
    const r = step(b([E.W]), [declare('Tricolor Pump'), disc('ah0'), choose('b1')]);
    expect(r.state.players.B.active?.damage).toBe(60);
    expect(r.state.activePlayer).toBe('B');
    expect(types(r)).toContain('retreat');
  });
});
