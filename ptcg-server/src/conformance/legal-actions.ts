import { PokemonCard } from '../game/store/card/pokemon-card';
import { TrainerCard } from '../game/store/card/trainer-card';
import { EnergyCard } from '../game/store/card/energy-card';
import {
  SuperType, TrainerType, Stage, SpecialCondition, BoardEffect, CardType
} from '../game/store/card/card-types';
import { Attack, PowerType } from '../game/store/card/pokemon-types';
import { State, GamePhase } from '../game/store/state/state';
import { Player } from '../game/store/state/player';
import { PokemonCardList } from '../game/store/state/pokemon-card-list';
import { StateUtils } from '../game/store/state-utils';
import { StoreLike } from '../game/store/store-like';
import {
  CheckPokemonAttacksEffect, CheckAttackCostEffect, CheckRetreatCostEffect,
  CheckProvidedEnergyEffect, CheckPokemonPowersEffect
} from '../game/store/effects/check-effects';
import { ImportedGame, IidContext } from './state-adapter';
import { LegalAction, PendingDecision, NeutralPlayerId } from './neutral-types';

/**
 * The active player's top-level main-phase menu (impl §4.6, M5). Returned by the driver at a
 * quiescent boundary (no open prompt, action log exhausted) when the game is ongoing and in the
 * main phase. Each LegalAction mirrors a dispatchable top-level NeutralAction, so the menu is
 * directly executable — the M5 spec round-trips every entry through `step` to prove soundness.
 *
 * Legality is enumerated by mirroring the engine's own gates: hand playability comes from the
 * store's per-dispatch `player.playableCardIds`; attacks/retreat/abilities reuse the same Check*
 * effects the reducers use (`CheckPokemonAttacksEffect`, `CheckAttackCostEffect`,
 * `CheckProvidedEnergyEffect`, `CheckRetreatCostEffect`, `CheckPokemonPowersEffect`). These are
 * the engine's read-only query effects (the same ones `calculatePlayability` drives), so reducing
 * them here does not mutate the observable projection.
 */

interface OwnSlot {
  list: PokemonCardList;
  /** iid of the stack's bottom/basic card — the Pokemon-in-play's stable identity. */
  iid: string;
  /** Bench slot index, or null for the active slot. */
  benchIndex: number | null;
}

/** The active player's in-play Pokemon (active + occupied bench), each with its identifying iid. */
function ownInPlay(player: Player, ctx: IidContext): OwnSlot[] {
  const slots: OwnSlot[] = [];
  const push = (list: PokemonCardList, benchIndex: number | null) => {
    if (list.getPokemonCard() === undefined) { return; }
    const iid = ctx.cardToIid.get(list.getPokemons()[0]);
    if (iid !== undefined) { slots.push({ list, iid, benchIndex }); }
  };
  push(player.active, null);
  player.bench.forEach((b, i) => push(b, i));
  return slots;
}

// ── Phase 1: hand plays (from the store's precomputed playability) ───────────

function handMenu(state: State, player: Player, ctx: IidContext): LegalAction[] {
  const out: LegalAction[] = [];
  const playable = new Set(player.playableCardIds);
  const own = ownInPlay(player, ctx);
  const hasBenchSpace = player.bench.some(b => b.cards.length === 0);

  for (const card of player.hand.cards) {
    if (!playable.has(card.id)) { continue; }
    const iid = ctx.cardToIid.get(card);
    if (iid === undefined) { continue; }

    if (card.superType === SuperType.POKEMON && card instanceof PokemonCard) {
      if (card.evolvesFrom === '' && card.stage === Stage.BASIC) {
        if (hasBenchSpace) { out.push({ type: 'benchBasic', card: iid }); }
      } else {
        // Evolution: one entry per in-play Pokemon it legally evolves (matching name, not played
        // this turn — POKEMON_CANT_EVOLVE_THIS_TURN gates `pokemonPlayedTurn >= state.turn`).
        for (const s of own) {
          const top = s.list.getPokemonCard();
          if (top && top.name === card.evolvesFrom && s.list.pokemonPlayedTurn < state.turn) {
            out.push({ type: 'evolve', card: iid, target: s.iid });
          }
        }
      }
    } else if (card.superType === SuperType.ENERGY && card instanceof EnergyCard) {
      for (const s of own) { out.push({ type: 'attachEnergy', card: iid, target: s.iid }); }
    } else if (card.superType === SuperType.TRAINER && card instanceof TrainerCard) {
      switch (card.trainerType) {
        case TrainerType.TOOL:
          for (const s of own) {
            if (s.list.tools.length === 0) { out.push({ type: 'attachTool', card: iid, target: s.iid }); }
          }
          break;
        case TrainerType.ITEM: out.push({ type: 'playItem', card: iid }); break;
        case TrainerType.SUPPORTER: out.push({ type: 'playSupporter', card: iid }); break;
        case TrainerType.STADIUM: out.push({ type: 'playStadium', card: iid }); break;
      }
    }
  }
  return out;
}

// ── Phase 2: attacks / retreat / abilities (new legality enumeration) ────────

function enoughEnergyFor(store: StoreLike, state: State, player: Player, source: PokemonCardList, attack: Attack): boolean {
  const cost = new CheckAttackCostEffect(player, attack);
  store.reduceEffect(state, cost);
  const provided = new CheckProvidedEnergyEffect(player, source);
  store.reduceEffect(state, provided);
  return StateUtils.checkEnoughEnergy(provided.energyMap, cost.cost as CardType[]);
}

/** The per-attack locks `useAttack` enforces on the attacking Pokemon (first-turn + cannot-attack). */
function attackUnlocked(state: State, source: PokemonCardList, attack: Attack): boolean {
  if (state.turn === 1 && attack.canUseOnFirstTurn !== true && state.rules.attackFirstTurn === false) {
    return false;
  }
  if (source.cannotAttackNextTurn) { return false; }
  if (source.cannotUseAttacksNextTurn.includes(attack.name)) { return false; }
  return true;
}

function attackMenu(store: StoreLike, state: State, player: Player, ctx: IidContext): LegalAction[] {
  // PARALYZED / ASLEEP block ALL attacks (checked on the active regardless of attacker).
  const sp = player.active.specialConditions;
  if (sp.includes(SpecialCondition.PARALYZED) || sp.includes(SpecialCondition.ASLEEP)) { return []; }

  const out: LegalAction[] = [];
  const emit = (source: PokemonCardList, attacks: Attack[]) => {
    const iid = source.getPokemonCard() ? ctx.cardToIid.get(source.getPokemons()[0]) : undefined;
    if (iid === undefined) { return; }
    for (const attack of attacks) {
      if (!attackUnlocked(state, source, attack)) { continue; }
      if (!enoughEnergyFor(store, state, player, source, attack)) { continue; }
      out.push({ type: 'declareAttack', source: iid, name: attack.name });
    }
  };

  const activeCard = player.active.getPokemonCard();
  if (activeCard) {
    const toolAttacks = new CheckPokemonAttacksEffect(player);
    store.reduceEffect(state, toolAttacks);
    emit(player.active, [...activeCard.attacks, ...toolAttacks.attacks]);
  }
  // Bench Pokemon with `useOnBench` attacks can attack from the bench.
  for (const b of player.bench) {
    const bc = b.getPokemonCard();
    if (bc) { emit(b, bc.attacks.filter(a => a.useOnBench === true)); }
  }
  return out;
}

function retreatMenu(store: StoreLike, state: State, player: Player): LegalAction[] {
  if (player.active.getPokemonCard() === undefined) { return []; }
  const sp = player.active.specialConditions;
  if (sp.includes(SpecialCondition.PARALYZED) || sp.includes(SpecialCondition.ASLEEP)) { return []; }
  if (player.retreatedTurn === state.turn) { return []; }

  const benchSlots = player.bench
    .map((b, i) => ({ b, i }))
    .filter(x => x.b.cards.length > 0);
  if (benchSlots.length === 0) { return []; }

  const cost = new CheckRetreatCostEffect(player);
  store.reduceEffect(state, cost);
  if (cost.cost.length > 0) {
    const provided = new CheckProvidedEnergyEffect(player, player.active);
    store.reduceEffect(state, provided);
    if (!StateUtils.checkEnoughEnergy(provided.energyMap, cost.cost)) { return []; }
  }
  return benchSlots.map(x => ({ type: 'retreat', to: x.i } as LegalAction));
}

function abilityMenu(store: StoreLike, state: State, player: Player, ctx: IidContext): LegalAction[] {
  const out: LegalAction[] = [];
  for (const s of ownInPlay(player, ctx)) {
    const pokemon = s.list.getPokemonCard();
    if (pokemon === undefined) { continue; }
    // Once-per-turn activated abilities flag the slot with ABILITY_USED (cleared at EndTurnEffect).
    if (s.list.boardEffect.includes(BoardEffect.ABILITY_USED)) { continue; }
    // Others gate via a player marker sourced by the card itself (e.g. Radiant Tsareena's
    // ELEGANT_HEAL_MARKER, added through USE_ABILITY_ONCE_PER_TURN). A card that has added a
    // self-sourced player marker this turn has already spent its once-per-turn ability, so don't
    // offer it again — the engine would reject the re-use with POWER_ALREADY_USED, and legalActions
    // must not contain a move the engine refuses (design §10.3). This is an approximation: twinleaf
    // exposes no read-only "is this ability usable" query and the marker names are card-private, so
    // we key on the source card; the fuzzer's "rejected its own legalAction" invariant guards drift.
    if (player.marker.markers.some(m => m.source === pokemon)) { continue; }
    const powersEffect = new CheckPokemonPowersEffect(player, pokemon);
    store.reduceEffect(state, powersEffect);
    for (const power of powersEffect.powers) {
      if (power.powerType !== PowerType.ABILITY) { continue; }
      if (power.useWhenInPlay !== true) { continue; } // only player-activated in-play abilities
      out.push({ type: 'useAbility', source: s.iid, ability: power.name });
    }
  }
  return out;
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/**
 * The main-phase menu, or null when there is nothing to choose (game over, or a non-main boundary —
 * e.g. a checkup the engine resolves itself). `endTurn` is always legal for the active player.
 */
export function topLevelMenu(game: ImportedGame): PendingDecision | null {
  const state = game.state;
  if (state.phase !== GamePhase.PLAYER_TURN) { return null; }

  const player = state.players[state.activePlayer];
  const actor: NeutralPlayerId = state.activePlayer === 0 ? 'A' : 'B';

  // Refresh hand playability. The store recomputes `playableCardIds` at the end of every
  // reduceEffect (store.ts); a boundary reached by replay is already fresh, but a no-op step
  // (reading the menu with an empty action log) never dispatched — so trigger the same recompute
  // here with a read-only effect.
  game.store.reduceEffect(state, new CheckProvidedEnergyEffect(player));

  const legalActions: LegalAction[] = [
    ...handMenu(state, player, game.ctx),
    ...attackMenu(game.store, state, player, game.ctx),
    ...retreatMenu(game.store, state, player),
    ...abilityMenu(game.store, state, player, game.ctx),
    { type: 'endTurn' },
  ];

  return { actor, descriptor: 'main', legalActions };
}
