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
const DARK = 'Darkness Energy SVE';
const METAL = 'Metal Energy SVE';
const LIGHT = 'Lightning Energy SVE';
const COLOR = 'Water Energy SVE';   // pays a [C] cost
const BIGDEF = 'pfl-013';           // Mega Charizard X ex, 360 HP, Pokémon ex — survives 330 and satisfies Slaking's "opponent has ex/V" gate
const DEFENDER = 'meg-181';         // Mega Latias ex, 280 HP, NO weakness — a clean non-lethal survivor
const BENCHMON = 'Ralts SIT';       // a small Basic to fill the opponent's Bench (rider target)

const DRAGAPULT = 'Dragapult ex TWM';   // twm-130, "Phantom Dive" [R,P] 200 + 6 counters to bench
const HYDREIGON = 'Hydreigon ex SSP';   // ssp-119, "Obsidian" [P,D,M,C] 130 + 130 to 2 bench
const MILOTIC = "Cynthia's Milotic DRI"; // dri-053, "Aqua Split" [W,C] 60 + 30 to 2 bench

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

describe('WS1 batch 1a — bench-snipe / spread riders fire AFTER base damage lands', () => {

  function threeBench(): PokemonInPlay[] {
    return [pip('B-b0', BENCHMON), pip('B-b1', BENCHMON), pip('B-b2', BENCHMON)];
  }

  it('Phantom Dive: 200 lands on the Active, then 6 counters go on the Bench [twm-130 dragapult-ex]', () => {
    const res = step(
      board(
        player({ active: pip('A-act', DRAGAPULT, [{ iid: 'r', printing: FIRE }, { iid: 'p', printing: PSY }]) }),
        player({ active: pip('B-act', DEFENDER), bench: threeBench() }),
      ),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Phantom Dive' }],
    );
    expect(res.status).toBe('awaitingAction');        // paused for the counter placement
    expect(res.state.players.B.active!.damage).toBe(200);
  });

  it('Obsidian: 130 lands on the Active, then the 130-to-2-Bench spread is offered [ssp-119 hydreigon-ex]', () => {
    const res = step(
      board(
        player({ active: pip('A-act', HYDREIGON, [{ iid: 'p', printing: PSY }, { iid: 'd', printing: DARK }, { iid: 'm', printing: METAL }, { iid: 'c', printing: COLOR }]) }),
        player({ active: pip('B-act', DEFENDER), bench: threeBench() }),
      ),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Obsidian' }],
    );
    expect(res.status).toBe('awaitingAction');
    expect(res.state.players.B.active!.damage).toBe(130);
  });

  it('Aqua Split: 60 lands on the Active, then the 30-to-2-Bench spread is offered [dri-053 cynthias-milotic]', () => {
    const res = step(
      board(
        player({ active: pip('A-act', MILOTIC, [{ iid: 'w', printing: COLOR }, { iid: 'c', printing: COLOR }]) }),
        player({ active: pip('B-act', DEFENDER), bench: threeBench() }),
      ),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Aqua Split' }],
    );
    expect(res.status).toBe('awaitingAction');
    expect(res.state.players.B.active!.damage).toBe(60);
  });
});

describe('WS1 batch 1b — self-energy-discard riders fire AFTER base damage lands', () => {

  it('Ryuno Glide: 330 lands, then "discard 2 Energy" is offered [asc-152 mega-dragonite-ex]', () => {
    const res = step(
      board(
        player({ active: pip('A-act', 'asc-152', [{ iid: 'w', printing: COLOR }, { iid: 'l0', printing: LIGHT }, { iid: 'l1', printing: LIGHT }]) }),
        player({ active: pip('B-act', BIGDEF) }),
      ),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Ryuno Glide' }],
    );
    expect(res.status).toBe('awaitingAction');
    expect(res.state.players.B.active!.damage).toBe(330);
  });

  it('Great Swing: 280 lands, then "discard an Energy" is offered [ssp-147 slaking-ex]', () => {
    const res = step(
      board(
        player({ active: pip('A-act', 'Slaking ex SSP', [{ iid: 'c0', printing: COLOR }, { iid: 'c1', printing: COLOR }]) }),
        player({ active: pip('B-act', BIGDEF) }),   // an ex, so Slaking's "Born to Slack" allows the attack
      ),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Great Swing' }],
    );
    expect(res.status).toBe('awaitingAction');
    expect(res.state.players.B.active!.damage).toBe(280);
  });

  it('Disaster Shock: 190 lands, then the "may discard+Paralyze" is offered; decline keeps the 190 [asc-061 mega-eelektross-ex]', () => {
    const attacker = () => player({ active: pip('A-act', 'asc-061', [{ iid: 'l0', printing: LIGHT }, { iid: 'l1', printing: LIGHT }, { iid: 'l2', printing: LIGHT }]) });
    const offered = step(
      board(attacker(), player({ active: pip('B-act', BIGDEF) })),
      [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Disaster Shock' }],
    );
    expect(offered.status).toBe('awaitingAction');
    expect(offered.state.players.B.active!.damage).toBe(190);
    expect(offered.pending!.legalActions.some(a => a.type === 'confirm')).toBe(true);

    // Decline path (CF-33-adjacent landmine): the 190 stays, no Energy discarded, no Paralyze.
    const declined = step(
      board(attacker(), player({ active: pip('B-act', BIGDEF) })),
      [
        { actor: 'A', type: 'declareAttack', source: 'A-act', name: 'Disaster Shock' },
        { actor: 'A', type: 'confirm', value: false },
      ],
    );
    expect(declined.state.players.B.active!.damage).toBe(190);
    expect(declined.state.players.A.active!.energy.length).toBe(3);      // nothing discarded
    expect(declined.state.players.B.active!.conditions).toEqual([]);     // not Paralyzed
  });
});
