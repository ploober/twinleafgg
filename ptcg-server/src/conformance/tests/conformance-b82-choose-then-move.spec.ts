import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * B.82 (owner 2026-10-05): an attack's choice of cards IN PLAY is made first, the damage reads them where they are,
 * and they move after the damage. #1834: "The choice to remove the Special Energy card is made first, but then
 * damage is done and finally effects of the attack." #2002 (Mirage Barrage): "You first CHOOSE the energy you're
 * going to discard, then do the damage (which is reduced for Double Turbo), and THEN discard the energy."
 * The pick emits `chosen` (CF-93) and the card stays attached until the effect moves it.
 *
 * TA-609: Topaz Bolt asked its choice after the 300 (FX-0165, under the withdrawn B.76 reading).
 * TA-610: each in-play pick moved the Energy at once (Mirage Barrage, Explosion Y, Metallic Hammer).
 */

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;
type Chosen = { kind: 'chosen'; owner: string; card: string; origin: { zone: string; pokemon?: string; role?: string }; visibility: string };

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
const GRENINJA = 'twm-106';   // 310 HP, a tanky target too
function board(attacker: PokemonInPlay): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: attacker, deck: cards('ad', 6, 'sve-001'), prizes: prizes('ap', 6) }),
      B: player({ active: mon('b1', GRENINJA), bench: [mon('bb1', GRENINJA), mon('bb2', GRENINJA)], deck: cards('bd', 6, 'sve-001'), prizes: prizes('bp', 6) }),
    },
  };
}

const energyOn = (s: NeutralState) => (s.players.A.active?.energy ?? []).map(c => c.iid);
const chosen = (events: NeutralEvent[]) => (events as unknown as Chosen[]).filter(e => e.kind === 'chosen');
const legsOut = (events: NeutralEvent[]) => (events.filter(e => e.kind === 'moved') as Moved[])
  .filter(e => e.origin.zone === 'active' && e.origin.role === 'energy');
const indexOfKind = (events: NeutralEvent[], kind: string) => events.findIndex(e => e.kind === kind);

describe('B.82: an attack chooses its in-play cards first, damages, then moves them', () => {
  const attack = (name: string) => ({ actor: 'A', type: 'declareAttack', source: 'a1', name } as never);
  const discard = (card: string) => ({ actor: 'A', type: 'discard', target: card } as never);
  const choose = (target: string) => ({ actor: 'A', type: 'choose', target } as never);

  describe('Mirage Barrage twm-106 (#2002) [TA-610]', () => {
    const initial = () => board(mon('a1', GRENINJA, cards('ae', 4, 'sve-003')));

    it('the first pick leaves the Energy attached and emits chosen', () => {
      const res = step(initial(), [attack('Mirage Barrage'), discard('ae0')]);
      expect(energyOn(res.state)).toEqual(['ae0', 'ae1', 'ae2', 'ae3']);
      expect(chosen(res.events).map(e => [e.card, e.origin, e.visibility]))
        .toEqual([['ae0', { zone: 'active', pokemon: 'a1', role: 'energy' }, 'public']]);
      expect(legsOut(res.events)).toEqual([]);
    });

    it('at the target pick both chosen Energy are still attached; no damage yet', () => {
      const res = step(initial(), [attack('Mirage Barrage'), discard('ae0'), discard('ae1')]);
      expect(energyOn(res.state)).toEqual(['ae0', 'ae1', 'ae2', 'ae3']);
      expect(indexOfKind(res.events, 'damaged')).toBe(-1);
    });

    it('after the targets: 120 to each, then the two chosen Energy move to the discard pile', () => {
      const res = step(initial(), [attack('Mirage Barrage'), discard('ae0'), discard('ae1'), choose('b1'), choose('bb1')]);
      expect(energyOn(res.state)).toEqual(['ae2', 'ae3']);
      expect(res.state.players.A.discard.map(c => c.iid).sort()).toEqual(['ae0', 'ae1']);
      expect(res.state.players.B.active?.damage).toBe(120);
      const legs = legsOut(res.events);
      expect(legs.map(l => l.card).sort()).toEqual(['ae0', 'ae1']);
      expect(res.events.indexOf(legs[0])).toBeGreaterThan(indexOfKind(res.events, 'damaged'));
    });
  });

  describe('Topaz Bolt ssp-057 [TA-609]', () => {
    it('the choice opens BEFORE the 300 (no damage yet), and the chosen Energy go after it', () => {
      // Grass, Lightning, Metal x2 (Topaz Bolt costs [G][L][M]): 4 Energy, so "which 3" is a real choice.
      const initial = board(mon('a1', 'ssp-057', [{ iid: 'ag', printing: 'sve-001' }, { iid: 'al', printing: 'sve-004' },
        ...cards('am', 2, 'sve-008')]));
      const open = step(initial, [attack('Topaz Bolt')]);
      expect(open.pending?.legalActions.every(a => a.type === 'discard')).toBe(true);
      expect(indexOfKind(open.events, 'damaged')).toBe(-1);
      const res = step(initial, [attack('Topaz Bolt'), discard('ag'), discard('al'), discard('am0')]);
      expect(res.state.players.B.active?.damage).toBe(300);
      expect(energyOn(res.state)).toEqual(['am1']);
    });
  });

  describe('Metallic Hammer cri-061 (B.82: the damage counts the chosen cards while attached) [TA-610]', () => {
    it('all three chosen Metal Energy stay attached through the picks; 300; then they move', () => {
      const initial = board(mon('a1', 'cri-061', cards('ae', 4, 'sve-008')));
      const mid = step(initial, [attack('Metallic Hammer'), { actor: 'A', type: 'confirm', value: true } as never, discard('ae0'), discard('ae1')]);
      expect(energyOn(mid.state)).toEqual(['ae0', 'ae1', 'ae2', 'ae3']);
      expect(chosen(mid.events).map(e => e.card)).toEqual(['ae0', 'ae1']);
      const res = step(initial, [attack('Metallic Hammer'), { actor: 'A', type: 'confirm', value: true } as never, discard('ae0'), discard('ae1'), discard('ae2')]);
      expect(res.state.players.B.active?.damage).toBe(300);
      expect(energyOn(res.state)).toEqual(['ae3']);
    });
  });
});
