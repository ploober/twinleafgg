import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-784 (B.131, owner 2026-10-25; B.129; #1980): an attack's "You may search your deck …" is a confirm asked at Step D,
 * before the damage. false: the damage, no search, no look, no shuffle. true: the damage, then the search, then the owed
 * shuffle; a search for "a card" must take one (#1980 Shinobi Blade: "You don't have to search, but if you do you must
 * take a card and put it into your hand"; #968: the quantity of cards in the deck is known), an "up to" or "any number"
 * search may stop (B.18). Twinleaf asked nothing: it dealt the damage, then offered the pick with a stop.
 * Mutation guard: drop the ConfirmPrompt -> every "asks first" cell red.
 */

const WATER = 'sve-003';
const GRASS = 'sve-001';
const PSYCHIC = 'sve-005';
const BIG = 'twm-106'; // Greninja ex, 310 HP: no attack here Knocks it Out

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, energy: string[] = []): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: energy.map((p, i) => ({ iid: `${iid}e${i}`, printing: p })), tools: [], damage: 0,
    conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((p, i) => ({ iid: `${tag}${i}`, printing: p }));
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false }));
}
function board(attacker: string, energy: string[], deck: string[]): NeutralState {
  const A: PlayerState = { active: mon('a1', attacker, energy), bench: [], hand: [], deck: cards('ad', deck),
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', BIG), bench: [], hand: [], deck: cards('bd', [WATER, WATER, WATER, WATER]),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const attack = (name: string) => act({ actor: 'A', type: 'declareAttack', source: 'a1', name });
const yes = act({ actor: 'A', type: 'confirm', value: true });
const no = act({ actor: 'A', type: 'confirm', value: false });
const choose = (target: string) => act({ actor: 'A', type: 'choose', target });

function legal(r: ReturnType<typeof step>): string[] {
  const p = (r as any).pending;
  return p ? p.legalActions.map((a: any) => [a.actor, a.type, a.target, a.value].filter(x => x !== undefined && x !== null).join(':')).sort() : [];
}
const shuffled = (r: ReturnType<typeof step>) => r.events.filter(e => (e.kind as string) === 'shuffled').length;
const systemPending = (r: ReturnType<typeof step>) => (r as any).pending?.actor === 'system';
const ASKS = ['A:confirm:false', 'A:confirm:true'];
const DECK4 = [WATER, WATER, WATER, WATER];

const CARDS: Array<[string, string, string[], string[]]> = [
  ['twm-106', 'Shinobi Blade', [WATER], DECK4],
  ['twm-198', 'Shinobi Blade', [WATER], DECK4],
  ['pbl-034', 'Puppet Pull', [PSYCHIC], DECK4],
  ['blk-003', 'Command the Grass', [GRASS, GRASS, GRASS, GRASS], DECK4],
  ['asc-092', 'Roto Call', [WATER], ['asc-092', WATER, WATER, WATER]],
  ['jtg-068', 'Inviting Flowers', [WATER], ['jtg-066', WATER, WATER, WATER]],
];

describe('TA-784 — an attack\'s "You may search your deck": the may first, before the damage', () => {
  for (const [printing, name, energy, deck] of CARDS) {
    it(`${name} asks the may first, nothing dealt yet [TA-784 ${printing}]`, () => {
      const r = step(board(printing, energy, deck), [attack(name)]);
      expect(legal(r)).toEqual(ASKS);
      expect(r.state.players.B.active!.damage).toBe(0);
    });
    it(`${name}: declining deals the damage and neither searches nor shuffles [TA-784 ${printing} declined]`, () => {
      const r = step(board(printing, energy, deck), [attack(name), no]);
      expect(systemPending(r)).toBe(false);
      expect(shuffled(r)).toBe(0);
      expect(r.state.players.A.deck.map(c => c.iid)).toEqual(deck.map((_, i) => `ad${i}`));
    });
  }

  it('Shinobi Blade, yes: the damage, then a card must be taken (no stop, #1980) [TA-784 twm-106 a card]', () => {
    const r = step(board('twm-106', [WATER], DECK4), [attack('Shinobi Blade'), yes]);
    expect(r.state.players.B.active!.damage).toBe(170);
    expect(legal(r)).toEqual(['A:choose:ad0', 'A:choose:ad1', 'A:choose:ad2', 'A:choose:ad3']);
  });
  it('Shinobi Blade, yes, a card: into the hand, then the shuffle [TA-784 twm-106 take]', () => {
    const r = step(board('twm-106', [WATER], DECK4), [attack('Shinobi Blade'), yes, choose('ad2')]);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ad2']);
    expect(systemPending(r)).toBe(true);
  });
  it('Shinobi Blade on an empty deck: the may is still asked; yes shuffles [TA-784 twm-106 empty]', () => {
    expect(legal(step(board('twm-106', [WATER], []), [attack('Shinobi Blade')]))).toEqual(ASKS);
    expect(shuffled(step(board('twm-106', [WATER], []), [attack('Shinobi Blade'), yes]))).toBe(1);
  });
  it('Puppet Pull, yes: a card must be taken (no stop) [TA-784 pbl-034 a card]', () => {
    const r = step(board('pbl-034', [PSYCHIC], DECK4), [attack('Puppet Pull'), yes]);
    expect(legal(r)).toEqual(['A:choose:ad0', 'A:choose:ad1', 'A:choose:ad2', 'A:choose:ad3']);
  });
  it('Command the Grass, yes: the "up to 3" pick may stop [TA-784 blk-003 up to]', () => {
    const r = step(board('blk-003', [GRASS, GRASS, GRASS, GRASS], DECK4), [attack('Command the Grass'), yes]);
    expect(legal(r)).toContain('A:confirm:false');
    expect(legal(r)).toContain('A:choose:ad0');
  });
});
