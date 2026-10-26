import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-785 (B.130, owner 2026-10-25): Evidence Gathering meg-110 "Switch a card from your hand with the top card of your
 * deck." is not a draw (only a printed "draw" is): the switch emits its two moved legs and no draw. Twinleaf counted the
 * top-card take as a draw (TA-593's positional-take listener). Mutation guard: take the top card by count -> red.
 *
 * (TA-784 (B.131, owner 2026-10-25; B.129; #1980): an attack's "You may search your deck …" is a confirm asked at Step D,
 * before the damage. false: the damage, no search, no look, no shuffle. true: the damage, then the search, then the owed
 * shuffle; a search for "a card" must take one (#1980 Shinobi Blade: "You don't have to search, but if you do you must
 * take a card and put it into your hand"; #968: the quantity of cards in the deck is known), an "up to" or "any number"
 * search may stop (B.18). Twinleaf asked nothing: it dealt the damage, then offered the pick with a stop.
 * Mutation guard: drop the ConfirmPrompt -> every "asks first" cell red.
 */

const WATER = 'sve-003';
const GRASS = 'sve-001';
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
  const A: PlayerState = { active: mon('a1', attacker, energy), bench: [], hand: cards('ah', [WATER, GRASS]), deck: cards('ad', deck),
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', BIG), bench: [], hand: [], deck: cards('bd', [WATER, WATER, WATER, WATER]),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const use = act({ actor: 'A', type: 'useAbility', source: 'a1', ability: 'Evidence Gathering' });
const choose = (target: string) => act({ actor: 'A', type: 'choose', target });

describe('TA-785 — Evidence Gathering meg-110: a switch with the top card, not a draw', () => {
  it('the switch emits no draw [TA-785 meg-110]', () => {
    const r = step(board('meg-110', [WATER], [WATER, WATER, WATER, WATER]), [use, choose('ah0')]);
    expect(r.events.filter(e => (e.kind as string) === 'draw')).toEqual([]);
    expect(r.state.players.A.hand.map(c => c.iid).sort()).toEqual(['ad0', 'ah1']);
    expect(r.state.players.A.deck[0].iid).toBe('ah0');
  });
});
