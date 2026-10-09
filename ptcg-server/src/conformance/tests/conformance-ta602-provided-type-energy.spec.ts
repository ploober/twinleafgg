import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-602: "[G] Energy" / "[W] Energy" attached is every attached Energy that PROVIDES the type. Legacy Energy twm-167
 * and Luminous Energy pal-191 provide every type while attached (#687: "You could discard the Rainbow Energy as they
 * do count as all basic energy types"; #443, #383), but Sinistcha twm-022 and Gorebyss dri-056 keyed on the card NAME
 * ("Grass Energy" / "Water Energy"), so neither was offered nor counted. The TA-571 pattern (the energy map of
 * CheckProvidedEnergyEffect) replaces the name test.
 *
 * TA-520: Gorebyss's "Before doing damage, you may attach as many Basic [W] Energy cards as you like from your hand"
 * was gated by a separate confirm and counted as soon as that confirm was raised, so the Energy it attached added
 * nothing. The any-number attach (min 0) is the decision; stopping it is the decline.
 *
 * Controls: a Basic Energy of another type is neither offered (Sinistcha) nor counted (Gorebyss).
 */

const GRASS = 'sve-001';
const WATER = 'sve-003';
const LEGACY = 'twm-167';
const LUMINOUS = 'pal-191';
const DEFENDER = 'twm-106';   // 310 HP: no KO on any cell

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
function board(attacker: string, energy: string[], hand: string[] = []): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon('a1', attacker, energy.map((p, i) => ({ iid: `ae${i}`, printing: p }))),
        hand: hand.map((p, i) => ({ iid: `ah${i}`, printing: p })),
        deck: cards('ad', 6, GRASS), prizes: prizes('ap', 6),
      }),
      B: player({ active: mon('b1', DEFENDER), deck: cards('bd', 6, GRASS), prizes: prizes('bp', 6) }),
    },
  };
}

const attack = (name: string) => ({ actor: 'A', type: 'declareAttack', source: 'a1', name } as never);
const discard = (target: string) => ({ actor: 'A', type: 'discard', owner: 'A', target } as never);
const confirm = (value: boolean) => ({ actor: 'A', type: 'confirm', value } as never);
const attach = (card: string) => ({ actor: 'A', type: 'attachEnergy', card, target: 'a1' } as never);

const dealtToB1 = (events: NeutralEvent[]) => (events as Array<{ kind: string; target?: string; hp?: number }>)
  .filter(e => e.kind === 'damaged' && e.target === 'b1').reduce((n, e) => n + (e.hp ?? 0), 0);
const offeredDiscards = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? [])
  .filter(a => a.type === 'discard').map(a => (a as { target?: string }).target).sort();

describe('TA-602: Sinistcha twm-022 Spill the Tea discards every attached Energy that provides [G]', () => {
  for (const special of [LEGACY, LUMINOUS]) {
    it(`${special} is offered beside the Basic Grass, and discarding it alone does 70 [TA-602]`, () => {
      const b = board('twm-022', [GRASS, special]);
      expect(offeredDiscards(step(b, [attack('Spill the Tea')]))).toEqual(['ae0', 'ae1']);
      const done = step(b, [attack('Spill the Tea'), discard('ae1'), confirm(false)]);
      expect(dealtToB1(done.events)).toBe(70);
      expect(done.state.players.A.discard.map(c => c.printing)).toEqual([special]);
      expect(done.state.players.A.active?.energy.map(c => c.iid)).toEqual(['ae0']);
    });
  }

  it('control: a Basic Water attached is not offered [TA-602]', () => {
    const r = step(board('twm-022', [GRASS, WATER]), [attack('Spill the Tea')]);
    expect(offeredDiscards(r)).toEqual(['ae0']);
  });
});

describe('TA-602 / TA-520: Gorebyss dri-056 Crescendo Wave counts every [W] Energy attached, after its own attach', () => {
  it('Basic Water + Legacy Energy, nothing in hand: 60 [TA-602]', () => {
    expect(dealtToB1(step(board('dri-056', [WATER, LEGACY]), [attack('Crescendo Wave')]).events)).toBe(60);
  });

  it('control: Basic Water + Basic Grass, nothing in hand: 30 [TA-602]', () => {
    expect(dealtToB1(step(board('dri-056', [WATER, GRASS]), [attack('Crescendo Wave')]).events)).toBe(30);
  });

  it('attaching the Basic Water from hand before the damage counts it: 90 [TA-520]', () => {
    const r = step(board('dri-056', [WATER, LEGACY], [WATER]), [attack('Crescendo Wave'), attach('ah0')]);
    expect(r.state.players.A.active?.energy.length).toBe(3);
    expect(dealtToB1(r.events)).toBe(90);
  });

  it('declining the attach counts what is attached: 60, and no separate confirm comes first [TA-520]', () => {
    const first = step(board('dri-056', [WATER, LEGACY], [WATER]), [attack('Crescendo Wave')]);
    expect((first.pending?.legalActions ?? []).map(a => a.type).sort()).toEqual(['attachEnergy', 'confirm']);
    const r = step(board('dri-056', [WATER, LEGACY], [WATER]), [attack('Crescendo Wave'), confirm(false)]);
    expect(dealtToB1(r.events)).toBe(60);
  });
});
