import { Card } from '../game/store/card/card';
import { resolveFormat } from './formats';
import { PokemonCard } from '../game/store/card/pokemon-card';
import { SpecialCondition, SuperType } from '../game/store/card/card-types';
import { State, GamePhase, GameWinner } from '../game/store/state/state';
import { Player } from '../game/store/state/player';
import { PokemonCardList } from '../game/store/state/pokemon-card-list';
import { CardList } from '../game/store/state/card-list';
import { StateUtils } from '../game/store/state-utils';
import { Prompt } from '../game/store/prompts/prompt';
import { ShuffleDeckPrompt } from '../game/store/prompts/shuffle-prompt';
import { ConfirmPrompt } from '../game/store/prompts/confirm-prompt';
import { GameMessage, GameLog } from '../game/game-message';
import { Store } from '../game/store/store';
import { ConformanceStoreHandler } from './conformance-store-handler';
import {
  SCHEMA_VERSION, NeutralState, NeutralPlayerId, PlayerState, PlayerFlags,
  PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, ConditionToken, Phase, Outcome, StadiumRef,
  PlayerLastAttacks, TransitRef
} from './neutral-types';
import { locationOfTag } from './transit-projection';

// M0 reuses the test harness's set-loading/registration machinery (the impl doc's
// `ensureCardsRegistered`). A dedicated, non-test card-registry seam replaces this in a later
// milestone; for the headless adapter it is the same CardManager singleton either way.
import { getCardByName, getCardBySetAndNumber, ensureCardsRegistered } from '../sets/tests/test-helpers';
import { toPrinting, isFullName, printingCandidates } from './printing';
import { abilitiesUsedLabels } from './legal-actions';

/**
 * Resolve a wire `printing` to a fresh twinleaf Card. The conformance form is a set-number
 * (`sit-060`); existing in-process test boards pass a `fullName` ("Ralts SIT"), still accepted for
 * back-compat. `getCardBySetAndNumber` returns the shared registry instance, so re-resolve by name to
 * get a clone (matching the `getCardByName` path, whose result is safe to stamp an `id` on).
 */
function resolveCard(printing: string): Card {
  if (isFullName(printing)) {
    return getCardByName(printing);
  }
  // A `printing` id may name an identity with several printings; load the first one twinleaf has.
  for (const c of printingCandidates(printing)) {
    const found = getCardBySetAndNumber(c.set, c.setNumber);
    if (found !== undefined) {
      return getCardByName(found.fullName);
    }
  }
  throw new Error(`[conformance] no card for printing "${printing}"`);
}

/**
 * The bidirectional iid <-> Card map for one imported game. Card identity is stable across
 * `store.dispatch` (its rollback clone keeps Card instances by reference — deepClone(state,[Card])),
 * so a Map keyed on object identity survives the whole replay. Rebuilt deterministically on each
 * import, so iids are stable across requests (import is a pure function of initialState).
 */
export interface IidContext {
  iidToCard: Map<string, Card>;
  cardToIid: Map<Card, string>;
  /** Import-origin owner (player index 0/1) of each Card, recorded at build time. `Card` has no owner
   *  field, so a decomposer that must re-home a card absent from every zone — e.g. the OrderCards
   *  temp pile (Fortunate Eye peeks the OPPONENT's deck; the prompt owner ≠ the cards' owner) — reads
   *  the source deck from here. Keyed on object identity, so it survives rollback deepClone like the
   *  iid maps above. */
  cardOwner: Map<Card, number>;
  /** The game-constant first player, echoed from `initialState.firstPlayer`. twinleaf's engine `State`
   *  has no first-player field, so it is carried here and projected verbatim. CF-84: `null` when the
   *  game was imported pre-deal — the engine's setup then decides it and `projectFirstPlayer` derives it. */
  firstPlayer: NeutralPlayerId | null;
  /** CF-85: the board's format, echoed verbatim in every projected state. */
  format: string;
  /** B.86 / TA-647: set by the driver as it dispatches an `endTurn` (see `projectPhase`). */
  endTurnAt?: { turn: number; activePlayer: number; logIndex: number };
}

/**
 * CF-65 sub-shape 3 (2026-09-11): the attack a top-level `declareAttack` put in flight, remembered by the
 * driver for as long as that dispatch is the current one. The ENGINE writes `playerLastAttack` only after
 * the attack resolves (TA-399 — its mid-resolution readers need the previous record), so at any pending
 * raised inside the attack the record still shows the previous attack; the PROJECTION overrides it with
 * this (the attack the response's own `attackUsed` event already names), which is what rotomancer projects
 * and what a reader at that node wants. `turn` is captured at declaration — a checkup pending after the
 * turn boundary must not stamp the next turn.
 */
export interface InFlightAttack {
  playerIndex: number;
  name: string;
  sourceCard: Card;
  turn: number;
  /** `events.length` when the attack was dispatched — only an `attackUsed` after this point counts. */
  eventsBefore: number;
}

export interface ImportedGame {
  store: Store;
  handler: ConformanceStoreHandler;
  state: State;
  ctx: IidContext;
  inFlightAttack?: InFlightAttack;
}

// ── A/B <-> twinleaf player index convention ──────────────────────────────
// Neutral 'A' is twinleaf player index 0, 'B' is index 1. `firstPlayer` is a game constant the engine
// State doesn't track (setup is out of scope; initialState is post-setup), so it is carried through the
// import context (`IidContext.firstPlayer`) and projected verbatim from `initialState.firstPlayer`.

export function actorIndex(id: NeutralPlayerId): number {
  return id === 'A' ? 0 : 1;
}

function indexToPlayerId(index: number): NeutralPlayerId {
  return index === 0 ? 'A' : 'B';
}

const CONDITION_TO_TOKEN: ReadonlyArray<readonly [SpecialCondition, ConditionToken]> = [
  [SpecialCondition.POISONED, 'poisoned'],
  [SpecialCondition.BURNED, 'burned'],
  [SpecialCondition.ASLEEP, 'asleep'],
  [SpecialCondition.PARALYZED, 'paralyzed'],
  [SpecialCondition.CONFUSED, 'confused'],
];

function tokenToCondition(token: ConditionToken): SpecialCondition {
  const found = CONDITION_TO_TOKEN.find(([, t]) => t === token);
  if (!found) {
    throw new Error(`[conformance] Unknown condition token "${token}"`);
  }
  return found[0];
}

function conditionToToken(condition: SpecialCondition): ConditionToken {
  const found = CONDITION_TO_TOKEN.find(([c]) => c === condition);
  if (!found) {
    throw new Error(`[conformance] Unmapped special condition ${condition}`);
  }
  return found[1];
}

// ── IMPORT: neutral initialState -> twinleaf State ─────────────────────────

function collectPrintings(initial: NeutralState): string[] {
  const out: string[] = [];
  const pip = (p: PokemonInPlay | null) => {
    if (!p) { return; }
    p.stack.forEach(c => out.push(c.printing));
    p.energy.forEach(c => out.push(c.printing));
    p.tools.forEach(c => out.push(c.printing));
  };
  for (const id of ['A', 'B'] as NeutralPlayerId[]) {
    const ps = initial.players[id];
    pip(ps.active);
    ps.bench.forEach(pip);
    ps.hand.forEach(c => out.push(c.printing));
    ps.deck.forEach(c => out.push(c.printing));
    ps.discard.forEach(c => out.push(c.printing));
    ps.lostZone.forEach(c => out.push(c.printing));
    ps.prizes.forEach(c => out.push(c.printing));
  }
  if (initial.stadium) { out.push(initial.stadium.printing); }
  // CF-15: the last-attack source Pokemon must be loadable so its attack can be resolved on ingest,
  // even though it may not sit in any zone (it attacked last turn and could have left play).
  if (initial.playerLastAttack) {
    for (const id of ['A', 'B'] as NeutralPlayerId[]) {
      const la = initial.playerLastAttack[id];
      if (la) { out.push(la.source); }
    }
  }
  return out;
}

class Importer {
  private nextId = 1;
  /** Player index whose zone is currently being built; stamped onto every materialized card as its
   *  import-origin owner (see IidContext.cardOwner). buildPlayer sets it; the stadium passes an
   *  explicit owner. -1 = unknown (not recorded). */
  private owner = -1;
  constructor(private ctx: IidContext) { }

  /** Resolve a printing to a fresh Card instance and register it in the iid + owner maps. */
  materialize(ref: CardRef, owner: number = this.owner): Card {
    const card = resolveCard(ref.printing);
    card.id = this.nextId++;
    if (this.ctx.iidToCard.has(ref.iid)) {
      throw new Error(`[conformance] Duplicate iid "${ref.iid}" in initialState`);
    }
    this.ctx.iidToCard.set(ref.iid, card);
    this.ctx.cardToIid.set(card, ref.iid);
    if (owner >= 0) {
      this.ctx.cardOwner.set(card, owner);
    }
    return card;
  }

  buildPokemonSlot(slot: PokemonCardList, pip: PokemonInPlay): void {
    // Pokemon stack first (so getPokemons() returns [basic..top] in order), then energy, then tools.
    for (const ref of pip.stack) {
      slot.cards.push(this.materialize(ref));
    }
    const top = slot.getPokemonCard();
    if (top instanceof PokemonCard) {
      slot.hp = top.hp;
    }
    slot.damage = pip.damage;
    slot.specialConditions = pip.conditions.map(tokenToCondition);
    if (pip.poisonDamagePerTurn !== undefined) {
      slot.poisonDamage = pip.poisonDamagePerTurn;
    }
    slot.pokemonPlayedTurn = pip.markers.playedOnTurn;
    slot.cannotAttackNextTurn = pip.markers.cannotAttackNextTurn;
    // G-59: restore once-per-turn Ability-use labels so a round-tripped state keeps once-per-turn
    // Ability state (the re-import hole: without this an ingested state would re-offer a fired
    // once-per-turn Ability). Enforcement is per-card, so this is projection parity, not a gate.
    slot.abilitiesUsedThisTurn = [...pip.markers.abilitiesUsedThisTurn];

    for (const ref of pip.energy) {
      const energy = this.materialize(ref);
      slot.cards.push(energy);
      slot.energies.cards.push(energy);
    }
    for (const ref of pip.tools) {
      const tool = this.materialize(ref);
      // Tools live ONLY in `.tools`, never in `.cards` — this mirrors the real attach path
      // (AttachPokemonToolEffect splices the tool out of `.cards`). If a tool is also left in
      // `.cards`, store.propagateEffect (which walks `.cards` AND `.tools`) reduces the tool's
      // effect twice, so e.g. a pre-placed Muscle Band would add +40 instead of +20.
      slot.tools.push(tool);
    }
  }

  buildPlayer(index: number, ps: PlayerState, turn: number, preDeal = false): Player {
    this.owner = index; // every card materialized below is owned by this player
    const player = new Player();
    player.id = index + 1;
    // Name = neutral id so game logs carry a recoverable actor (display-only in the engine;
    // the event mapper maps params.name -> 'A'/'B').
    player.name = indexToPlayerId(index);

    // 5 bench slots (matching production/test setup), occupied ones filled.
    player.bench = [];
    for (let i = 0; i < 5; i++) {
      const bench = new PokemonCardList();
      bench.isPublic = true;
      player.bench.push(bench);
    }

    player.active.isPublic = true;
    player.discard.isPublic = true;
    player.lostzone.isPublic = true;
    player.stadium.isPublic = true;
    player.supporter.isPublic = true;

    if (ps.active) {
      this.buildPokemonSlot(player.active, ps.active);
    }
    for (let i = 0; i < ps.bench.length && i < player.bench.length; i++) {
      this.buildPokemonSlot(player.bench[i], ps.bench[i]);
    }

    // CF-16: ingest `markers.movedToActiveOnTurn`. The runtime gate MOVED_TO_ACTIVE_THIS_TURN reads
    // `player.movedToActiveThisTurn` (a list of card ids, cleared at each turn start; prefabs.ts:213),
    // so a marker equal to the CURRENT turn means "this Pokemon moved to the Active Spot this turn" —
    // add its top card's id (and set the PokemonCard's cached flag, mirroring check-effect.ts:500-504).
    // A marker < turn (moved on an earlier turn) or the -1 default did NOT move this turn → not added.
    const ingestMovedToActive = (slot: PokemonCardList, pip: PokemonInPlay | null) => {
      if (pip === null || pip.markers.movedToActiveOnTurn !== turn) { return; }
      const top = slot.getPokemonCard();
      if (top instanceof PokemonCard) {
        if (!player.movedToActiveThisTurn.includes(top.id)) {
          player.movedToActiveThisTurn.push(top.id);
        }
        top.movedToActiveThisTurn = true;
      }
    };
    ingestMovedToActive(player.active, ps.active);
    for (let i = 0; i < ps.bench.length && i < player.bench.length; i++) {
      ingestMovedToActive(player.bench[i], ps.bench[i]);
    }

    ps.hand.forEach(ref => player.hand.cards.push(this.materialize(ref)));
    ps.deck.forEach(ref => player.deck.cards.push(this.materialize(ref)));
    // Settled-zone tags (B.80): a temp pile moved out of a tagged list is stamped with the tag (CardList
    // recordSource), so the projection can name a lifted card's `origin`. `deck` also drives the CF-61
    // deck-stamp. A settled zone is never re-tagged.
    player.deck.zoneTag = 'deck';
    player.hand.zoneTag = 'hand';
    player.discard.zoneTag = 'discard';
    player.lostzone.zoneTag = 'lostZone';
    player.active.zoneTag = 'inPlay';
    player.bench.forEach(b => { b.zoneTag = 'inPlay'; });
    ps.discard.forEach(ref => player.discard.cards.push(this.materialize(ref)));
    ps.lostZone.forEach(ref => player.lostzone.cards.push(this.materialize(ref)));
    // B.80: an initialState is a quiescent boundary, so nothing is in transit. A board that says otherwise
    // is malformed; refuse it rather than guess where the cards should go.
    if ((ps.transit ?? []).length > 0) {
      throw new Error('[conformance] initialState.transit must be empty: a quiescent boundary has no card in transit (B.80)');
    }
    // CF-42: round-trip the staging zone. Optional on ingest — boards authored before 0.5.0, and
    // every board a human writes, simply omit it. Without this, export->import would silently DROP a
    // staged Trainer and break card conservation across the round trip.
    (ps.resolving ?? []).forEach(ref => player.supporter.cards.push(this.materialize(ref)));

    player.prizes = ps.prizes.map(ref => {
      const list = new CardList();
      list.isSecret = true;
      list.faceUpPrize = ref.faceUp;
      list.zoneTag = 'prizes';
      list.cards.push(this.materialize(ref));
      return list;
    });
    if (preDeal) {
      // CF-84: mirror the engine's createPlayer (setup-reducer.ts) — 6 EMPTY secret Prize slots that
      // putStartingPokemonsAndPrizes fills from the deck top. (Pre-Release's 4 is a format delta, out of scope.)
      player.prizes = [];
      for (let i = 0; i < 6; i++) {
        const list = new CardList();
        list.isSecret = true;
        player.prizes.push(list);
      }
    }

    // Per-turn / per-game flags -> twinleaf counters (each engine maps its bookkeeping; design §6.2).
    player.energyPlayedTurn = ps.flags.energyAttachedThisTurn ? turn : 0;
    player.supporterTurn = ps.flags.supporterPlayedThisTurn ? 1 : 0;   // counter, not a turn number
    player.stadiumPlayedTurn = ps.flags.stadiumPlayedThisTurn ? turn : 0;
    player.stadiumUsedTurn = ps.flags.stadiumUsedThisTurn ? turn : 0;   // CF-37
    player.retreatedTurn = ps.flags.retreatedThisTurn ? turn : 0;
    player.prizesTakenThisTurn = ps.flags.prizesTakenThisTurn;
    player.prizesTakenLastTurn = ps.flags.prizesTakenLastTurn;
    // CF-17: cumulative prizes taken this game (prize-count-scaled cost/effect readers depend on it,
    // e.g. Radiant Charizard "Excited Heart"). Default to twinleaf's NATIVE semantics — a real counter
    // that is 0 on a fresh import — so the adapter stays faithful to its own engine (the native-vs-
    // adapter equivalence bench asserts exactly this). Do NOT derive 6−pile here: a synthetic board can
    // legitimately be dealt fewer than 6 prizes without any having been taken, and 6−pile would then
    // over-count (it broke 14 equivalence specs). Rotomancer keeps no counter and DERIVES 6−pile, so a
    // cross-engine scenario that needs a mid-game prize count must set flags.prizesTaken EXPLICITLY and
    // keep pile = 6 − prizesTaken (the cf17-excited-heart scenarios do); both engines then agree.
    player.prizesTaken = ps.flags.prizesTaken ?? 0;
    player.usedVSTAR = ps.flags.vstarUsed;
    // `cardsPlayedThisTurn` has no twinleaf per-turn counter yet — deferred (see projectFlags).

    return player;
  }
}

const PHASE_IMPORT: Record<Phase, GamePhase> = {
  setup: GamePhase.SETUP,
  main: GamePhase.PLAYER_TURN,
  checkup: GamePhase.BETWEEN_TURNS,
  gameOver: GamePhase.FINISHED,
};

const OUTCOME_IMPORT: Record<Outcome, GameWinner> = {
  ongoing: GameWinner.NONE,
  winA: GameWinner.PLAYER_1,
  winB: GameWinner.PLAYER_2,
  tie: GameWinner.DRAW,
};

/** Pre-load every set referenced by `initialState`, tolerating id, set-number, and fullName printings. */
function ensurePrintingsLoaded(printings: string[]): void {
  const fullNames: string[] = [];
  for (const printing of printings) {
    if (isFullName(printing)) {
      fullNames.push(printing);
      continue;
    }
    for (const c of printingCandidates(printing)) {
      if (getCardBySetAndNumber(c.set, c.setNumber) !== undefined) {
        break; // loaded the set twinleaf actually has for this id
      }
    }
  }
  ensureCardsRegistered(fullNames);
}

/**
 * CF-15: reconstruct `state.playerLastAttack` (keyed by twinleaf player.id) from the wire record.
 * The source printing resolves to a fresh PokemonCard whose named attack carries the real
 * cost/damage/effect (and the copycatAttack/gxAttack flags COPY_OPPONENTS_LAST_ATTACK checks). The
 * card need not be in play — the copy path calls `sourceCard.reduceEffect` directly (prefabs.ts:638).
 */
function ingestPlayerLastAttack(state: State, initial: NeutralState): void {
  if (!initial.playerLastAttack) { return; }
  for (const id of ['A', 'B'] as NeutralPlayerId[]) {
    const la = initial.playerLastAttack[id];
    if (!la) { continue; }
    const sourceCard = resolveCard(la.source);
    if (!(sourceCard instanceof PokemonCard)) {
      throw new Error(`[conformance] playerLastAttack.source "${la.source}" is not a Pokemon`);
    }
    const attack = sourceCard.attacks.find(a => a.name === la.name);
    if (attack === undefined) {
      throw new Error(`[conformance] playerLastAttack: "${la.source}" has no attack "${la.name}"`);
    }
    const playerId = state.players[actorIndex(id)].id;
    state.playerLastAttack[playerId] = { attack, sourceCard, turn: la.turn };
  }
}

export function importState(initial: NeutralState): ImportedGame {
  ensurePrintingsLoaded(collectPrintings(initial));

  const ctx: IidContext = {
    iidToCard: new Map(), cardToIid: new Map(), cardOwner: new Map(), firstPlayer: initial.firstPlayer,
    format: resolveFormat(initial.format), // validated by handlers.ts; absent = the CF-85 rollout bridge
  };
  const importer = new Importer(ctx);

  const handler = new ConformanceStoreHandler();
  const store = new Store(handler);
  handler.setStore(store);

  const state = new State();
  state.phase = PHASE_IMPORT[initial.phase];
  state.turn = initial.turn;
  state.activePlayer = actorIndex(initial.activePlayer);
  state.winner = OUTCOME_IMPORT[initial.outcome];
  // TA-561: the contract scores a tied game as outcome `tie`; the rulebook's tiebreaker game that follows is a new
  // game outside any scenario, so a conformance game ends at the tie instead of starting it (real games play it).
  state.rules.tiebreakerGame = false;

  const preDeal = initial.phase === 'setup'; // CF-84: validated as the pre-deal state by handlers.ts
  const playerA = importer.buildPlayer(0, initial.players.A, initial.turn, preDeal);
  const playerB = importer.buildPlayer(1, initial.players.B, initial.turn, preDeal);
  state.players = [playerA, playerB];

  if (initial.stadium) {
    const stadiumOwner = actorIndex(initial.stadium.owner);
    state.players[stadiumOwner].stadium.cards.push(importer.materialize(initial.stadium, stadiumOwner));
  }

  ingestPlayerLastAttack(state, initial); // CF-15

  store.state = state;
  return { store, handler, state, ctx };
}

// ── PROJECT: twinleaf State -> neutral observable projection ───────────────

const PHASE_PROJECT: Record<number, Phase> = {
  [GamePhase.SETUP]: 'setup',
  [GamePhase.PLAYER_TURN]: 'main',
  [GamePhase.ATTACK]: 'main',
  [GamePhase.AFTER_ATTACK]: 'main',
  [GamePhase.CHOOSE_PRIZES]: 'main',
  [GamePhase.BETWEEN_TURNS]: 'checkup',
  [GamePhase.FINISHED]: 'gameOver',
};

/**
 * B.86 / TA-647 (owner pin, contract convention): a pending raised during Pokémon Checkup, the Knock Out pause
 * included, reports `checkup`. The engine checks an `endTurn`'s Knock Outs inside the EndTurnEffect, while its phase
 * is still PLAYER_TURN (BETWEEN_TURNS is entered only after that check, for the Special Conditions), so the Prize pick
 * and the promotion of that check read `main`. The turn is over at that point: the projection reports `checkup` when
 * the engine is still in the turn an `endTurn` ended (same turn, same active player), a decision is open, and a
 * Knock Out has been written since the `endTurn`. An attack's Knock Out is checked before its turn ends (#1869) and is
 * untouched (no `endTurn` was dispatched in that turn); so is everything once the next turn starts (the turn moved).
 */
function projectPhase(state: State, ctx: IidContext): Phase {
  const phase = PHASE_PROJECT[state.phase] ?? 'main';
  const end = ctx.endTurnAt;
  if (phase !== 'main' || state.phase !== GamePhase.PLAYER_TURN || end === undefined
    || end.turn !== state.turn || end.activePlayer !== state.activePlayer
    || !state.prompts.some(p => p.result === undefined)) {
    return phase;
  }
  return state.logs.slice(end.logIndex).some(l => l.message === GameLog.LOG_POKEMON_KO) ? 'checkup' : phase;
}

function projectOutcome(winner: GameWinner): Outcome {
  switch (winner) {
    case GameWinner.PLAYER_1: return 'winA';
    case GameWinner.PLAYER_2: return 'winB';
    case GameWinner.DRAW: return 'tie';
    default: return 'ongoing';
  }
}

function cardRef(ctx: IidContext, card: Card): CardRef {
  const iid = ctx.cardToIid.get(card);
  if (iid === undefined) {
    throw new Error(`[conformance] Card "${card.fullName}" (id ${card.id}) has no iid mapping`);
  }
  return { iid, printing: toPrinting(card) };
}

function projectPip(ctx: IidContext, state: State, slot: PokemonCardList, player: Player, turn: number): PokemonInPlay {
  const conditions = slot.specialConditions.map(conditionToToken);
  // CF-16: project the real "moved to Active this turn" marker. The runtime tracks membership in
  // `player.movedToActiveThisTurn` (cleared at turn start), so a member moved THIS turn → emit `turn`;
  // otherwise the -1 default (moved on an earlier turn / since setup / never). Round-trips the ingest.
  const top = slot.getPokemonCard();
  const movedToActiveOnTurn = (top !== undefined && player.movedToActiveThisTurn.includes(top.id)) ? turn : -1;
  const markers: PokemonMarkers = {
    playedOnTurn: slot.pokemonPlayedTurn,
    movedToActiveOnTurn,
    // damageTakenThisTurn is not tracked per-Pokemon-per-turn by twinleaf yet — deferred to a later
    // milestone (impl doc §4.7). M0 round-trips it at this documented default.
    damageTakenThisTurn: 0,
    // G-59: once-per-turn activated Ability labels this Pokemon has fired this turn, DERIVED from
    // enforcement (legal-actions.ts abilitiesUsedLabels): a label iff the engine would refuse a re-use
    // now and that refusal rests on state the use left behind. Not "the announcement happened" — a card
    // that never sets the marker it checks (OOP-84 charizard) reads [] while it is re-offered, and an
    // ingested label is honoured by usePower so a round trip keeps it.
    abilitiesUsedThisTurn: abilitiesUsedLabels(state, player, slot),
    cannotAttackNextTurn: slot.cannotAttackNextTurn,
  };
  // An "attach this card to 1 of your Pokémon" Trainer (PlusPower bs-084, Weakness Guard aq-141,
  // Defender …) lives in slot.cards without being a Pokémon, an Energy or a registered Tool, so the
  // three typed projections above it all skip it and the card VANISHED from the wire while attached
  // (G-44 residual, single-engine conservation). It is attached to this Pokémon, which is what the
  // `tools` slot means on the wire; project it there after the real Tools. TRAINERS ONLY, and only
  // while the card is in no settled zone of its player: an Energy that an attack is returning to the
  // deck (Sonic Ripper por-055) can still sit in slot.cards after it left slot.energies and is already
  // in player.deck — a stale membership, not an attachment — and projecting it here would double it.
  const pokemons = slot.getPokemons();
  const settled = [player.deck, player.hand, player.discard, player.lostzone];
  const attachedOther = slot.cards.filter(c =>
    c.superType === SuperType.TRAINER
    && !pokemons.includes(c as PokemonCard) && !slot.tools.includes(c) && !slot.energies.cards.includes(c)
    && !settled.some(z => z.cards.includes(c)));
  const pip: PokemonInPlay = {
    stack: pokemons.map(c => cardRef(ctx, c)),
    energy: slot.energies.cards.map(c => cardRef(ctx, c)),
    tools: [...slot.tools, ...attachedOther].map(c => cardRef(ctx, c)),
    damage: slot.damage,
    conditions,
    markers,
  };
  if (conditions.includes('poisoned') && slot.poisonDamage !== 10) {
    pip.poisonDamagePerTurn = slot.poisonDamage;
  }
  // CF-84: setup places Pokémon face down (setup-reducer sets isSecret) until the reveal. Only
  // emitted while true, so every non-setup board projects exactly as before.
  if (state.phase === GamePhase.SETUP && slot.isSecret) {
    pip.faceDown = true;
  }
  return pip;
}

function projectFlags(player: Player, turn: number): PlayerFlags {
  return {
    // `supporterTurn` is a per-turn COUNTER (0 = none played this turn; += 1 on each Supporter play;
    // reset to 0 each turn; the one-per-turn rule gates on `=== 0`) — NOT a turn number like the other
    // three flags. So the flag is "> 0", not "=== turn" (which compared the counter 1 to the turn no.).
    supporterPlayedThisTurn: player.supporterTurn > 0,
    energyAttachedThisTurn: player.energyPlayedTurn === turn,
    stadiumPlayedThisTurn: player.stadiumPlayedTurn === turn,
    // CF-37: emitted only when spent (optional field — same omit-the-default treatment as
    // `prizesTaken`, so the pre-CF-37 fixtures round-trip unchanged).
    ...(player.stadiumUsedTurn === turn ? { stadiumUsedThisTurn: true } : {}),
    retreatedThisTurn: player.retreatedTurn === turn,
    cardsPlayedThisTurn: 0, // deferred: no twinleaf per-turn counter yet
    prizesTakenThisTurn: player.prizesTakenThisTurn,
    prizesTakenLastTurn: player.prizesTakenLastTurn,
    // CF-17 / CF-48: cumulative prizes taken (has live readers, unlike the per-turn tallies).
    // ALWAYS EMITTED, including the 0. It used to be omitted while zero, to round-trip symmetrically
    // with the `?? 0` ingest — but symmetry on OUR wire is not the property that matters, because
    // rotomancer always emits it. Absent and `0` are the same board and a different wire, so anything
    // keyed on presence (or any consumer reading `flags.prizesTaken` without a default) splits the two
    // engines on every board where no Prize has yet been taken, and CF-48's comparison had to stay
    // switched off for it. A projected flags object that omits a DEFINED field is the weaker contract,
    // which is why ours is the side that moved. Ingest still defaults (`?? 0`), so seeded boards that
    // predate this and omit the field are unaffected.
    prizesTaken: player.prizesTaken ?? 0,
    vstarUsed: player.usedVSTAR,
  };
}

/**
 * CF-86 (B.68, pinned 2026-09-29): the deck's cards in their projected order while a BOTTOM-SEGMENT
 * shuffle is open ("Shuffle the other cards and put them on the bottom of your deck" — Metal Maker
 * tef-114, Delibird J-MEE). The engine (SHUFFLE_BOTTOM_OF_DECK) pushes the remainder onto the bottom
 * and THEN raises the shuffle, so at the open ShuffleDeckPrompt the segment already sits at the bottom.
 * The printed text shuffles first and puts on the bottom second: until the shuffle is answered the pile
 * has not been put anywhere, so it projects where it came from — the top of the deck, in pile order —
 * exactly as CF-61 places any deck-sourced pile mid-effect (rotomancer's shape). Projection only: the
 * engine's own order is untouched, and a resolved prompt (result set) projects the deck as it stands.
 */
/**
 * B.80 (amends CF-86 / B.63 / TA-396c): at an open ShuffleDeckPrompt over the BOTTOM `bottomCount` cards of
 * the deck (a hand or a looked-at remainder that was put under the deck and is being shuffled), that
 * segment is a sub-pile being shuffled face down: it is in TRANSIT (`origin` = the prompt's source zone,
 * `destination: {deck, bottom}`, `visibility: owner` — its owner has seen it), not in the deck. The rest of the deck projects as it is.
 * A whole-deck shuffle (no `bottomCount`) lifts nothing: the deck zone IS the face-down stack.
 */
function deckAndShuffleSegment(state: State, player: Player, ctx: IidContext): { deck: Card[]; inFlight: TransitRef[] } {
  const cards = player.deck.cards;
  const open = state.prompts.find(p => p.playerId === player.id && p.type.startsWith('Shuffle')
    && p.result === undefined && ((p as unknown as { bottomCount?: number }).bottomCount ?? 0) > 0) as ShuffleDeckPrompt | undefined;
  const n = open ? Math.min(open.bottomCount as number, cards.length) : 0;
  if (n <= 0) {
    return { deck: cards, inFlight: [] };
  }
  // B.81: `origin` and `destination` are Locations. A card its owner has seen is never `hidden` (B.81 §4): a
  // hand-sourced segment (the Iono family) is known to its owner, and so is every deck-sourced one twinleaf
  // raises — the only deck-sourced bottom segment is the looked-at remainder of a "look at the top N" effect
  // (moveRemainingTopDeckCards: Metal Maker tef-114, Delibird J-MEE). Rotomancer N-0278 §3 caught the
  // `hidden` this used to say for it. A never-looked deck block would be `hidden`; no prefab raises one.
  const zone = (open as unknown as { zone?: string }).zone ?? 'deck';
  const origin = locationOfTag(zone);
  const inFlight: TransitRef[] = cards.slice(cards.length - n).map(c => {
    const t: TransitRef = { ...cardRef(ctx, c), visibility: 'owner', destination: { zone: 'deck', position: 'bottom' } };
    if (origin !== undefined) { t.origin = origin; }
    return t;
  });
  return { deck: cards.slice(0, cards.length - n), inFlight };
}

function projectPlayer(ctx: IidContext, state: State, player: Player, turn: number,
    lifted: TransitRef[] = []): PlayerState {
  // B.80: `lifted` is the transit pile the prompt-visible temp lists give this player (see
  // detachedTransitCards), deduped by iid; the shuffle segment below joins it. The cross-zone prune (a pile
  // card still in a settled zone — Iris selects in place; an opponent-peek pile) is GLOBAL, in
  // pruneTransitDuplicates, which sees every player's zones; a per-player filter would miss the cross-player
  // case, so it is deliberately not done here.
  const seen = new Set<string>();
  const liftedKept = lifted.filter(t => {
    if (seen.has(t.iid)) { return false; }
    seen.add(t.iid);
    return true;
  });
  const { deck, inFlight } = deckAndShuffleSegment(state, player, ctx);

  const prizes: PrizeRef[] = [];
  for (const prize of player.prizes) {
    const card = prize.cards[0];
    if (card === undefined) { continue; }
    // B.81: a Prize its card text has stamped as lifted (Lucky Bonus's Chansey while its reaction is open: taken and
    // seen, kept in the pile by the engine until the flow completes) is NOT on the Prize row; the orphan pass
    // projects it in transit from the stamp.
    if (CardList.transit.has(card)) { continue; }
    prizes.push({ ...cardRef(ctx, card), faceUp: prize.faceUpPrize });
  }
  return {
    active: player.active.getPokemonCard() ? projectPip(ctx, state, player.active, player, turn) : null,
    bench: player.bench
      .filter(b => b.getPokemonCard() !== undefined)
      .map(b => projectPip(ctx, state, b, player, turn)),
    hand: player.hand.cards.map(c => cardRef(ctx, c)),
    deck: deck.map(c => cardRef(ctx, c)),
    discard: player.discard.cards.map(c => cardRef(ctx, c)),
    lostZone: player.lostzone.cards.map(c => cardRef(ctx, c)),
    prizes,
    // CF-42 — a Trainer mid-resolution is staged in player.supporter (play-trainer-effect.ts) until
    // its effect finishes, and the API legitimately pauses there at an externalized flip/choose. B.80
    // narrowed the zone back to exactly this: played Trainers on the playing field (#916). Everything
    // else the engine holds outside a settled zone is a LIFTED card and goes to `transit`.
    //
    // This USED to be folded into `discard` because the DTO had no zone for it. The fold kept card
    // conservation, but the projection asserted something #919 forbids, and because the projection
    // was the UNION of the two zones an engine that correctly DEFERS the discard and one that
    // WRONGLY discards early produced a byte-identical state — the harness could not detect a #919
    // violation in either engine, by construction. Schema 0.5.0 added the zone; this is it.
    resolving: player.supporter.cards.map(c => cardRef(ctx, c)),
    // B.80 / CF-91 — the cards this player owns that someone has lifted out of a zone and not yet placed:
    // the prompt-visible temp piles (a "look at the top N" window, an opponent-peek pile, a reorder pile),
    // then a bottom segment being shuffled. Decomposer fix-ups (step()) add the picks already made inside an
    // open decision; projectOrphans adds closure-local piles no prompt references (Tyme's face-down Pokémon).
    transit: [...liftedKept, ...inFlight],
    flags: projectFlags(player, turn),
  };
}

function projectStadium(ctx: IidContext, state: State): StadiumRef | null {
  const stadiumCard = StateUtils.getStadiumCard(state);
  if (!stadiumCard) { return null; }
  const ownerIndex = state.players.findIndex(p => p.stadium.cards.includes(stadiumCard));
  if (ownerIndex === -1) { return null; }
  return { ...cardRef(ctx, stadiumCard), owner: indexToPlayerId(ownerIndex) };
}

/**
 * CF-15: project `state.playerLastAttack` (keyed by twinleaf player.id) back to the wire shape
 * (keyed A/B, source printing + attack name + turn). Undefined when neither side has a record, so
 * the optional field is omitted for the overwhelming majority of boards (no churn, round-trips ingest).
 */
function projectPlayerLastAttack(state: State): PlayerLastAttacks | undefined {
  const out: PlayerLastAttacks = {};
  for (const index of [0, 1]) {
    const player = state.players[index];
    const la = state.playerLastAttack[player.id];
    if (la && la.attack && la.sourceCard) {
      out[indexToPlayerId(index)] = { source: toPrinting(la.sourceCard), name: la.attack.name, turn: la.turn };
    }
  }
  return (out.A || out.B) ? out : undefined;
}

/**
 * basic iid → the slot's DISPLAY name (stack top), for attributing log targets (TA-252). Twinleaf's
 * damage logs name their target by the top card's display name — ambiguous across identical
 * printings, which is why KO COUNTING never matches on names (see events.ts). Attribution is the
 * one place a name is safe: the consumer requires an exactly-one match among the KO'd and skips
 * otherwise, so an ambiguous name degrades to the old behavior instead of guessing.
 */
export function basicIidDisplayNames(state: State, ctx: IidContext): Map<string, string> {
  const out = new Map<string, string>();
  for (const player of state.players) {
    for (const slot of [player.active, ...player.bench]) {
      const pokemons = slot.getPokemons();
      const top = slot.getPokemonCard();
      if (pokemons.length > 0 && top !== undefined) {
        const iid = ctx.cardToIid.get(pokemons[0]);
        if (iid !== undefined) {
          out.set(iid, top.name);
        }
      }
    }
  }
  return out;
}

/**
 * iid → display name for EVERY card the game knows, not just basic Pokemon. CF-60 forbids minting, so
 * `ctx.iidToCard` holds every card for the whole game (materialized once at initialState), which is why
 * this can name an energy/tool/evolution card by its iid at any step. Used by the observed-tier
 * derivations in events.ts (energyAttached/toolAttached/evolved) to carry the receiving Pokemon's basic
 * iid (the `pokemon` field is an iid everywhere on the wire, CF-60) alongside the attached/evolution
 * card's display name (the `card` field, a card type's name).
 */
export function allIidNames(ctx: IidContext): Map<string, string> {
  const out = new Map<string, string>();
  for (const [iid, card] of ctx.iidToCard) {
    out.set(iid, card.name);
  }
  return out;
}

/** The temp look pile an active prompt operates over, if any — the two field names it may carry. */
function promptTempPile(prompt: Prompt<unknown>): CardList | undefined {
  const p = prompt as unknown as { cards?: unknown; cardList?: unknown };
  if (p.cards instanceof CardList) { return p.cards; }
  if (p.cardList instanceof CardList) { return p.cardList; }
  return undefined;
}

/**
 * Per-player-index cards that sit in an active prompt's temp pile — the "look at top N" window (Waitress
 * `deck.moveTo(temp, 6)` then a ChooseCardsPrompt over `temp`), an opponent-peek pile, a reorder pile.
 * B.80: those cards have been LIFTED out of a zone and belong in their OWNER's `transit`, with `origin` read
 * from the pile's CardList.fromZoneTag (stamped by moveTo/moveCardsTo from the tagged settled zone) and
 * `visibility: owner` when the looker owns the pile, `opponent` when it is the other player's (B.83; a decomposer whose prompt is a
 * public reveal raises it to `public` in its fix-up). No settled-zone filter here: pruneTransitDuplicates
 * applies it against the SAME snapshot it projects, the only place the filter is guaranteed consistent.
 */
function detachedTransitCards(state: State, ctx: IidContext): TransitRef[][] {
  const out: TransitRef[][] = state.players.map(() => []);
  if (state.prompts.length === 0) { return out; }
  const sameList = (a: object | undefined, b: object): boolean => {
    for (let x: object | null = a ?? null; x !== null && x !== Object.prototype; x = Object.getPrototypeOf(x)) {
      if (x === b) { return true; }
    }
    for (let y: object | null = b; y !== null && y !== Object.prototype; y = Object.getPrototypeOf(y)) {
      if (y === a) { return true; }
    }
    return false;
  };
  for (const prompt of state.prompts) {
    const pile = promptTempPile(prompt);
    if (pile === undefined) { continue; }
    const promptOwner = state.players.findIndex(p => p.id === prompt.playerId);
    if (promptOwner === -1) { continue; }
    const zoneOrigin = locationOfTag(pile.fromZoneTag);
    const ref = (pile as unknown as { fromZoneRef?: object }).fromZoneRef;
    // B.81: a pile lifted off a Pokémon (fromZoneTag `inPlay`) names the stack and the role — the source list
    // is the PokemonCardList itself, so its section and basic are readable.
    let stack: { section: 'active' | 'bench'; basic: string } | undefined;
    if (ref !== undefined && pile.fromZoneTag === 'inPlay') {
      for (const p of state.players) {
        const section = sameList(ref, p.active) ? 'active' : p.bench.some(b => sameList(ref, b)) ? 'bench' : undefined;
        if (section === undefined) { continue; }
        const list = (section === 'active' ? p.active : p.bench.find(b => sameList(ref, b))) as PokemonCardList;
        const basicIid = ctx.cardToIid.get(list.getPokemons()[0]);
        if (basicIid !== undefined) { stack = { section, basic: basicIid }; }
        break;
      }
    }
    for (const card of pile.cards) {
      // Owner = the player whose settled zone the pile came from (a deck window belongs to the deck's
      // owner, resolved through fromZoneRef up the prototype chain), else the import-origin owner, else
      // the prompt's owner.
      let owner = -1;
      if (ref !== undefined) {
        owner = state.players.findIndex(p => sameList(ref, p.deck) || sameList(ref, p.hand) || sameList(ref, p.discard)
          || sameList(ref, p.lostzone) || p.prizes.some(z => sameList(ref, z)));
      }
      if (owner === -1) { owner = ctx.cardOwner.get(card) ?? promptOwner; }
      const iid = ctx.cardToIid.get(card);
      if (iid === undefined) { continue; }
      // B.83: the prompt's player is the looker. A pile of the OTHER player's cards (Fortunate Eye looks at the
      // opponent's top five) is known to its owner's opponent only: `opponent` (TA-611).
      const t: TransitRef = { iid, printing: toPrinting(card), visibility: owner === promptOwner ? 'owner' : 'opponent' };
      if (stack !== undefined) {
        t.origin = { zone: stack.section, pokemon: stack.basic,
          role: card.superType === SuperType.ENERGY ? 'energy' : card.superType === SuperType.TRAINER ? 'tool' : 'pokemon' };
      } else if (zoneOrigin !== undefined) {
        t.origin = zoneOrigin;
      }
      out[owner].push(t);
    }
  }
  return out;
}

/**
 * I1 guard on a wire state: a `resolving` card whose iid appears in ANY other zone of EITHER player is
 * a duplicate and is dropped from `resolving`. The look-pile projection stages a mid-effect card into
 * `resolving`, but the same card may still sit in a settled zone — the prompt selects from the deck
 * without moving it (Iris), the pile is the OPPONENT's cards (a look-at-opponent effect: prompt owner
 * ≠ card owner), or a decomposer's `fixupProjection` (CF-1) re-homes it into the deck AFTER projection
 * (Waitress's "shuffle the rest back"). Global by design — the cross-player case needs both players'
 * zones. The settled zone is authoritative; resolving yields. Conservation holds: still projected once.
 * Idempotent, so it runs at the end of projectState and again after the fixups in step().
 */
export function pruneResolvingDuplicates(state: NeutralState): void {
  // B.80: `transit` and `resolving` both yield to every settled zone (a pile card the prompt selects IN
  // PLACE — Iris — is still in its zone; an opponent-peek pile holds the other player's cards), and each
  // is deduped by iid. The settled zone is authoritative. Conservation holds: still projected once.
  const settled = new Set<string>();
  const add = (cards: { iid: string }[]) => cards.forEach(c => settled.add(c.iid));
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    const p = state.players[who];
    for (const slot of [p.active, ...p.bench]) {
      if (slot) { add(slot.stack); add(slot.energy); add(slot.tools); }
    }
    add(p.hand); add(p.discard); add(p.lostZone);
    p.prizes.forEach(pc => settled.add(pc.iid));
  }
  if (state.stadium) { settled.add(state.stadium.iid); }
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    const p = state.players[who];
    const seen = new Set<string>();
    p.deck = p.deck.filter(c => {
      if (settled.has(c.iid) || seen.has(c.iid)) { return false; }
      seen.add(c.iid);
      return true;
    });
    add(p.deck);
  }
  const inTransit = new Set<string>();
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    const p = state.players[who];
    if (p.transit && p.transit.length > 0) {
      p.transit = p.transit.filter(c => {
        if (settled.has(c.iid) || inTransit.has(c.iid)) { return false; }
        inTransit.add(c.iid);
        return true;
      });
    }
  }
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    const p = state.players[who];
    if (p.resolving && p.resolving.length > 0) {
      p.resolving = p.resolving.filter(c => !settled.has(c.iid) && !inTransit.has(c.iid));
    }
  }
}

/**
 * CF-84. A normal import echoes `initialState.firstPlayer`. After a PRE-DEAL import the engine's setup
 * decides it and records only `state.activePlayer` (setup-reducer: the GO_FIRST confirm, or a
 * WhoBeginsEffect claim) — and A is also the pre-decision default, so "decided" is read from the prompt
 * trail (resolved prompts stay in `state.prompts`): the first setup ShuffleDeckPrompt is raised only
 * after the decision, on both paths. Once setup is over, turn parity names the first player.
 */
function projectFirstPlayer(state: State, ctx: IidContext): NeutralPlayerId | null {
  if (ctx.firstPlayer !== null) { return ctx.firstPlayer; }
  if (state.phase !== GamePhase.SETUP) {
    const firstIndex = state.turn % 2 === 1 ? state.activePlayer : 1 - state.activePlayer;
    return indexToPlayerId(firstIndex);
  }
  const decided = state.prompts.some(p => p instanceof ShuffleDeckPrompt
    || (p instanceof ConfirmPrompt && p.message === GameMessage.GO_FIRST && p.result !== undefined));
  return decided ? indexToPlayerId(state.activePlayer) : null;
}

export function projectState(state: State, ctx: IidContext): NeutralState {
  const lastAttack = projectPlayerLastAttack(state); // CF-15
  const detached = detachedTransitCards(state, ctx);
  const out: NeutralState = {
    schemaVersion: SCHEMA_VERSION,
    format: ctx.format, // CF-85: echoed from initialState
    turn: state.turn,
    activePlayer: indexToPlayerId(state.activePlayer),
    firstPlayer: projectFirstPlayer(state, ctx), // echoed from initialState, or derived after a pre-deal import (CF-84)
    phase: projectPhase(state, ctx),
    outcome: projectOutcome(state.winner),
    stadium: projectStadium(ctx, state),
    players: {
      A: projectPlayer(ctx, state, state.players[0], state.turn, detached[0]),
      B: projectPlayer(ctx, state, state.players[1], state.turn, detached[1]),
    },
    // CF-15: OMIT the key entirely when neither side has a record — the field is optional, not nullable,
    // so `playerLastAttack: undefined` would still add the property and fail an exact-shape assertion.
    ...(lastAttack ? { playerLastAttack: lastAttack } : {}),
    activeEffects: [], // timed effects are deferred (design §6.3); emitted as [] per the contract default
  };
  // Drop any look-pile card from `resolving` that is really still in a settled zone (Iris selects in
  // place; an opponent-peek pile holds the other player's cards). The step() caller re-runs this after
  // fixupProjection, which can re-home a pile card into the deck (Waitress). Idempotent.
  pruneResolvingDuplicates(out);
  projectOrphans(out, ctx);
  return out;
}

/**
 * Conservation by construction (G-44 completion, the general case): every card the game knows is in
 * `ctx.iidToCard` (materialized once, CF-60 never mints), so any card that the projection above put in
 * NO zone is a card the engine is holding somewhere the adapter cannot see — a closure-local CardList
 * that no active prompt references (Rotom Dex bus-122 moves the top 4 into a local pile and then asks a
 * ConfirmPrompt, which carries no cards), or any future staging idiom. Such a card is IN PLAY and
 * mid-resolution, so it belongs in its owner's `resolving`, not vanished. Owner = the seeded owner
 * (`ctx.cardOwner`, the player whose initialState carried it). Runs AFTER pruneResolvingDuplicates so a
 * card is never both pruned and re-added; the step() caller's post-fixup prune only ever REMOVES, so an
 * orphan added here stays projected exactly once.
 */
export function projectOrphans(state: NeutralState, ctx: IidContext): void {
  const seen = new Set<string>();
  const add = (cards: { iid: string }[]) => cards.forEach(c => seen.add(c.iid));
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    const p = state.players[who];
    for (const slot of [p.active, ...p.bench]) {
      if (slot) { add(slot.stack); add(slot.energy); add(slot.tools); }
    }
    add(p.hand); add(p.deck); add(p.discard); add(p.lostZone); add(p.resolving ?? []); add(p.transit ?? []);
    p.prizes.forEach(pc => seen.add(pc.iid));
  }
  if (state.stadium) { seen.add(state.stadium.iid); }
  // B.80: an orphan is a card the engine holds in a closure-local pile no prompt references — a LIFTED card.
  // It goes to its owner's `transit`. Its fields come from the stamp its own card text set (CardList.transit:
  // Tyme's face-down Pokémon {hand, hand, owner}); else, for a card that left the settled deck (the CF-61
  // deck-stamp), `origin: deck` with `visibility: owner` (a look), in the order the cards left the deck;
  // else origin AND visibility are omitted — the adapter cannot read where the card came from or who sees
  // it, and the harness reports that as a contract gap rather than letting a guess stand in (TA-590 census).
  const stamped: Record<NeutralPlayerId, Array<{ t: TransitRef; seq: number }>> = { A: [], B: [] };
  const textStamped: Record<NeutralPlayerId, Array<{ t: TransitRef; order: number }>> = { A: [], B: [] };
  for (const [iid, card] of ctx.iidToCard) {
    if (seen.has(iid)) { continue; }
    const ownerIndex = ctx.cardOwner.get(card);
    const who: NeutralPlayerId = ownerIndex === 1 ? 'B' : 'A';
    const p = state.players[who];
    const stamp = CardList.transit.get(card);
    if (stamp !== undefined) {
      // B.81: the card-text stamp names zones as tags (Tyme: {hand, hand, owner}); they project as Locations.
      const t: TransitRef = { iid, printing: toPrinting(card), visibility: stamp.visibility };
      const origin = locationOfTag(stamp.origin);
      if (origin !== undefined) { t.origin = origin; }
      const destination = locationOfTag(stamp.destination, true);
      if (destination !== undefined) { t.destination = destination; }
      textStamped[who].push({ t, order: stamp.order ?? Number.POSITIVE_INFINITY });
    } else if (CardList.deckStamp.has(card)) {
      stamped[who].push({ t: { iid, printing: toPrinting(card), origin: { zone: 'deck' }, visibility: 'owner' }, seq: CardList.deckStamp.get(card)! });
    } else {
      p.transit = [...(p.transit ?? []), { iid, printing: toPrinting(card) } as TransitRef];
    }
    seen.add(iid);
  }
  // A text-stamped pile in its known order (`order`); unordered stamps keep the walk's order (a stable sort).
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    if (textStamped[who].length === 0) { continue; }
    const p = state.players[who];
    p.transit = [...(p.transit ?? []), ...textStamped[who].sort((x, y) => (x.order === y.order ? 0 : x.order - y.order)).map(x => x.t)];
  }
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    if (stamped[who].length === 0) { continue; }
    const p = state.players[who];
    p.transit = [...(p.transit ?? []), ...stamped[who].sort((a, b) => a.seq - b.seq).map(e => e.t)];
  }
}
