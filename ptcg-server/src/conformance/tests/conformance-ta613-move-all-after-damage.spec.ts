import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-613 (B.76 / B.82, owner 2026-10-05): an attack that moves ALL of its own Energy makes no choice of cards, so the
 * move is an effect of the attack applied after its damage (rulebook Step F: "then do damage …, and then do all other
 * effects"). #2031: "remember, damage is still reduced for the DTE since the detachment happens after damage is done."
 * Twinleaf moved the Energy at WAS_ATTACK_USED, before the damage, so a Double Turbo Energy (brs-151: "The attacks of
 * the Pokémon this card is attached to do 20 less damage to your opponent's Pokémon") was gone before it could reduce
 * the damage, and a target pick or shuffle paused with the Energy already gone (Drop Shot, Feather Shot, Sonic Ripper,
 * Chrono Burst).
 *
 * Each cell drives the attack twice, with and without Double Turbo attached, against B's Active; the damage with it
 * must be lower. Not here: Steel Burst twm-123 and Discharge wht-117 (the damage counts the discarded cards, printed
 * order), Phantasmal Barrage asc-098 (no damage step), and Thunder Raid dri-078 / Crimson Blaster ssp-034 (Bench-only
 * damage placed as PutDamageEffect, which Double Turbo never reads: filed apart).
 */

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;

const ENERGY: Record<string, string> = {
  G: 'sve-001', R: 'sve-002', W: 'sve-003', L: 'sve-004', P: 'sve-005', F: 'sve-006', D: 'sve-007', M: 'sve-008', C: 'sve-008',
};
const DTE = 'brs-151';
const GRENINJA = 'twm-106';   // Stage 2 (Dynamic Blaze's "Evolution Pokémon"), 310 HP

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
  return cards(tag, n, 'sve-001').map(c => ({ ...c, faceUp: false }));
}
function board(printing: string, cost: string, withDte: boolean): NeutralState {
  const energy: CardRef[] = cost.split('').map((t, i) => ({ iid: `ae${i}`, printing: ENERGY[t] }));
  energy.push(withDte ? { iid: 'adte', printing: DTE } : { iid: 'aex', printing: ENERGY[cost[0]] });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: mon('a1', printing, energy), deck: cards('ad', 6, 'sve-001'), prizes: prizes('ap', 6) }),
      B: player({ active: mon('b1', GRENINJA), bench: [mon('bb1', 'pal-061'), mon('bb2', 'tef-062')], deck: cards('bd', 6, 'sve-001'), prizes: prizes('bp', 6) }),
    },
  };
}

const attack = (name: string) => ({ actor: 'A', type: 'declareAttack', source: 'a1', name } as never);
const choose = (target: string) => ({ actor: 'A', type: 'choose', target } as never);
const confirm = { actor: 'A', type: 'confirm', value: true } as never;

/** [printing, attack, cost (one letter per Energy), the actions after declareAttack] */
const ROWS: Array<[string, string, string, never[]]> = [
  ['asc-033', 'Flamebody Cannon', 'RRC', [choose('bb1')]],
  ['jtg-027', 'Flamebody Cannon', 'RRC', [choose('bb1')]],
  ['svp-181', 'Flamebody Cannon', 'RRC', [choose('bb1')]],
  ['asc-045', 'Hail Claw', 'WW', []],
  ['asc-228', 'Hail Claw', 'WW', []],
  ['sfa-014', 'Hail Claw', 'WW', []],
  ['asc-111', 'Draconic Buster', 'FF', []],
  ['dri-104', 'Draconic Buster', 'FF', []],
  ['dri-215', 'Draconic Buster', 'FF', []],
  ['dri-232', 'Draconic Buster', 'FF', []],
  ['dri-241', 'Draconic Buster', 'FF', []],
  ['svp-204', 'Draconic Buster', 'FF', []],
  ['dri-084', 'Clay Blast', 'PPC', []],
  ['jtg-101', 'Drop Shot', 'DDC', [choose('b1')]],
  ['meg-050', 'Riotous Blasting', 'LLL', [confirm]],
  ['meg-158', 'Riotous Blasting', 'LLL', [confirm]],
  ['meg-095', 'Chrono Burst', 'MMC', [confirm]],
  ['meg-100', 'Illusory Impulse', 'RPC', []],
  ['meg-163', 'Illusory Impulse', 'RPC', []],
  ['meg-181', 'Illusory Impulse', 'RPC', []],
  ['mep-011', 'Illusory Impulse', 'RPC', []],
  ['meg-141', 'Aqua Launcher', 'WWW', []],
  ['mep-107', 'Thunderbolt', 'LLC', []],
  ['pfl-029', 'Thunderbolt', 'LC', []],
  ['pfl-111', 'Thunderbolt', 'LC', []],
  ['pfl-126', 'Thunderbolt', 'LC', []],
  ['twm-065', 'Thunderbolt', 'LLC', []],
  ['paf-144', 'Electro Paws', 'LLC', []],
  ['svi-076', 'Electro Paws', 'LLC', []],
  ['svi-209', 'Electro Paws', 'LLC', []],
  ['svp-006', 'Electro Paws', 'LLC', []],
  ['pbl-047', 'Gaia Impact', 'FFC', []],
  ['por-011', 'Feather Shot', 'CCC', [choose('b1')]],
  ['por-055', 'Sonic Ripper', 'MMC', [choose('b1')]],
  ['por-106', 'Sonic Ripper', 'MMC', [choose('b1')]],
  ['pre-017', 'Dynamic Blaze', 'RRR', []],
  ['pre-148', 'Dynamic Blaze', 'RRR', []],
  ['twm-040', 'Dynamic Blaze', 'RRR', []],
  ['twm-192', 'Dynamic Blaze', 'RRR', []],
  ['twm-212', 'Dynamic Blaze', 'RRR', []],
  ['pre-147', 'Raging Amethyst', 'RPM', []],
  ['ssp-036', 'Raging Amethyst', 'RPM', []],
  ['scr-051', 'Fulgurite', 'GLF', []],
  ['scr-159', 'Fulgurite', 'GLF', []],
  ['scr-168', 'Fulgurite', 'GLF', []],
  ['scr-101', 'Hyper Ray', 'CC', []],
  ['sfa-047', 'Trifrost', 'WWMMC', []],
  ['ssp-011', 'Jungle Whip', 'GGC', [confirm]],
  ['twm-068', 'Volt Strike', 'LL', []],
  ['twm-195', 'Volt Strike', 'LL', []],
];

const energyLeft = (s: NeutralState) => (s.players.A.active?.energy ?? []).length;
// the damage dealt to B's Active, read from its `damaged` event (a KO leaves no Active to read)
const dealtToB1 = (events: NeutralEvent[]) => (events as Array<{ kind: string; target?: string; hp?: number }>)
  .filter(e => e.kind === 'damaged' && e.target === 'b1').reduce((n, e) => n + (e.hp ?? 0), 0);

describe('TA-613: an attack that moves all its own Energy moves it after the damage (#2031)', () => {
  for (const [printing, name, cost, rest] of ROWS) {
    it(`${printing} ${name}: Double Turbo still reduces the damage; the Energy is attached at every pause before it [TA-613]`, () => {
      const run = (withDte: boolean) => step(board(printing, cost, withDte), [attack(name), ...rest]);
      const plain = run(false);
      const turbo = run(true);
      expect(dealtToB1(turbo.events)).toBeGreaterThan(0);
      expect(dealtToB1(turbo.events)).toBeLessThan(dealtToB1(plain.events));
      // Double Turbo moved with the rest, after the damage
      expect((turbo.events.filter(e => e.kind === 'moved') as Moved[]).some(e => e.card === 'adte')).toBe(true);
      // every pause before the last action: no Energy has left yet
      for (let n = 1; n <= rest.length; n++) {
        const mid = step(board(printing, cost, true), [attack(name), ...rest.slice(0, n - 1)]);
        expect(energyLeft(mid.state)).toBe(cost.length + 1);
      }
    });
  }
});
