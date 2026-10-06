import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-632 Geeta obf-188 (geeta.ts): "Search your deck for up to 2 Basic Energy cards and attach them to 1 of your
 * Pokémon. Then, shuffle your deck. During this turn, your Pokémon can't attack. (This includes Pokémon that come into
 * play this turn.)"
 *
 * Driven 2026-10-06 on twinleaf c6ea52669 x rotomancer 766f5b3e7:
 * - no Benched Pokémon: twinleaf resolved Geeta with no search (and no lock); rotomancer opens the search and the
 *   Active is a legal attach target ("1 of your Pokémon").
 * - 0 Energy found (declined search, or a deck with none, or an empty deck): twinleaf still offered Vine Slap; the
 *   lock is unconditional, rotomancer offers no attack.
 * - the attach-target cancel (allowCancel: true in geeta.ts) is not offered over the wire by either engine (the
 *   choose-pokemon decomposer offers only the targets), so it is not pinned here.
 * FX-0404's order stays: the shuffle, then Geeta to the discard pile.
 */

const E = 'sve-001';
const BELLSPROUT = 'asc-004';   // Vine Slap [G] 20

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing: BELLSPROUT }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, E).map(c => ({ ...c, faceUp: false }));
}
function board(opts: { bench?: boolean; deck?: CardRef[] } = {}): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main',
    outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon('a1', [{ iid: 'ae0', printing: E }]), bench: opts.bench === false ? [] : [mon('ab1')],
        hand: [{ iid: 'g', printing: 'obf-188' }], deck: opts.deck ?? cards('ad', 6, E), prizes: prizes('ap', 6),
      }),
      B: player({ active: mon('b1'), deck: cards('bd', 6, E), prizes: prizes('bp', 6) }),
    },
  } as NeutralState;
}

const act = (a: object) => a as unknown as NeutralAction;
const play = act({ actor: 'A', type: 'playSupporter', card: 'g' });
const choose = (target: string) => act({ actor: 'A', type: 'choose', target });
const decline = act({ actor: 'A', type: 'confirm', value: false });
const vineSlap = act({ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Vine Slap' });

/** Steps, answering the system shuffle with the offered order whenever it is pending. */
function run(b: NeutralState, actions: NeutralAction[]): ReturnType<typeof step> {
  let acts = [...actions];
  let r = step(b, acts);
  for (let i = 0; i < 3 && r.status !== 'invalidAction'; i++) {
    const s = r.pending?.legalActions.find(a => a.type === 'shuffle') as { deck?: string[] } | undefined;
    if (s === undefined) { break; }
    acts = [...acts, act({ actor: 'system', type: 'shuffle', order: s.deck ?? [] })];
    r = step(b, acts);
  }
  return r;
}
const types = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? []).map(a => a.type);
const targets = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? []).map(a => (a as { target?: string }).target).sort();
const energy = (r: ReturnType<typeof step>) => (r.state.players.A.active?.energy ?? []).map(e => e.iid);

describe('TA-632: Geeta obf-188 needs no Bench and always locks attacks this turn', () => {
  it('no Benched Pokémon: Geeta opens its search [TA-632]', () => {
    const r = step(board({ bench: false }), [play]);
    expect(r.status).toBe('awaitingAction');
    expect(targets(r)).toContain('ad0');
  });

  it('no Benched Pokémon: the 2 Energy go to the Active (the only target, no choice), then shuffle, Geeta discarded, no attack [TA-632]', () => {
    const pick = step(board({ bench: false }), [play, choose('ad0'), choose('ad1')]);
    expect(types(pick)).toEqual(['shuffle']);
    expect(energy(pick)).toEqual(['ae0', 'ad0', 'ad1']);
    const r = run(board({ bench: false }), [play, choose('ad0'), choose('ad1')]);
    expect(r.status).toBe('awaitingAction');
    expect(energy(r)).toEqual(['ae0', 'ad0', 'ad1']);
    expect(r.state.players.A.discard.map(c => c.iid)).toContain('g');
    expect(types(r)).not.toContain('declareAttack');
  });

  it('search declined (0 found): no attack this turn [TA-632]', () => {
    const r = run(board(), [play, decline]);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.discard.map(c => c.iid)).toContain('g');
    expect(types(r)).not.toContain('declareAttack');
  });

  it('search declined (0 found): declaring Vine Slap is refused [TA-632]', () => {
    const r = run(board(), [play, decline]);
    const acts = [play, decline, act({ actor: 'system', type: 'shuffle', order: r.state.players.A.deck.map(c => c.iid) }), vineSlap];
    expect(step(board(), acts).status).toBe('invalidAction');
  });

  it('a deck with no Basic Energy: no attack this turn [TA-632]', () => {
    const r = run(board({ deck: cards('ad', 6, BELLSPROUT) }), [play]);
    expect(r.status).toBe('awaitingAction');
    expect(types(r)).not.toContain('declareAttack');
  });

  it('an empty deck: no attack this turn [TA-632]', () => {
    const r = run(board({ deck: [] }), [play]);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.discard.map(c => c.iid)).toContain('g');
    expect(types(r)).not.toContain('declareAttack');
  });

  it('control: 2 Energy attached to the Benched Pokémon, no attack this turn [TA-632]', () => {
    const r = run(board(), [play, choose('ad0'), choose('ad1'), choose('ab1')]);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.bench[0].energy.map(e => e.iid)).toEqual(['ad0', 'ad1']);
    expect(types(r)).not.toContain('declareAttack');
  });

  it('control: the attach target offers only the Pokémon (no cancel on the wire) [TA-632]', () => {
    const r = step(board(), [play, choose('ad0'), choose('ad1')]);
    expect(types(r)).toEqual(['choose', 'choose']);
    expect(targets(r)).toEqual(['a1', 'ab1']);
  });

  it('control: the lock ends with the turn (B can attack on its turn) [TA-632]', () => {
    const r = run(board(), [play, decline]);
    const acts = [play, decline, act({ actor: 'system', type: 'shuffle', order: r.state.players.A.deck.map(c => c.iid) }),
      act({ actor: 'A', type: 'endTurn' })];
    const b = step(board(), acts);
    expect(b.pending?.actor).toBe('B');
  });
});
