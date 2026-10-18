import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-710 / B.89 (5) / B.102: an attack's pick of cards from its own discard pile is a Step-D choice. Each pick records
 * `chosen {origin: discardPile}` and the card stays in the discard pile until the effect moves it. TA-674 gave this
 * shape to Energy attaches only (AttachEnergyPrompt); a ChooseCardsPrompt over the discard pile lifted each pick into
 * transit at the pick.
 *
 *  - Kingdra ex sfa-012 / sfa-080 / svp-131 King's Order: "Put up to 3 [W] Pokémon from your discard pile onto your
 *    Bench."
 *  - Iron Leaves twm-019 Recovery Net: "Choose up to 2 Pokémon from your discard pile, reveal them, and put them into
 *    your hand."
 *
 * Rotomancer (34f26e6fb): `chosen` at each pick, the cards in the discard pile until the last pick, then the moves.
 */

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;

const WATER = 'sve-003';
const GRASS = 'sve-001';
const HORSEA = 'sfa-010';   // a Basic [W] Pokémon
const BASIC = 'asc-004';    // a Basic Pokémon that is not [W]

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, GRASS).map(c => ({ ...c, faceUp: false }));
}
const board = (attacker: string, energy: string, discard: CardRef[]): NeutralState => ({
  schemaVersion: SCHEMA_VERSION, turn: 4, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
  players: {
    A: player({ active: mon('a1', attacker, [{ iid: 'ae0', printing: energy }]), discard, deck: cards('ad', 6, GRASS), prizes: prizes('ap', 6) }),
    B: player({ active: mon('b1', BASIC), deck: cards('bd', 6, GRASS), prizes: prizes('bp', 6) }),
  },
});
const choose = (target: string) => ({ actor: 'A', type: 'choose', target } as never);
const chosen = (events: NeutralEvent[]) => events.filter(e => e.kind === 'chosen').map(e => `${(e as { card: string }).card}:${(e as { origin: { zone: string } }).origin.zone}`);
const legs = (events: NeutralEvent[], iid: string) =>
  events.filter((e): e is Moved => e.kind === 'moved' && e.card === iid).map(e => `${e.origin.zone}>${e.destination.zone}`);
const ids = (cs: Array<{ iid: string }> | undefined) => (cs ?? []).map(c => c.iid);

// Cell labels per printing (literal, so the registry can link them).
const KO: Record<string, [string, string]> = {
  'sfa-012': ['[TA-710 sfa-012]', '[TA-710 sfa-012 last]'],
  'sfa-080': ['[TA-710 sfa-080]', '[TA-710 sfa-080 last]'],
  'svp-131': ['[TA-710 svp-131]', '[TA-710 svp-131 last]'],
};
for (const printing of Object.keys(KO)) {
  describe(`TA-710 / B.102: King's Order (${printing}) chooses from the discard pile before anything moves`, () => {
    const declare = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'King\'s Order' } as never;
    const discard = [...cards('adc', 2, HORSEA), { iid: 'adx0', printing: BASIC }];

    it(`the first pick: chosen, and the card stays in the discard pile ${KO[printing][0]}`, () => {
      const r = step(board(printing, WATER, discard), [declare, choose('adc0')]);
      expect(r.pending?.actor).toBe('A');
      expect(chosen(r.events)).toEqual(['adc0:discardPile']);
      expect(ids(r.state.players.A.discard)).toEqual(['adc0', 'adc1', 'adx0']);
      expect(ids(r.state.players.A.transit)).toEqual([]);
      expect(legs(r.events, 'adc0')).toEqual([]);
    });

    it(`the last pick: both chosen, then both go to the Bench ${KO[printing][1]}`, () => {
      const r = step(board(printing, WATER, discard), [declare, choose('adc0'), choose('adc1')]);
      expect(chosen(r.events)).toEqual(['adc0:discardPile', 'adc1:discardPile']);
      expect(legs(r.events, 'adc0')).toEqual(['discardPile>bench']);
      expect(legs(r.events, 'adc1')).toEqual(['discardPile>bench']);
      expect(ids(r.state.players.A.discard)).toEqual(['adx0']);
    });
  });
}

describe('TA-710 / B.102: Recovery Net (Iron Leaves twm-019) chooses from the discard pile before anything moves', () => {
  const declare = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Recovery Net' } as never;
  const discard = [{ iid: 'adc0', printing: BASIC }, { iid: 'adc1', printing: HORSEA }, { iid: 'adc2', printing: BASIC }];

  it('the first pick: chosen, and the card stays in the discard pile [TA-710 twm-019]', () => {
    const r = step(board('twm-019', GRASS, discard), [declare, choose('adc0')]);
    expect(r.pending?.actor).toBe('A');
    expect(chosen(r.events)).toEqual(['adc0:discardPile']);
    expect(ids(r.state.players.A.discard)).toEqual(['adc0', 'adc1', 'adc2']);
    expect(ids(r.state.players.A.transit)).toEqual([]);
  });

  it('the second pick: both chosen, then both go to the hand, with no reveal (B.97) [TA-710 twm-019]', () => {
    const r = step(board('twm-019', GRASS, discard), [declare, choose('adc0'), choose('adc1')]);
    expect(chosen(r.events)).toEqual(['adc0:discardPile', 'adc1:discardPile']);
    expect(legs(r.events, 'adc0')).toEqual(['discardPile>hand']);
    expect(legs(r.events, 'adc1')).toEqual(['discardPile>hand']);
    expect(r.events.filter(e => e.kind === 'reveal')).toEqual([]);
  });

  it('control: two Pokémon in the discard pile and both taken is still a choice (up to 2 lets the player stop) [TA-710 twm-019]', () => {
    const r = step(board('twm-019', GRASS, discard.slice(0, 2)), [declare]);
    expect(r.pending?.actor).toBe('A');
    expect((r.pending?.legalActions ?? []).some(a => a.type === 'confirm')).toBe(true);
  });
});
