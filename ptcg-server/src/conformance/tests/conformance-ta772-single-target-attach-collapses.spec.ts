import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-772 (B.116, owner 2026-10-23, amended; CF-14, CF-5) — an in-effect attach whose every candidate card has the same
 * single legal target collapses the target: the card is asked with choose {target: card} (op: attach), the Energy goes
 * to that Pokémon, and an attachEnergy {card, target} pair there is not offered (invalidAction). Twinleaf's adapter
 * offered the pairs. Controls: the same card with two legal targets keeps its pairs (CF-5), on a board with two
 * candidate cards and two Pokémon (a non-degenerate board).
 * Mutation guard: drop the `collapsed` plan in attach-energy.ts planStep -> the pairs come back and the cells red.
 */

const FIRE = 'sve-002', PSYCHIC = 'sve-005', LIGHTNING = 'sve-004', WATER = 'sve-003', FILLER = 'asc-004';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function pip(stack: CardRef[], energy: CardRef[] = []): PokemonInPlay {
  return { stack, energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(tag: string, over: Partial<PlayerState>): PlayerState {
  return {
    active: null, bench: [], hand: [], discard: [], lostZone: [],
    deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: WATER })),
    prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false })),
    flags: flags(), ...over,
  };
}
function state(A: PlayerState, B: PlayerState): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B },
  };
}
type Act = { type: string; target?: string; card?: string; op?: string; value?: boolean };
const acts = (r: ReturnType<typeof step>): string[] => ((r.pending?.legalActions ?? []) as unknown as Act[])
  .map(a => (a.type === 'confirm' ? `confirm:${a.value}` : `${a.type}:${a.card ? a.card + '>' : ''}${a.target}${a.op ? ':' + a.op : ''}`)).sort();
const choose = (target: string) => ({ actor: 'A', type: 'choose', target } as unknown as NeutralAction);
const pair = (card: string, target: string) => ({ actor: 'A', type: 'attachEnergy', card, target } as unknown as NeutralAction);
const declare = (name: string) => ({ actor: 'A', type: 'declareAttack', source: 'a1s0', name } as unknown as NeutralAction);
const opp = () => player('b', { active: pip([{ iid: 'b1s0', printing: FILLER }]) });
const deckOf = (energy: string, n: number) => [
  ...Array.from({ length: n }, (_, i) => ({ iid: `ad${i}`, printing: energy })),
  ...Array.from({ length: 6 }, (_, i) => ({ iid: `adx${i}`, printing: FILLER })),
];
const benchOf = (n: number, printing = FILLER) => Array.from({ length: n }, (_, i) => pip([{ iid: `ab${i + 1}s0`, printing }]));

/** A board: the attacker `printing` Active with `cost` attached, `bench` Benched Pokémon, `n` matching Energy in the deck. */
function board(printing: string, cost: CardRef[], energy: string, n: number, bench: PokemonInPlay[]): NeutralState {
  return state(player('a', { active: pip([{ iid: 'a1s0', printing }], cost), bench, deck: deckOf(energy, n) }), opp());
}
const att = (printing: string, k = 1) => Array.from({ length: k }, (_, i) => ({ iid: `ae${i}`, printing }));

describe('TA-772 — a single-target in-effect attach asks the card alone (B.116)', () => {
  // Increasing Spice svi-028: "Search your deck for a Basic [R] Energy card and attach it to this Pokémon." (min 0).
  describe('Increasing Spice svi-028 (this Pokémon)', () => {
    const b = () => board('svi-028', att(FIRE), FIRE, 2, benchOf(1));
    it('offers choose {target: card} op attach, plus the stop [TA-772 svi-028]', () => {
      expect(acts(step(b(), [declare('Increasing Spice')]))).toEqual(['choose:ad0:attach', 'choose:ad1:attach', 'confirm:false']);
    });
    it('choose ad1 attaches it to the Active [TA-772 svi-028 attached]', () => {
      const r = step(b(), [declare('Increasing Spice'), choose('ad1')]);
      expect(r.status).not.toBe('invalidAction');
      expect(r.state.players.A.active!.energy.map(e => e.iid)).toEqual(['ae0', 'ad1']);
    });
    it('a pair on the collapsed step is refused [TA-772 svi-028 pair refused]', () => {
      expect(step(b(), [declare('Increasing Spice'), pair('ad1', 'a1s0')]).status).toBe('invalidAction');
    });
  });

  // Turbo Flare meg-028: "Search your deck for up to 3 Basic Energy cards and attach them to your Benched Pokémon in any way you like."
  describe('Turbo Flare meg-028', () => {
    it('one Benched Pokémon: choose {target: card} per candidate, plus the stop [TA-772 meg-028]', () => {
      expect(acts(step(board('meg-028', att(FIRE), FIRE, 2, benchOf(1)), [declare('Turbo Flare')])))
        .toEqual(['choose:ad0:attach', 'choose:ad1:attach', 'confirm:false']);
    });
    it('one Benched Pokémon: the picks attach to it [TA-772 meg-028 attached]', () => {
      const r = step(board('meg-028', att(FIRE), FIRE, 2, benchOf(1)), [declare('Turbo Flare'), choose('ad0'), choose('ad1')]);
      expect(r.status).not.toBe('invalidAction');
      expect(r.state.players.A.bench[0].energy.map(e => e.iid)).toEqual(['ad0', 'ad1']);
    });
    it('a pair on the collapsed step is refused [TA-772 meg-028 pair refused]', () => {
      expect(step(board('meg-028', att(FIRE), FIRE, 2, benchOf(1)), [declare('Turbo Flare'), pair('ad0', 'ab1s0')]).status).toBe('invalidAction');
    });
    it('control: two Benched Pokémon keep the pairs (CF-5) [TA-772 meg-028 control two targets]', () => {
      expect(acts(step(board('meg-028', att(FIRE), FIRE, 2, benchOf(2)), [declare('Turbo Flare')]))).toEqual([
        'attachEnergy:ad0>ab1s0', 'attachEnergy:ad0>ab2s0', 'attachEnergy:ad1>ab1s0', 'attachEnergy:ad1>ab2s0', 'confirm:false',
      ]);
    });
  });

  // Overflowing Wishes meg-060 / asc-089: "For each of your Benched Pokémon, search your deck for a Basic [P] Energy and attach it to that Pokémon."
  describe('Overflowing Wishes meg-060', () => {
    it('one Benched Pokémon: choose {target: card}, plus the engine\'s stop [TA-772 meg-060]', () => {
      expect(acts(step(board('meg-060', att(PSYCHIC), PSYCHIC, 2, benchOf(1)), [declare('Overflowing Wishes')])))
        .toEqual(['choose:ad0:attach', 'choose:ad1:attach', 'confirm:false']);
    });
    it('one Benched Pokémon: the pick attaches to it [TA-772 meg-060 attached]', () => {
      const r = step(board('meg-060', att(PSYCHIC), PSYCHIC, 2, benchOf(1)), [declare('Overflowing Wishes'), choose('ad1')]);
      expect(r.status).not.toBe('invalidAction');
      expect(r.state.players.A.bench[0].energy.map(e => e.iid)).toEqual(['ad1']);
    });
    it('control: two Benched Pokémon keep the pairs [TA-772 meg-060 control two targets]', () => {
      expect(acts(step(board('meg-060', att(PSYCHIC), PSYCHIC, 2, benchOf(2)), [declare('Overflowing Wishes')]))).toEqual([
        'attachEnergy:ad0>ab1s0', 'attachEnergy:ad0>ab2s0', 'attachEnergy:ad1>ab1s0', 'attachEnergy:ad1>ab2s0', 'confirm:false',
      ]);
    });
  });

  // Eternity Bloom cri-035: "Search your deck for up to 4 Basic [P] Energy cards and attach them to your Benched Pokémon in any way you like."
  describe('Eternity Bloom cri-035', () => {
    it('one Benched Pokémon: choose {target: card}, plus the stop [TA-772 cri-035]', () => {
      expect(acts(step(board('cri-035', att(PSYCHIC, 3), PSYCHIC, 2, benchOf(1)), [declare('Eternity Bloom')])))
        .toEqual(['choose:ad0:attach', 'choose:ad1:attach', 'confirm:false']);
    });
    it('control: two Benched Pokémon keep the pairs [TA-772 cri-035 control two targets]', () => {
      expect(acts(step(board('cri-035', att(PSYCHIC, 3), PSYCHIC, 2, benchOf(2)), [declare('Eternity Bloom')]))).toEqual([
        'attachEnergy:ad0>ab1s0', 'attachEnergy:ad0>ab2s0', 'attachEnergy:ad1>ab1s0', 'attachEnergy:ad1>ab2s0', 'confirm:false',
      ]);
    });
  });

  // Peak Acceleration tef-121: "Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like."
  describe('Peak Acceleration tef-121', () => {
    it('the attacker is the only Future Pokémon: choose {target: card}, plus the stop [TA-772 tef-121]', () => {
      expect(acts(step(board('tef-121', att(LIGHTNING), LIGHTNING, 2, benchOf(1)), [declare('Peak Acceleration')])))
        .toEqual(['choose:ad0:attach', 'choose:ad1:attach', 'confirm:false']);
    });
    it('control: a Benched Future Pokémon keeps the pairs [TA-772 tef-121 control two targets]', () => {
      expect(acts(step(board('tef-121', att(LIGHTNING), LIGHTNING, 2, benchOf(1, 'tef-121')), [declare('Peak Acceleration')]))).toEqual([
        'attachEnergy:ad0>a1s0', 'attachEnergy:ad0>ab1s0', 'attachEnergy:ad1>a1s0', 'attachEnergy:ad1>ab1s0', 'confirm:false',
      ]);
    });
  });
});
