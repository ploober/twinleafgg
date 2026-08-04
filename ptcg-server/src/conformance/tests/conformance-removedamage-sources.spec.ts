import { importState, ImportedGame } from '../state-adapter';
import { replay } from '../driver';
import {
  NeutralState, WireLegalAction,
  PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION
} from '../neutral-types';
import { GameMessage } from '../../game/game-message';
import { PlayerType, SlotType, CardTarget } from '../../game/store/actions/play-card-action';
import { RemoveDamagePrompt } from '../../game/store/prompts/remove-damage-prompt';
import { DamageMap } from '../../game/store/prompts/move-damage-prompt';

/**
 * TA-203: `RemoveDamagePrompt` decomposition offered UNDAMAGED Pokemon as damage-counter SOURCES.
 *
 * `remove-damage` enumerated sources from `prompt.maxAllowedDamage`, treating `entry.damage` as the
 * movable budget. That field is a per-target DESTINATION cap — how much damage a target may end up
 * carrying — and `RemoveDamagePrompt.validate()` never reads it at all. The card-side convention is
 * unambiguous across the 25 `MoveDamagePrompt` users: `card.hp`, `card.hp + 40`, `card.hp + 70`, a
 * flat `9999`/`180`. Capacities, not counter counts.
 *
 * This is a straight mirror of TA-124, which fixed the identical misread in `move-damage` — the
 * decomposer this one was explicitly written to match. The sibling `put-damage` records the same
 * misread being corrected in `conformance-putdamage-slots.spec.ts`. Three decomposers, one field,
 * the same wrong reading; `remove-damage` was the one that never got the correction.
 *
 * Measured 2026-08-04 on Munkidori `twm-095` "Adrena-Brain" (the only `RemoveDamagePrompt` user in
 * the tree), which pushes `checkHpEffect.hp` for every one of its own Pokemon — so the old
 * `entry.damage <= 0` guard excluded nothing. On A(active 30 damage) + A(bench 0 damage), the menu
 * offered `choose a2`; taking it moved NOTHING (A 30→30, B 0→0) while still satisfying the
 * ability's mandatory `min: 1` transfer, and still burned the once-per-turn ability — the card adds
 * `ADRENA_BRAIN_MARKER` inside the transfer loop, before its own `damageToMove > 0` check, so
 * re-using it returned `CANNOT_USE_POWER`. A no-op that costs a turn.
 *
 * Why this lives here and not in the cross-engine scenario suite: rotomancer decomposes this prompt
 * count-first where twinleaf goes source-first (CF-41, open), so a single `actions[]` cannot drive
 * both engines through it and any differential row is red for CF-41 reasons regardless of TA-203.
 * A menu assertion on a board that also carries an open divergence is unassertable there. Same
 * reasoning the `put-damage` spec records for its own board.
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
function ralts(iid: string, damage: number): PokemonInPlay {
  return { stack: [{ iid, printing: RALTS }], energy: [], tools: [], damage, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  const withPrize = (ps: PlayerState, tag: string): PlayerState =>
    ps.prizes.length ? ps : { ...ps, prizes: [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }] };
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: withPrize(A, 'A'), B: withPrize(B, 'B') },
  };
}

/** The SOURCE step surfaces `choose`; the destination step surfaces `placeCounter`. */
function sourceTargets(game: ImportedGame): string[] {
  const pending = replay(game, []).pending;
  if (pending === null) {
    throw new Error('no pending decision surfaced');
  }
  return (pending.legalActions as WireLegalAction[])
    .filter((a): a is Extract<WireLegalAction, { type: 'choose' }> => a.type === 'choose')
    .map(a => a.target);
}

const t = (player: PlayerType, slot: SlotType, index: number): CardTarget => ({ player, slot, index });

/**
 * Munkidori's own shape: `maxAllowedDamage` carries an HP-sized cap for EVERY friendly Pokemon
 * (damaged or not), opponents are blocked as sources, friendlies are blocked as destinations.
 */
function openPrompt(game: ImportedGame, benchCount: number): void {
  const p = game.state.players[0];
  const friendly: CardTarget[] = [t(PlayerType.BOTTOM_PLAYER, SlotType.ACTIVE, 0)];
  for (let i = 0; i < benchCount; i++) {
    friendly.push(t(PlayerType.BOTTOM_PLAYER, SlotType.BENCH, i));
  }
  const maxAllowedDamage: DamageMap[] = friendly.map(target => ({ target, damage: 110 })); // hp, per the card
  game.store.prompt(game.state, new RemoveDamagePrompt(
    p.id, GameMessage.MOVE_DAMAGE, PlayerType.ANY, [SlotType.ACTIVE, SlotType.BENCH], maxAllowedDamage,
    {
      min: 1, max: 3, allowCancel: false, sameTarget: true,
      blockedTo: friendly,
      blockedFrom: [t(PlayerType.TOP_PLAYER, SlotType.ACTIVE, 0)],
    }
  ), () => { /* result unused: this spec asserts the MENU */ });
}

function boardWith(activeDamage: number, benchDamage: number[]): NeutralState {
  return board(
    player({ active: ralts('a1', activeDamage), bench: benchDamage.map((d, i) => ralts(`a${i + 2}`, d)) }),
    player({ active: ralts('b1', 0) }),
  );
}

describe('Conformance — RemoveDamagePrompt offers only Pokemon that HAVE a counter to move', () => {

  it('an undamaged benched Pokemon is not a source (regression: Munkidori twm-095 no-op transfer)', () => {
    const game = importState(boardWith(30, [0]));
    openPrompt(game, 1);

    const sources = sourceTargets(game);
    expect(sources).toContain('a1');
    // The defect: 'a2' was offered. Taking it satisfied the mandatory min:1 transfer, moved zero
    // damage, and consumed the once-per-turn ability.
    expect(sources).not.toContain('a2');
  });

  it('both damaged Pokemon are still offered — the fix must not over-filter', () => {
    const game = importState(boardWith(30, [20]));
    openPrompt(game, 1);

    const sources = sourceTargets(game);
    expect(sources).toContain('a1');
    expect(sources).toContain('a2');
  });

  it('a source holding less than one full counter is not offered', () => {
    // Sub-counter residue cannot yield a 10-damage transfer, so it is not a source.
    const game = importState(boardWith(30, [5]));
    openPrompt(game, 1);

    const sources = sourceTargets(game);
    expect(sources).toContain('a1');
    expect(sources).not.toContain('a2');
  });

  it('the opponent is never a source when blockedFrom names it', () => {
    const game = importState(boardWith(30, [20]));
    openPrompt(game, 1);

    expect(sourceTargets(game)).not.toContain('b1');
  });
});
