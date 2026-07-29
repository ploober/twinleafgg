import { importState, ImportedGame } from '../state-adapter';
import { replay } from '../driver';
import {
  NeutralState, NeutralAction, WireLegalAction,
  PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION
} from '../neutral-types';
import { GameMessage } from '../../game/game-message';
import { PlayerType, SlotType } from '../../game/store/actions/play-card-action';
import { PutDamagePrompt } from '../../game/store/prompts/put-damage-prompt';
import { ChoosePokemonPrompt } from '../../game/store/prompts/choose-pokemon-prompt';
import { DamageMap } from '../../game/store/prompts/move-damage-prompt';

/**
 * CF-32 — the wire verb names the OPERATION applied to the chosen object, never the prompt class that
 * happens to carry the pick. twinleaf's two target pickers are both reused across unrelated effects,
 * so before this the verb was a property of the prompt TYPE and was wrong in three directions at once
 * (all three reproduced live against rotomancer on 2026-07-29):
 *
 *   - Dire Nails `por-016` — a self-switch promoting a benched Pokemon — said `choose`, because only
 *     `CHOOSE_NEW_ACTIVE_POKEMON` was recognised as a promote. CF-15 pins promotion as `promoteBench`
 *     regardless of trigger.
 *   - Oil Salvo `dri-023` — *"Choose 1 of your opponent's Pokemon 6 times … do 20 damage to it"* —
 *     said `placeCounter`, because `PutDamagePrompt` hardcoded that verb. It deals damage; there is no
 *     typed damage verb, so a bare `choose{target}` is the contract shape.
 *   - Phantasmal Barrage `asc-098` — *"place 12 damage counters on 1 of your opponent's Pokemon"* —
 *     said `choose`, because that family rides `ChoosePokemonPrompt` and the adapter had no way to
 *     learn the operation. rotomancer migrated this family to `placeCounter` the same day, which is
 *     what exposed the twinleaf-side mirror.
 *
 * Signals, and why each is the one it is: promotion is readable off the prompt (message +
 * BENCH-restricted slots), but counter-placement is NOT — `CHOOSE_POKEMON_TO_DAMAGE` carries BOTH
 * "put N damage counters on it" and "do N damage to it", so the operation is declared by the card via
 * `options.operation`. These specs pin the mapping in both directions, including the carve-outs that
 * make it non-trivial: a `CHOOSE_POKEMON_TO_SWITCH` that is NOT a promotion, and a damage pick that is
 * NOT counter placement.
 */

const WATER = 'Water Energy SVE';
const RALTS = 'Ralts SIT';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}
function ralts(iid: string): PokemonInPlay {
  return { stack: [{ iid, printing: RALTS }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(): NeutralState {
  const withPrize = (ps: PlayerState, tag: string): PlayerState =>
    ({ ...ps, prizes: [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }] });
  // Two candidates on EACH side, so no pick is a forced single (CF-14 would collapse it and the verb
  // would never reach the wire at all).
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: withPrize(player({ active: ralts('A-act'), bench: [ralts('A-b0'), ralts('A-b1')] }), 'A'),
      B: withPrize(player({ active: ralts('B-act'), bench: [ralts('B-b0'), ralts('B-b1')] }), 'B'),
    },
  };
}

function menu(game: ImportedGame, actions: NeutralAction[] = []): WireLegalAction[] {
  const pending = replay(game, actions).pending;
  if (pending === null) {
    throw new Error('no pending decision surfaced');
  }
  return pending.legalActions;
}
/**
 * The distinct action types the menu offers. Every prompt these specs open is a fixed-count pick, so
 * no CF-4 stop is advertised and the list is the pick verb alone.
 */
function verbs(game: ImportedGame, actions: NeutralAction[] = []): string[] {
  return Array.from(new Set(menu(game, actions).map(a => a.type))).sort();
}
/**
 * How many target picks the prompt still offers after `actions`. Once the prompt is satisfied the
 * driver hands back the ordinary main-phase menu rather than `null`, so "the prompt is done" has to be
 * read as "it no longer offers `verb`", not as an absent pending.
 */
function picksLeft(game: ImportedGame, verb: string, actions: NeutralAction[]): number {
  return menu(game, actions).filter(a => a.type === verb).length;
}
function targetsOf(game: ImportedGame, type: string): string[] {
  return menu(game)
    .filter((a): a is Extract<WireLegalAction, { target: string }> => a.type === type && 'target' in a)
    .map(a => a.target);
}

function openChoosePokemon(
  game: ImportedGame, message: GameMessage, playerType: PlayerType, slots: SlotType[],
  options: Record<string, unknown> = {},
): void {
  const p = game.state.players[0];
  game.store.prompt(game.state, new ChoosePokemonPrompt(
    p.id, message, playerType, slots, { min: 1, max: 1, allowCancel: false, ...options },
  ), () => { /* result unused: these specs assert the MENU */ });
}

function bothOpposing(): DamageMap[] {
  return [
    { target: { player: PlayerType.TOP_PLAYER, slot: SlotType.ACTIVE, index: 0 }, damage: 9999 },
    { target: { player: PlayerType.TOP_PLAYER, slot: SlotType.BENCH, index: 0 }, damage: 9999 },
  ];
}
function openPutDamage(game: ImportedGame, damage: number, options: Record<string, unknown> = {}): void {
  const p = game.state.players[0];
  game.store.prompt(game.state, new PutDamagePrompt(
    p.id, GameMessage.CHOOSE_POKEMON_TO_DAMAGE, PlayerType.TOP_PLAYER,
    [SlotType.ACTIVE, SlotType.BENCH], damage, bothOpposing(), { allowCancel: false, ...options },
  ), () => { /* result unused */ });
}

describe('CF-32 — ChoosePokemonPrompt names the operation, not the prompt type', () => {

  it('post-KO replacement is promoteBench (unchanged control)', () => {
    const game = importState(board());
    openChoosePokemon(game, GameMessage.CHOOSE_NEW_ACTIVE_POKEMON, PlayerType.BOTTOM_PLAYER, [SlotType.BENCH]);
    expect(verbs(game)).toEqual(['promoteBench']);
  });

  it('a BENCH-restricted switch is promoteBench (regression: Dire Nails por-016 said choose)', () => {
    const game = importState(board());
    openChoosePokemon(game, GameMessage.CHOOSE_POKEMON_TO_SWITCH, PlayerType.BOTTOM_PLAYER, [SlotType.BENCH]);
    expect(verbs(game)).toEqual(['promoteBench']);
    expect(targetsOf(game, 'promoteBench').sort()).toEqual(['A-b0', 'A-b1']);
  });

  it("a gust promotes the OPPONENT's bench, and is the same verb (CF-15: regardless of trigger)", () => {
    const game = importState(board());
    openChoosePokemon(game, GameMessage.CHOOSE_POKEMON_TO_SWITCH, PlayerType.TOP_PLAYER, [SlotType.BENCH]);
    expect(verbs(game)).toEqual(['promoteBench']);
    expect(targetsOf(game, 'promoteBench').sort()).toEqual(['B-b0', 'B-b1']);
  });

  it('an ACTIVE+BENCH switch is NOT a promotion and stays a generic choose', () => {
    // Ninja Boy / Swoop Teleporter / Transformation Tome swap a Pokemon for one from the deck or hand.
    // Nothing is promoted, so the BENCH-slot guard on the promote rule is load-bearing.
    const game = importState(board());
    openChoosePokemon(game, GameMessage.CHOOSE_POKEMON_TO_SWITCH, PlayerType.BOTTOM_PLAYER,
      [SlotType.ACTIVE, SlotType.BENCH]);
    expect(verbs(game)).toEqual(['choose']);
  });

  it('a declared counter placement is placeCounter (regression: Phantasmal Barrage asc-098 said choose)', () => {
    const game = importState(board());
    openChoosePokemon(game, GameMessage.CHOOSE_POKEMON_TO_DAMAGE, PlayerType.TOP_PLAYER,
      [SlotType.ACTIVE, SlotType.BENCH], { operation: 'placeCounters' });
    expect(verbs(game)).toEqual(['placeCounter']);
    expect(targetsOf(game, 'placeCounter').sort()).toEqual(['B-act', 'B-b0', 'B-b1']);
  });


  it('an UNdeclared CHOOSE_POKEMON_TO_DAMAGE pick stays a generic choose — the control cell', () => {
    // The same message carries both families; without a declaration this is a damage pick, for which
    // the vocabulary has no typed verb. If this ever flipped, every "do N damage to it" card would be
    // mislabelled as counter placement.
    const game = importState(board());
    openChoosePokemon(game, GameMessage.CHOOSE_POKEMON_TO_DAMAGE, PlayerType.TOP_PLAYER,
      [SlotType.ACTIVE, SlotType.BENCH]);
    expect(verbs(game)).toEqual(['choose']);
  });

  it('picks with no typed verb in the vocabulary stay choose (heal, attach, evolve, pick-up)', () => {
    for (const message of [
      GameMessage.CHOOSE_POKEMON_TO_HEAL, GameMessage.CHOOSE_POKEMON_TO_ATTACH_CARDS,
      GameMessage.CHOOSE_POKEMON_TO_EVOLVE, GameMessage.CHOOSE_POKEMON_TO_PICK_UP,
    ]) {
      const game = importState(board());
      openChoosePokemon(game, message, PlayerType.BOTTOM_PLAYER, [SlotType.ACTIVE, SlotType.BENCH]);
      expect(verbs(game)).toEqual(['choose']);
    }
  });
});

describe('CF-32 — PutDamagePrompt distinguishes counter placement from dealing damage', () => {

  it('the default use is counter placement, in units of one counter', () => {
    const game = importState(board());
    openPutDamage(game, 30);
    expect(verbs(game)).toEqual(['placeCounter']);

    // 30 HP at 10 HP per pick = exactly 3 picks. The cap is on B-b0 alone (B-act stays uncapped) so
    // the count, not a per-target limit, is what runs the prompt out.
    const pick = { actor: 'A', type: 'placeCounter', target: 'B-act' } as unknown as NeutralAction;
    for (let taken = 0; taken < 3; taken++) {
      const g = importState(board());
      openPutDamage(g, 30);
      expect(picksLeft(g, 'placeCounter', Array(taken).fill(pick))).toBeGreaterThan(0);
    }
    const done = importState(board());
    openPutDamage(done, 30);
    expect(picksLeft(done, 'placeCounter', Array(3).fill(pick))).toBe(0);
  });

  it('a declared damage deal is a generic choose (regression: Oil Salvo dri-023 said placeCounter)', () => {
    const game = importState(board());
    openPutDamage(game, 120, { damageMultiple: 20, operation: 'dealDamage' });
    expect(verbs(game)).toEqual(['choose']);
    expect(targetsOf(game, 'choose').sort()).toEqual(['B-act', 'B-b0']);
  });

  it('damageMultiple is the pick unit — Oil Salvo asks 6 times, not 12', () => {
    // The card says "Choose 1 of your opponent's Pokemon 6 times … do 20 damage to it". Enumerating in
    // 10s asked twice as often AND let a target end up on 10/30/50 — totals the card cannot produce.
    // `PutDamagePrompt.validate()` only checks the SUM, so nothing downstream would have caught it.
    const pick = { actor: 'A', type: 'choose', target: 'B-act' } as unknown as NeutralAction;
    for (let taken = 0; taken < 6; taken++) {
      const game = importState(board());
      openPutDamage(game, 120, { damageMultiple: 20, operation: 'dealDamage' });
      expect(picksLeft(game, 'choose', Array(taken).fill(pick))).toBeGreaterThan(0);
    }
    const game = importState(board());
    openPutDamage(game, 120, { damageMultiple: 20, operation: 'dealDamage' });
    expect(picksLeft(game, 'choose', Array(6).fill(pick))).toBe(0);
  });

  it('a target already at its cap drops out in units of damageMultiple', () => {
    const game = importState(board());
    const p = game.state.players[0];
    game.store.prompt(game.state, new PutDamagePrompt(
      p.id, GameMessage.CHOOSE_POKEMON_TO_DAMAGE, PlayerType.TOP_PLAYER,
      [SlotType.ACTIVE, SlotType.BENCH], 120,
      [
        { target: { player: PlayerType.TOP_PLAYER, slot: SlotType.ACTIVE, index: 0 }, damage: 20 },
        { target: { player: PlayerType.TOP_PLAYER, slot: SlotType.BENCH, index: 0 }, damage: 9999 },
      ],
      { allowCancel: false, damageMultiple: 20, operation: 'dealDamage' },
    ), () => { /* result unused */ });

    const pick = { actor: 'A', type: 'choose', target: 'B-act' } as unknown as NeutralAction;
    // One 20-HP pick fills the Active's cap exactly; it must not be offered a second time.
    expect(menu(game, [pick]).map(a => 'target' in a ? a.target : null)).toEqual(['B-b0']);
  });
});
