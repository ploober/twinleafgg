import { step } from '../driver';
import {
  NeutralState, NeutralAction, LegalAction, PlayerState, PlayerFlags, PokemonInPlay,
  PokemonMarkers, ConditionToken, CardRef, SCHEMA_VERSION
} from '../neutral-types';

// legalActions — the main-phase top-level menu (M5). Boards are built directly in `initialState`,
// so the menu is read with a single `step(board, [])` (or round-tripped by dispatching one entry).

const PSY = 'Psychic Energy SVE';
const WATER = 'Water Energy SVE';
const RALTS = 'Ralts SIT';        // basic; "Memory Skip" [P]; retreat [C]
const KIRLIA = 'Kirlia SIT';      // stage 1, evolves from Ralts
const ALAKAZAM = 'Radiant Alakazam SIT'; // basic; ability "Painful Spoons" (useWhenInPlay); retreat [C,C]
const ALTAR = 'Primordial Altar SIT';    // Stadium — Stadiums are reliably enumerated as playable

function markers(played = 1): PokemonMarkers {
  return { playedOnTurn: played, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(over: Partial<PlayerFlags> = {}): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0,
    vstarUsed: false, ...over,
  };
}
interface PipOpts { energy?: CardRef[]; conditions?: ConditionToken[]; damage?: number; tools?: CardRef[]; played?: number; }
function pip(iid: string, printing: string, o: PipOpts = {}): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: o.energy ?? [], tools: o.tools ?? [],
    damage: o.damage ?? 0, conditions: o.conditions ?? [], markers: markers(o.played ?? 1),
  };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState, turn = 3): NeutralState {
  const withDefaults = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: ps.prizes.length ? ps.prizes : [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }],
    // Ensure both sides have a deck so an end-of-turn boundary never decks anyone out mid-test.
    deck: ps.deck.length ? ps.deck : [{ iid: `${tag}-d`, printing: WATER }],
  });
  return {
    schemaVersion: SCHEMA_VERSION, turn, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: withDefaults(A, 'A'), B: withDefaults(B, 'B') },
  };
}

/** The active player's menu for a board with no actions applied. */
function menu(b: NeutralState): LegalAction[] {
  const res = step(b, []);
  expect(res.status).toBe('awaitingAction');
  return res.pending!.legalActions;
}
const has = (m: LegalAction[], pred: (a: LegalAction) => boolean): boolean => m.some(pred);

describe('Conformance M5 — legalActions (the main-phase menu)', () => {

  it('surfaces the active player\'s menu at a quiescent boundary; endTurn is always legal', () => {
    const res = step(board(player({ active: pip('A-act', RALTS) }), player({ active: pip('B-act', RALTS) })), []);
    expect(res.status).toBe('awaitingAction');
    expect(res.pending!.actor).toBe('A');
    expect(res.pending!.descriptor).toBe('main');
    expect(has(res.pending!.legalActions, a => a.type === 'endTurn')).toBe(true);
  });

  it('phase 1: classifies playable hand cards (energy / basic / evolution)', () => {
    const m = menu(board(
      player({
        active: pip('A-act', RALTS),
        hand: [{ iid: 'h-e', printing: PSY }, { iid: 'h-basic', printing: RALTS }, { iid: 'h-kirlia', printing: KIRLIA }],
        deck: [{ iid: 'A-d', printing: WATER }],
      }),
      player({ active: pip('B-act', RALTS) }),
    ));
    expect(has(m, a => a.type === 'attachEnergy' && a.card === 'h-e' && a.target === 'A-act')).toBe(true);
    expect(has(m, a => a.type === 'benchBasic' && a.card === 'h-basic')).toBe(true);
    expect(has(m, a => a.type === 'evolve' && a.card === 'h-kirlia' && a.target === 'A-act')).toBe(true);
  });

  it('phase 2: an attack is legal only with enough energy', () => {
    const withEnergy = menu(board(
      player({ active: pip('A-act', RALTS, { energy: [{ iid: 'e0', printing: PSY }] }) }),
      player({ active: pip('B-act', RALTS) }),
    ));
    expect(has(withEnergy, a => a.type === 'declareAttack' && a.source === 'A-act' && a.name === 'Memory Skip')).toBe(true);

    const noEnergy = menu(board(
      player({ active: pip('A-act', RALTS) }),
      player({ active: pip('B-act', RALTS) }),
    ));
    expect(has(noEnergy, a => a.type === 'declareAttack')).toBe(false);
  });

  it('phase 2: asleep/paralyzed and the first-turn rule suppress attacks', () => {
    const asleep = menu(board(
      player({ active: pip('A-act', RALTS, { energy: [{ iid: 'e0', printing: PSY }], conditions: ['asleep'] }) }),
      player({ active: pip('B-act', RALTS) }),
    ));
    expect(has(asleep, a => a.type === 'declareAttack')).toBe(false);

    const firstTurn = menu(board(
      player({ active: pip('A-act', RALTS, { energy: [{ iid: 'e0', printing: PSY }] }) }),
      player({ active: pip('B-act', RALTS) }),
      1, // turn 1 — Memory Skip is not usable on the first turn
    ));
    expect(has(firstTurn, a => a.type === 'declareAttack')).toBe(false);
  });

  it('phase 2: retreat is legal only when payable, unlocked, and there is a bench', () => {
    const ralts = (o: PipOpts) => pip('A-act', RALTS, o);
    const benchRalts = pip('A-b0', RALTS);

    // Payable: retreat [C] covered by one energy; one Pokemon on the bench.
    const ok = menu(board(
      player({ active: ralts({ energy: [{ iid: 'e0', printing: PSY }] }), bench: [benchRalts] }),
      player({ active: pip('B-act', RALTS) }),
    ));
    expect(has(ok, a => a.type === 'retreat' && a.to === 0)).toBe(true);

    const noEnergy = menu(board(
      player({ active: ralts({}), bench: [benchRalts] }),
      player({ active: pip('B-act', RALTS) }),
    ));
    expect(has(noEnergy, a => a.type === 'retreat')).toBe(false);

    const noBench = menu(board(
      player({ active: ralts({ energy: [{ iid: 'e0', printing: PSY }] }) }),
      player({ active: pip('B-act', RALTS) }),
    ));
    expect(has(noBench, a => a.type === 'retreat')).toBe(false);

    const asleep = menu(board(
      player({ active: ralts({ energy: [{ iid: 'e0', printing: PSY }], conditions: ['asleep'] }), bench: [benchRalts] }),
      player({ active: pip('B-act', RALTS) }),
    ));
    expect(has(asleep, a => a.type === 'retreat')).toBe(false);

    const alreadyRetreated = menu(board(
      player({ active: ralts({ energy: [{ iid: 'e0', printing: PSY }] }), bench: [benchRalts], flags: flags({ retreatedThisTurn: true }) }),
      player({ active: pip('B-act', RALTS) }),
    ));
    expect(has(alreadyRetreated, a => a.type === 'retreat')).toBe(false);
  });

  it('phase 2: a usable in-play ability is enumerated', () => {
    // The opponent must carry damage: Painful Spoons (move damage counters) rejects on an
    // undamaged board, and the menu dry-run probe (TA-14) only offers abilities the engine accepts.
    const m = menu(board(
      player({ active: pip('A-act', ALAKAZAM) }),
      player({ active: pip('B-act', RALTS, { damage: 20 }) }),
    ));
    expect(has(m, a => a.type === 'useAbility' && a.source === 'A-act' && a.ability === 'Painful Spoons')).toBe(true);
  });

  it('phase 2: an ability whose own preconditions fail is NOT enumerated (TA-14 probe)', () => {
    // Painful Spoons moves opponent damage counters — with nothing damaged the engine would
    // reject it, so the menu must not offer it (§10.3: legalActions must be executable).
    const m = menu(board(
      player({ active: pip('A-act', ALAKAZAM) }),
      player({ active: pip('B-act', RALTS) }),
    ));
    expect(has(m, a => a.type === 'useAbility' && a.ability === 'Painful Spoons')).toBe(false);
  });

  it('phase 2: an ability drops off the menu once used (ABILITY_USED)', () => {
    const initial = board(
      player({ active: pip('A-act', ALAKAZAM) }),
      player({
        active: pip('B-act', RALTS, { damage: 20 }),
        bench: [pip('B-b0', RALTS)],
      }),
    );
    // Use Painful Spoons: move both counters from B's active to B's bench (each transfer is a SOURCE
    // `choose` + a DESTINATION `placeCounter`, R2). Moving the full 2 (= max) auto-completes the
    // decision, so no separate stop action is needed.
    const res = step(initial, [
      { actor: 'A', type: 'useAbility', source: 'A-act', ability: 'Painful Spoons' },
      { actor: 'A', type: 'choose', target: 'B-act' },
      { actor: 'A', type: 'placeCounter', target: 'B-b0' },
      { actor: 'A', type: 'choose', target: 'B-act' },
      { actor: 'A', type: 'placeCounter', target: 'B-b0' },
    ]);
    expect(res.state.players.B.active!.damage).toBe(0);
    expect(res.state.players.B.bench[0].damage).toBe(20);
    // Still A's turn; the ability is now spent.
    expect(res.pending!.actor).toBe('A');
    expect(has(res.pending!.legalActions, a => a.type === 'useAbility' && a.ability === 'Painful Spoons')).toBe(false);
  });

  it('phase 1: a playable trainer is classified by trainerType (Stadium)', () => {
    // twinleaf's playability heuristic only marks an Item/Supporter playable when it implements
    // canPlay(); Tools and Stadiums are unconditionally playable (CAN_PLAY_TRAINER_CARD). The Stadium
    // branch is the reliable trainer-classification probe here (see impl §8).
    const m = menu(board(
      player({ active: pip('A-act', RALTS), hand: [{ iid: 'h-stadium', printing: ALTAR }] }),
      player({ active: pip('B-act', RALTS) }),
    ));
    expect(has(m, a => a.type === 'playStadium' && a.card === 'h-stadium')).toBe(true);
  });

  it('every enumerated menu action is dispatchable (executability round-trip)', () => {
    const b = board(
      player({
        active: pip('A-act', RALTS, { energy: [{ iid: 'e0', printing: PSY }] }), // exact retreat cost [C] → prompt-free
        bench: [pip('A-b0', RALTS)],
        hand: [{ iid: 'h-e', printing: PSY }, { iid: 'h-basic', printing: RALTS }, { iid: 'h-kirlia', printing: KIRLIA }, { iid: 'h-stadium', printing: ALTAR }],
        deck: [{ iid: 'A-d', printing: WATER }],
      }),
      player({ active: pip('B-act', RALTS), deck: [{ iid: 'B-d', printing: WATER }] }),
    );
    // declareAttack is excluded: Ralts' "Memory Skip" raises a ChooseAttackPrompt (out of scope here);
    // clean attack dispatch is covered by M1/M3. Every other listed action must dispatch without error.
    // A LegalAction carries no actor (the pending does), so attach it to dispatch the menu entry.
    for (const action of menu(b).filter(a => a.type !== 'declareAttack')) {
      expect(() => step(b, [{ ...action, actor: 'A' } as NeutralAction])).not.toThrow();
    }
  });

  it('produces the menu deterministically', () => {
    const make = () => board(
      player({
        active: pip('A-act', RALTS, { energy: [{ iid: 'e0', printing: PSY }] }),
        bench: [pip('A-b0', RALTS)],
        hand: [{ iid: 'h-e', printing: PSY }, { iid: 'h-kirlia', printing: KIRLIA }],
        deck: [{ iid: 'A-d', printing: WATER }],
      }),
      player({ active: pip('B-act', RALTS) }),
    );
    const a = step(make(), []);
    const b = step(make(), []);
    expect(b.pending).toEqual(a.pending);
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });
});
