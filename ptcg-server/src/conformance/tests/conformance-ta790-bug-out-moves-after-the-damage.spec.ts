import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-790 (SR-7, B.119): Sizzlipede pbl-009 Bug Out "Reveal the bottom 7 cards of your deck, and this attack does 50
 * damage for each Pokémon you find there that has the Bug Out attack. Then, shuffle any revealed Pokémon back into your
 * deck. Discard the other cards." The reveal and the count come first, the damage next, then the discard and the
 * shuffle (SR-7's own example is Destructo-Press tef-062: "reveal, damage, then discard and shuffle"). Board of
 * scenarios/ta557-pbl-009-bug-out-shuffles-back-every-revealed-pokemon. Printed text from card-data/final/pbl.json.
 */

const GRASS = 'sve-001';
const SIZZLIPEDE = 'pbl-009';
const PANPOUR = 'par-041';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, energy: string[] = []): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })), tools: [], damage: 0,
    conditions: [], markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
/** A's deck top-first; the bottom 7 are ad3 .. ad9. */
function board(bottom7: string[]): NeutralState {
  const deck = [GRASS, GRASS, GRASS, ...bottom7].map((printing, i) => ({ iid: `ad${i}`, printing }));
  const A: PlayerState = { active: mon('a1', SIZZLIPEDE, [GRASS, GRASS, GRASS]), bench: [], hand: [], deck,
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', PANPOUR), bench: [], hand: [],
    deck: Array.from({ length: 8 }, (_, i) => ({ iid: `bd${i}`, printing: GRASS })),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const bugOut = act({ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Bug Out' });
const ta557 = () => board([SIZZLIPEDE, PANPOUR, GRASS, GRASS, GRASS, GRASS, GRASS]);
type Ev = { kind: string; card?: string; target?: string; destination?: { zone?: string } };
type Offer = { type: string; actor?: string; deck?: string[] };
const events = (r: ReturnType<typeof step>) => (r.events ?? []) as unknown as Ev[];
const offers = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? []) as unknown as Offer[];
const ids = (cs: { iid: string }[]) => cs.map(c => c.iid).sort();

describe('TA-790 Bug Out: the damage before the discard and the shuffle', () => {
  it('at the shuffle pause the 50 damage is already on B\'s Active [TA-790 pbl-009]', () => {
    const r = step(ta557(), [bugOut]);
    expect(offers(r).map(a => a.type)).toEqual(['shuffle']);
    expect(r.state.players.B.active!.damage).toBe(50);
  });
  it('the damaged event comes before the discard of the other cards [TA-790 pbl-009 order]', () => {
    const ev = events(step(ta557(), [bugOut]));
    const dmg = ev.findIndex(e => e.kind === 'damaged' && e.target === 'b1');
    const firstDiscard = ev.findIndex(e => e.kind === 'moved' && e.destination?.zone === 'discardPile');
    expect(dmg).toBeGreaterThanOrEqual(0);
    expect(firstDiscard).toBeGreaterThan(dmg);
  });
  it('after the shuffle: both revealed Pokémon are in the deck, the five Energy discarded [TA-790 pbl-009 after]', () => {
    const r0 = step(ta557(), [bugOut]);
    const order = offers(r0)[0].deck ?? [];
    const r = step(ta557(), [bugOut, act({ actor: 'system', type: 'shuffle', order })]);
    expect(r.status).not.toBe('invalidAction');
    expect(ids(r.state.players.A.discard)).toEqual(['ad5', 'ad6', 'ad7', 'ad8', 'ad9']);
    expect(ids(r.state.players.A.deck)).toEqual(['ad0', 'ad1', 'ad2', 'ad3', 'ad4']);
    expect(r.state.players.B.active!.damage).toBe(50);
  });
  it('control: no Bug Out Pokémon revealed, no damage; Panpour still goes back [TA-790 pbl-009 none]', () => {
    const r = step(board([PANPOUR, GRASS, GRASS, GRASS, GRASS, GRASS, GRASS]), [bugOut]);
    expect(offers(r).map(a => a.type)).toEqual(['shuffle']);
    expect(r.state.players.B.active!.damage).toBe(0);
  });
  it('control: no Pokémon revealed, nothing to shuffle back [TA-790 pbl-009 no-pokemon]', () => {
    const r = step(board([GRASS, GRASS, GRASS, GRASS, GRASS, GRASS, GRASS]), [bugOut]);
    expect(offers(r).some(a => a.type === 'shuffle')).toBe(false);
    expect(r.state.players.A.discard.length).toBe(7);
  });
});
