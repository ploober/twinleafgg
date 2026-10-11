import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * B.82 / B.89 (1) (#1834, #2002): during an attack that does damage, a choice of the attacker's own in-play cards
 * (which Energy to discard or return to the hand) is made at Step D, BEFORE the damage; the cards move after it
 * (Step F). The adapter records the picks as `chosen` and leaves them attached until the move. "For each ... in this
 * way" damage counts the chosen set.
 *
 * Audit 2 (static, E1 / E3 gap shapes): a 'Choose cards' prompt over the attacker's own Energy was never marked
 * deferredMove (Screw Knuckle); CardsToHandEffect moved at once whatever inChosenCallback said (Ninja Spinner); a
 * marked DiscardEnergyPrompt whose callback did a raw `moveCardTo` discarded at the pick (Inferno X, Spill the Tea).
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
function mon(iid: string, printing: string, energy: string = ''): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: energy.split('').filter(t => t !== '').map((t, i) => ({ iid: `${iid}e${i}`, printing: E[t] })),
    tools: [], damage: 0, conditions: [], markers: markers(),
  };
}
function cards(tag: string, ps: string[]): CardRef[] {
  return ps.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, Array(n).fill(E.M)).map(c => ({ ...c, faceUp: false }));
}

const DEFENDER = 'twm-106';   // Greninja ex, 310 HP: survives every attack below

function board(attacker: string, energy: string): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing',
    stadium: null,
    players: {
      A: player({
        active: mon('a1', attacker, energy), bench: [mon('ab1', 'asc-004'), mon('ab2', 'asc-004')],
        hand: cards('ah', [E.G]), deck: cards('ad', [E.R, E.R, E.G, E.W, E.P, E.L, E.F, E.D, E.M, E.M]),
        prizes: prizes('ap', 3),
      }),
      B: player({
        active: mon('b1', DEFENDER, 'WW'), bench: [mon('bb1', 'asc-004'), mon('bb2', 'asc-004')],
        hand: cards('bh', [E.G]), deck: cards('bd', Array(10).fill(E.G)), prizes: prizes('bp', 3),
      }),
    },
  } as NeutralState;
}

const A = (o: Record<string, unknown>) => ({ actor: 'A', ...o } as never);
const declare = (name: string) => A({ type: 'declareAttack', source: 'a1', name });
const pick = (target: string) => A({ type: 'choose', target });
const disc = (target: string) => A({ type: 'discard', owner: 'A', target });
const stop = A({ type: 'confirm', value: false });
const yes = A({ type: 'confirm', value: true });

/** The attack's own events: from `attackUsed` up to the end of the turn. */
function attackEvents(events: NeutralEvent[]): NeutralEvent[] {
  const i = events.findIndex(e => e.kind === 'attackUsed');
  const j = events.findIndex(e => e.kind === 'turnEnded');
  return events.slice(i + 1, j < 0 ? undefined : j);
}
const kinds = (events: NeutralEvent[]) => events.map(e => e.kind);
const chosenCards = (events: NeutralEvent[]) =>
  events.filter(e => e.kind === 'chosen').map(e => (e as { card?: string }).card);
const idx = (events: NeutralEvent[], kind: string) => events.findIndex(e => e.kind === kind);
const energyOn = (s: NeutralState) => (s.players.A.active?.energy ?? []).map(c => c.iid);

describe('Audit 2 / B.82: an attacker\'s own-Energy choice is chosen before the damage and moves after it', () => {
  describe('Landorus por-041 Screw Knuckle [120]: "Put an Energy attached to this Pokémon into your hand."', () => {
    it('por-041 Screw Knuckle: three Energy attached, the pick is open and nothing has moved [TA-686]', () => {
      const r = step(board('por-041', 'FFF'), [declare('Screw Knuckle')]);
      expect(r.pending?.legalActions.every(a => a.type === 'choose')).toBe(true);
      expect(energyOn(r.state)).toEqual(['a1e0', 'a1e1', 'a1e2']);
      expect(kinds(attackEvents(r.events))).toEqual([]);
    });

    it('por-041 Screw Knuckle: chosen, then the 120, then the Energy to the hand [TA-686]', () => {
      const r = step(board('por-041', 'FFF'), [declare('Screw Knuckle'), pick('a1e0')]);
      const ev = attackEvents(r.events);
      expect(chosenCards(ev)).toEqual(['a1e0']);
      expect(r.state.players.B.active?.damage).toBe(120);
      expect(idx(ev, 'chosen')).toBeLessThan(idx(ev, 'damaged'));
      expect(idx(ev, 'damaged')).toBeLessThan(idx(ev, 'moved'));
      expect(r.state.players.A.hand.map(c => c.iid)).toContain('a1e0');
      expect(energyOn(r.state)).toEqual(['a1e1', 'a1e2']);
    });
  });

  describe('Mega Greninja ex cri-022 Ninja Spinner [120+]: "You may put a [W] Energy attached to this Pokémon into your hand and have this attack do 80 more damage."', () => {
    it('cri-022 Ninja Spinner: accept, chosen, then the 200, then the Energy to the hand [TA-687]', () => {
      const r = step(board('cri-022', 'WWW'), [declare('Ninja Spinner'), yes, pick('a1e0')]);
      const ev = attackEvents(r.events);
      expect(chosenCards(ev)).toEqual(['a1e0']);
      expect(r.state.players.B.active?.damage).toBe(200);
      expect(idx(ev, 'chosen')).toBeLessThan(idx(ev, 'damaged'));
      expect(idx(ev, 'damaged')).toBeLessThan(idx(ev, 'moved'));
      expect(r.state.players.A.hand.map(c => c.iid)).toContain('a1e0');
      expect(energyOn(r.state)).toEqual(['a1e1', 'a1e2']);
    });
  });

  describe('Mega Charizard X ex pfl-013 Inferno X [90×]: "Discard any amount of [R] Energy from among your Pokémon, and this attack does 90 damage for each card you discarded in this way."', () => {
    it('pfl-013 Inferno X: the first pick leaves the Energy attached, chosen, no damage yet [TA-688]', () => {
      const r = step(board('pfl-013', 'RRR'), [declare('Inferno X'), disc('a1e0')]);
      expect(energyOn(r.state)).toEqual(['a1e0', 'a1e1', 'a1e2']);
      expect(chosenCards(r.events)).toEqual(['a1e0']);
      expect(r.events.filter(e => e.kind === 'moved')).toEqual([]);
      expect(idx(r.events, 'damaged')).toBe(-1);
    });

    it('pfl-013 Inferno X: chosen x2, the 180, then both to the discard pile [TA-688]', () => {
      const r = step(board('pfl-013', 'RRR'), [declare('Inferno X'), disc('a1e0'), disc('a1e1'), stop]);
      const ev = attackEvents(r.events);
      expect(chosenCards(ev)).toEqual(['a1e0', 'a1e1']);
      expect(r.state.players.B.active?.damage).toBe(180);
      expect(idx(ev, 'damaged')).toBeLessThan(idx(ev, 'moved'));
      expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['a1e0', 'a1e1']);
      expect(energyOn(r.state)).toEqual(['a1e2']);
    });
  });

  describe('Sinistcha twm-022 Spill the Tea [70×]: "Discard up to 3 [G] Energy cards from your Pokémon. This attack does 70 damage for each card you discarded in this way."', () => {
    it('twm-022 Spill the Tea: the first pick leaves the Energy attached, chosen, no damage yet [TA-688]', () => {
      const r = step(board('twm-022', 'GGG'), [declare('Spill the Tea'), disc('a1e0')]);
      expect(energyOn(r.state)).toEqual(['a1e0', 'a1e1', 'a1e2']);
      expect(chosenCards(r.events)).toEqual(['a1e0']);
      expect(r.events.filter(e => e.kind === 'moved')).toEqual([]);
      expect(idx(r.events, 'damaged')).toBe(-1);
    });

    it('twm-022 Spill the Tea: chosen x2, the 140, then both to the discard pile [TA-688]', () => {
      const r = step(board('twm-022', 'GGG'), [declare('Spill the Tea'), disc('a1e0'), disc('a1e1'), stop]);
      const ev = attackEvents(r.events);
      expect(chosenCards(ev)).toEqual(['a1e0', 'a1e1']);
      expect(r.state.players.B.active?.damage).toBe(140);
      expect(idx(ev, 'damaged')).toBeLessThan(idx(ev, 'moved'));
      expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['a1e0', 'a1e1']);
      expect(energyOn(r.state)).toEqual(['a1e2']);
    });
  });
});
