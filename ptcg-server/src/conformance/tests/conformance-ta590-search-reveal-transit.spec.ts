import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, Location,
  SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-590 residual (B.80 §5 / §8, B.34 as amended by B.80 and B.81): a search pick is lifted into transit at the
 * pick, `owner`, and stays there until the text's reveal and placement. A search whose decision stays open after a
 * pick (an "up to 2" search, an Item-and-a-Tool search) pauses with the pick in transit; when a later action
 * completes it, the pile is revealed FROM transit and the picked card goes transit -> hand.
 *
 * The step() fix-up projected the pick in transit at the pause, but a replay that ran on through the completing
 * action never emitted that pause's leg: the full trace said deck -> hand and the reveal read the engine's deck
 * (where the card still sits until the prompt resolves). Rotomancer: deck -> transit (owner), reveal from: transit,
 * transit -> hand (public). A search completed by the same action that made its only pick never pauses in
 * transit: both engines say deck -> hand and from: deck (the control below).
 *
 * Mutation guards: drop the mid-decision lift in driver.ts (`liftPausedSearchPicks`) and the [TA-590] cells red
 * (six of them, measured on c6ea52669); the rejection cell now pins the
 * applied prefix's response (TA-639), so it reds if a rejection at the pause drops the pick's lift or its board.
 */

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;
type Reveal = { kind: 'reveal'; owner: string; cards: string[]; from: string; to: string };

const BELLSPROUT = 'asc-004';
const FIRE = 'sve-002';
const WATER = 'sve-003';
// Gimmighoul ssp-097 Minor Errand-Running: "Search your deck for up to 2 Basic Energy cards, reveal them, and put
// them into your hand. Then, shuffle your deck."
const GIMMIGHOUL = 'ssp-097';
// Chien-Pao ex pal-061 Shivery Chill: "Once during your turn, if this Pokémon is in the Active Spot, you may search
// your deck for up to 2 Basic [W] Energy cards, reveal them, and put them into your hand. Then, shuffle your deck."
const CHIEN_PAO = 'pal-061';
// Earthen Vessel par-163: "You can use this card only if you discard another card from your hand. Search your deck
// for up to 2 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck."
const EARTHEN_VESSEL = 'par-163';
// Arven svi-166: "Search your deck for an Item card and a Pokémon Tool card, reveal them, and put them into your
// hand. Then, shuffle your deck."
const ARVEN = 'svi-166';
const ULTRA_BALL = 'meg-131';
const AIR_BALLOON = 'asc-181';
// Energy Search por-072: "Search your deck for a Basic Energy card, reveal it, and put it into your hand. Then,
// shuffle your deck."
const ENERGY_SEARCH = 'por-072';

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
function cards(tag: string, n: number, printing = FIRE, from = 1): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i + from}`, printing }));
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
function opponent(): PlayerState {
  return player({ active: basic('b1'), deck: cards('bd', 6), prizes: prizes('bp', 3) });
}

function moved(events: NeutralEvent[]): Moved[] {
  return events.filter((e): e is Moved => e.kind === 'moved');
}
function reveals(events: NeutralEvent[]): Reveal[] {
  return events.filter(e => e.kind === 'reveal') as unknown as Reveal[];
}
function legs(events: NeutralEvent[], iid: string): string[] {
  return moved(events).filter(e => e.card === iid).map(e => `${e.origin.zone}>${e.destination.zone}:${e.visibility}`);
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
  for (const [iid, p] of places(res.state)) {
    if (at.get(iid) !== p) { problems.push(`${iid}: legs end at ${at.get(iid)} but the board shows ${p}`); }
  }
  return problems;
}

const A = 'A';
const choose = (target: string) => ({ actor: A, type: 'choose', target } as never);
const stop = { actor: A, type: 'confirm', value: false } as never;

describe('TA-590: a search pick paused in transit is revealed from transit (Gimmighoul ssp-097)', () => {
  const board = () => game(
    player({ active: basic('a1', GIMMIGHOUL, [{ iid: 'ae1', printing: WATER }]), bench: [basic('ab1')],
      hand: [{ iid: 'ah1', printing: FIRE }], deck: cards('ad', 12), prizes: prizes('ap', 6) }),
    opponent());
  const ATTACK = { actor: A, type: 'declareAttack', source: 'a1', name: 'Minor Errand-Running' } as never;

  it('at the pick the Energy is in transit {deck, owner} and its leg says so (unchanged) [TA-590 ssp-097]', () => {
    const initial = board();
    const res = step(initial, [ATTACK, choose('ad1')]);
    expect(res.state.players.A.transit).toEqual([{ iid: 'ad1', printing: FIRE, origin: { zone: 'deck' }, visibility: 'owner' }]);
    expect(legs(res.events, 'ad1')).toEqual(['deck>transit:owner']);
    expect(replays(initial, res)).toEqual([]);
  });

  it('one pick then stop: deck -> transit (owner), revealed FROM transit, transit -> hand (public) [TA-590 ssp-097]', () => {
    const initial = board();
    const res = step(initial, [ATTACK, choose('ad1'), stop]);
    expect(legs(res.events, 'ad1')).toEqual(['deck>transit:owner', 'transit>hand:public']);
    expect(reveals(res.events).map(r => [r.owner, r.from, r.cards])).toEqual([['A', 'transit', ['ad1']]]);
    expect(res.state.players.A.transit ?? []).toEqual([]);
    expect(replays(initial, res)).toEqual([]);
  });

  it('two picks: the pile is revealed from transit; the first pick went through transit, the last did not pause [TA-590 ssp-097]', () => {
    const initial = board();
    const res = step(initial, [ATTACK, choose('ad1'), choose('ad2')]);
    expect(reveals(res.events).map(r => [r.from, r.cards])).toEqual([['transit', ['ad1', 'ad2']]]);
    expect(legs(res.events, 'ad1')).toEqual(['deck>transit:owner', 'transit>hand:public']);
    expect(legs(res.events, 'ad2')).toEqual(['deck>hand:public']);
    expect(replays(initial, res)).toEqual([]);
  });

  // TA-639 (2026-10-06) supersedes this cell's earlier "pre-pick board, no lift": a rejection reports `applied` = the
  // prefix, so its board and trace are that prefix's response (the pick in transit, its lift leg), as rotomancer answers
  // (driven on :8099 2026-10-06: invalidAction applied 2, transit [ad1], moved ad1 deck -> transit).
  it('a rejected action after the pick: the board and trace are the pick pause\'s (TA-639) and still replay [TA-590 ssp-097]', () => {
    const initial = board();
    const atPick = step(initial, [ATTACK, choose('ad1')]);
    const res = step(initial, [ATTACK, choose('ad1'), { actor: A, type: 'endTurn' } as never]);
    expect(res.status).toBe('invalidAction');
    expect(legs(res.events, 'ad1')).toEqual(['deck>transit:owner']);
    expect(res.state).toEqual(atPick.state);
    expect(replays(initial, res)).toEqual([]);
  });

  it('the trace at the pick pause is a prefix of the trace after the stop (per-pick event truth, B.81 §6) [TA-590 ssp-097]', () => {
    const initial = board();
    const atPick = step(initial, [ATTACK, choose('ad1')]).events;
    const after = step(initial, [ATTACK, choose('ad1'), stop]).events;
    expect(after.slice(0, atPick.length)).toEqual(atPick);
  });
});

describe('TA-590: the same shape on an Ability, an Item with a cost and a two-kind Supporter search', () => {
  it('Chien-Pao ex pal-061 Shivery Chill: one pick then stop reads from transit [TA-590 pal-061]', () => {
    const initial = game(
      player({ active: basic('a1', CHIEN_PAO), hand: [{ iid: 'ah1', printing: FIRE }], deck: cards('ad', 8, WATER), prizes: prizes('ap', 6) }),
      opponent());
    const res = step(initial, [{ actor: A, type: 'useAbility', source: 'a1', ability: 'Shivery Chill' } as never, choose('ad1'), stop]);
    expect(reveals(res.events).map(r => [r.from, r.cards])).toEqual([['transit', ['ad1']]]);
    expect(legs(res.events, 'ad1')).toEqual(['deck>transit:owner', 'transit>hand:public']);
    expect(replays(initial, res)).toEqual([]);
  });

  it('Earthen Vessel par-163: the cost discard is placed at once; the searched Energy goes through transit [TA-590 par-163]', () => {
    const initial = game(
      player({ active: basic('a1'), hand: [{ iid: 'ev', printing: EARTHEN_VESSEL }, { iid: 'ah1', printing: FIRE }, { iid: 'ah2', printing: FIRE }],
        deck: cards('ad', 8), prizes: prizes('ap', 6) }),
      opponent());
    const res = step(initial, [{ actor: A, type: 'playItem', card: 'ev' } as never,
      { actor: A, type: 'discard', owner: A, target: 'ah1' } as never, choose('ad1'), stop]);
    expect(legs(res.events, 'ah1')).toEqual(['hand>discardPile:public']);
    expect(reveals(res.events).map(r => [r.from, r.cards])).toEqual([['transit', ['ad1']]]);
    expect(legs(res.events, 'ad1')).toEqual(['deck>transit:owner', 'transit>hand:public']);
    expect(replays(initial, res)).toEqual([]);
  });

  it('Arven svi-166: the Item picked first is in transit at the Tool pick; the pair is revealed from transit [TA-590 svi-166]', () => {
    const initial = game(
      player({ active: basic('a1'), hand: [{ iid: 'arv', printing: ARVEN }, { iid: 'ah1', printing: FIRE }],
        deck: [{ iid: 'it1', printing: ULTRA_BALL }, { iid: 'tl1', printing: AIR_BALLOON }, { iid: 'it2', printing: ULTRA_BALL },
          { iid: 'tl2', printing: AIR_BALLOON }, ...cards('ad', 5)], prizes: prizes('ap', 6) }),
      opponent());
    const res = step(initial, [{ actor: A, type: 'playSupporter', card: 'arv' } as never, choose('it1'), choose('tl1')]);
    expect(reveals(res.events).map(r => [r.from, r.cards])).toEqual([['transit', ['it1', 'tl1']]]);
    expect(legs(res.events, 'it1')).toEqual(['deck>transit:owner', 'transit>hand:public']);
    expect(legs(res.events, 'tl1')).toEqual(['deck>hand:public']);
    expect(replays(initial, res)).toEqual([]);
  });
});

describe('TA-590 control: a search completed by its only pick never pauses in transit', () => {
  it('Energy Search por-072: deck -> hand, revealed from the deck (both engines agree) [TA-590 control por-072]', () => {
    const initial = game(
      player({ active: basic('a1'), hand: [{ iid: 'es', printing: ENERGY_SEARCH }], deck: [...cards('ad', 4, BELLSPROUT), { iid: 'e1', printing: FIRE }],
        prizes: prizes('ap', 6) }),
      opponent());
    const res = step(initial, [{ actor: A, type: 'playItem', card: 'es' } as never, choose('e1')]);
    expect(reveals(res.events).map(r => [r.from, r.cards])).toEqual([['deck', ['e1']]]);
    expect(legs(res.events, 'e1')).toEqual(['deck>hand:public']);
    expect(replays(initial, res)).toEqual([]);
  });
});
