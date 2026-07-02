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
 * Legality is enumerated by mirroring the engine's own gates: Pokemon/Energy hand playability comes
 * from the store's per-dispatch `player.playableCardIds`; trainers use `trainerPlayable` (which
 * matches what `playCardAction` accepts, not the conservative `playableCardIds` that hides most
 * Item/Supporter plays); attacks/retreat/abilities reuse the same Check*
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

function handMenu(store: StoreLike, state: State, player: Player, ctx: IidContext): LegalAction[] {
  const out: LegalAction[] = [];
  const playable = new Set(player.playableCardIds);
  const own = ownInPlay(player, ctx);
  const hasBenchSpace = player.bench.some(b => b.cards.length === 0);

  for (const card of player.hand.cards) {
    const iid = ctx.cardToIid.get(card);
    if (iid === undefined) { continue; }

    if (card.superType === SuperType.POKEMON && card instanceof PokemonCard) {
      if (!playable.has(card.id)) { continue; }
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
      if (!playable.has(card.id)) { continue; }
      for (const s of own) { out.push({ type: 'attachEnergy', card: iid, target: s.iid }); }
    } else if (card.superType === SuperType.TRAINER && card instanceof TrainerCard) {
      // Trainers are NOT gated on playableCardIds: that mirrors CAN_PLAY_CARD, which defaults
      // Items/Supporters lacking a canPlay() override to `false` — yet the playCardAction reducer
      // accepts them, so mirroring it would make legalActions under-report most trainer plays
      // (a §10.3 contract gap). Enumerate by the engine's real play-time gates instead.
      if (!trainerPlayable(store, state, player, card)) { continue; }
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

/**
 * Whether a trainer in hand is playable right now, for legalAction enumeration. CAN_PLAY_CARD (which
 * feeds player.playableCardIds) defaults Items/Supporters without a canPlay() override to false —
 * but playCardAction accepts them, so mirroring playableCardIds under-reports. We defer to
 * CAN_PLAY_CARD when it says yes (covers Energy/Pokemon/Tool/Stadium and trainers that DO implement
 * canPlay()), honor an explicit canPlay() verdict, and otherwise enumerate the canPlay-less majority
 * of Items/Supporters by the engine's basic play-time gates (the same ones CAN_PLAY_TRAINER_CARD
 * checks before its conservative fallback). Over-reporting is self-correcting: the fuzzer's
 * "never reject your own legalAction" invariant flags any enumerated play the reducer refuses.
 */
function trainerPlayable(store: StoreLike, state: State, player: Player, card: TrainerCard): boolean {
  const { CAN_PLAY_CARD } = require('../game/store/prefabs/prefabs');
  if (CAN_PLAY_CARD(store, state, player, card)) { return true; }
  if (card.canPlay) { return false; } // had a card-specific verdict above — honor it, don't override
  switch (card.trainerType) {
    case TrainerType.SUPPORTER:
      if (state.turn === 1 && !card.firstTurn) { return false; }
      return player.supporterTurn === 0;
    case TrainerType.ITEM:
      if (player.marker.hasMarker('OPPONENT_CANNOT_PLAY_ITEM_CARDS_MARKER')) { return false; }
      if (player.marker.hasMarker(player.ATTACK_EFFECT_ITEM_LOCK)) { return false; }
      return true;
    default:
      return false; // Tool/Stadium were already adjudicated by CAN_PLAY_CARD above
  }
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
  // `to` indexes the PROJECTED bench (occupied slots only, in order) — native slot numbers are
  // engine-private and drift from the projection once a promote/KO leaves a hole (TA-9). The
  // driver's dispatchRetreat translates back to the native slot.
  return benchSlots.map((_slot, k) => ({ type: 'retreat', to: k } as LegalAction));
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
    ...handMenu(game.store, state, player, game.ctx),
    ...attackMenu(game.store, state, player, game.ctx),
    ...retreatMenu(game.store, state, player),
    ...abilityMenu(game.store, state, player, game.ctx),
    { type: 'endTurn' },
  ];

  return { actor, descriptor: 'main', legalActions };
}
