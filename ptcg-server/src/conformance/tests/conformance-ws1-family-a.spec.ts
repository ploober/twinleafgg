import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION
} from '../neutral-types';

// WS1 — family A: a post-damage rider written into the BEFORE-damage block (`WAS_ATTACK_USED`), so
// twinleaf pauses at the rider with dmg=0 while rotomancer has already applied base damage (rulebook
// step F: damage -> after-damage effects). Fix = migrate the rider to `AFTER_ATTACK`.
//
// Each `it` asserts the CONJUNCTION the family demands: the base damage has LANDED **and** the rider
// still runs (its prompt is pending). A fix that satisfies one clause while breaking the other is
// exactly what the spike's TA-79 fix did, so a single-clause test is not enough. RED before the
// migration (damage=0 at the rider pending), GREEN after (damage applied, rider still pending).
//
//   Batch 1c — draw riders ("you may draw …"): Corkscrew Dive, Return, Zircon Road

const FIGHT = 'Fighting Energy SVE';
const GRASS = 'Grass Energy SVE';
const FIRE = 'Fire Energy SVE';
const PSY = 'Psychic Energy SVE';
const COLOR = 'Water Energy SVE';   // pays a [C] cost
const DEFENDER = 'meg-181';         // Mega Latias ex, 280 HP, NO weakness — a clean non-lethal survivor

const GARCHOMP = "Cynthia's Garchomp ex DRI";  // dri-104, "Corkscrew Dive" [F] 100, draw until 6
const BLISSEY = 'Blissey ex TWM';              // twm-134, "Return" [C,C,C] 180, draw until 6
const CYCLIZAR = 'Cyclizar ex SSP';            // ssp-159, "Zircon Road" [G,R,P] 180, may draw 5

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}
function pip(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function deckOf(n: number, prefix: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${prefix}${i}`, printing: COLOR }));
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  const withDefaults = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: ps.prizes.length ? ps.prizes : [{ iid: `${tag}-pz`, printing: COLOR, faceUp: false }],
    deck: ps.deck.length ? ps.deck : [{ iid: `${tag}-d`, printing: COLOR }],
  });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: withDefaults(A, 'A'), B: withDefaults(B, 'B') },
  };
}

describe('WS1 batch 1c — draw riders fire AFTER damage lands', () => {

  it('Corkscrew Dive: 100 lands, then "draw until 6" is offered [dri-104 cynthias-garchomp-ex]', () => {
    const res = step(
      board(
        player({ active: pip('A-act', GARCHOMP, [{ iid: 'f0', printing: FIGHT }]), deck: deckOf(10, 'A-d') }),
        player({ active: pip('B-act', DEFENDER) }),
      ),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Corkscrew Dive' }],
    );
    expect(res.status).toBe('awaitingAction');
    expect(res.pending!.legalActions.some(a => a.type === 'confirm')).toBe(true);   // draw offered
    expect(res.state.players.B.active!.damage).toBe(100);                            // damage already landed
  });

  it('Return: 180 lands, then "draw until 6" is offered [twm-134 blissey-ex]', () => {
    const res = step(
      board(
        player({ active: pip('A-act', BLISSEY, [{ iid: 'c0', printing: COLOR }, { iid: 'c1', printing: COLOR }, { iid: 'c2', printing: COLOR }]), deck: deckOf(10, 'A-d') }),
        player({ active: pip('B-act', DEFENDER) }),
      ),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Return' }],
    );
    expect(res.status).toBe('awaitingAction');
    expect(res.pending!.legalActions.some(a => a.type === 'confirm')).toBe(true);
    expect(res.state.players.B.active!.damage).toBe(180);
  });

  it('Zircon Road: 180 lands, then "may draw 5" is offered [ssp-159 cyclizar-ex]', () => {
    const res = step(
      board(
        player({ active: pip('A-act', CYCLIZAR, [{ iid: 'g0', printing: GRASS }, { iid: 'r0', printing: FIRE }, { iid: 'p0', printing: PSY }]), deck: deckOf(10, 'A-d') }),
        player({ active: pip('B-act', DEFENDER) }),
      ),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Zircon Road' }],
    );
    expect(res.status).toBe('awaitingAction');
    expect(res.pending!.legalActions.some(a => a.type === 'confirm')).toBe(true);
    expect(res.state.players.B.active!.damage).toBe(180);
  });
});
