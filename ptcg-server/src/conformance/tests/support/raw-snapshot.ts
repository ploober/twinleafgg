import { State } from '../../../game/store/state/state';
import { Player } from '../../../game/store/state/player';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';
import { CardList } from '../../../game/store/state/card-list';
import { Card } from '../../../game/store/card/card';
import { IidContext } from '../../state-adapter';

/**
 * Tier 2 — import-fidelity support (testing design doc §5).
 *
 * A deep, **iid/id/object-identity-free** structural snapshot of a raw engine `State`, used to prove
 * the adapter's `importState` builds the *same canonical state* the engine's own `setupGame` builds.
 * Crucially it includes fields the neutral projection IGNORES (`isPublic`/`isSecret`, `hp`,
 * `pokemonPlayedTurn`, the per-player flag counters) — that is the class of bug nothing else can see:
 * a non-canonical import that the projection reads back consistently.
 *
 * Documented normalization (deliberately excluded, because the two builders legitimately differ or
 * the field is incidental): `card.id` (native bases at 1000, adapter at 1), object identity,
 * `player.name` (adapter stamps 'A'/'B' for log actors; native leaves ''), `state.prompts`,
 * `state.logs`, `lastAttack`. Everything kept is in the BoardSpec *intersection* both builders express.
 */

// ── snapshot shapes (all plain, JSON-able, for jasmine `toEqual`) ──

interface SlotSnapshot {
  stack: string[];      // evolution stack fullNames, basic -> top
  energies: string[];   // attached energy fullNames, in order
  tools: string[];      // attached tool fullNames, in order
  damage: number;
  hp: number;
  conditions: number[]; // SpecialCondition values, sorted
  pokemonPlayedTurn: number;
  cannotAttackNextTurn: boolean;
  markers: string[];    // marker names, sorted
}

interface ZoneSnapshot {
  cards: string[];      // fullNames, in engine order
  isPublic: boolean;
  isSecret: boolean;
}

interface PrizeSnapshot {
  fullName: string;
  faceUp: boolean;
}

interface PlayerSnapshot {
  active: SlotSnapshot | null;
  bench: SlotSnapshot[];        // occupied slots only, in slot order
  hand: ZoneSnapshot;
  deck: ZoneSnapshot;
  discard: ZoneSnapshot;
  lostzone: ZoneSnapshot;
  stadium: ZoneSnapshot;
  supporter: ZoneSnapshot;
  prizes: PrizeSnapshot[];
  flags: {
    energyPlayedTurn: number;
    supporterTurn: number;
    stadiumPlayedTurn: number;
    retreatedTurn: number;
    prizesTakenThisTurn: number;
    prizesTakenLastTurn: number;
    usedVSTAR: boolean;
    usedGX: boolean;
  };
}

export interface RawSnapshot {
  phase: number;
  turn: number;
  activePlayer: number;
  winner: number;
  players: [PlayerSnapshot, PlayerSnapshot];
}

// ── card collection (mirrors card-test-helpers' `collectAllCardLists` zone set) ──

/**
 * Every Card physically present in the game, in a stable zone walk. Attached energy/tools already
 * live in each Pokemon's `.cards`, so this is the canonical, non-double-counting set — and it is a
 * superset of every card the projection reads (stack/energies/tools ⊆ slot.cards; plus the stadium,
 * supporter, prize, and pile zones).
 */
export function collectAllCards(state: State): Card[] {
  const cards: Card[] = [];
  for (const player of state.players) {
    const lists: CardList[] = [
      player.deck, player.hand, player.discard, player.lostzone, player.stadium, player.supporter,
      player.active, ...player.bench, ...player.prizes,
    ];
    for (const list of lists) {
      cards.push(...list.cards);
    }
  }
  return cards;
}

/**
 * A synthetic `IidContext` for a native (non-conformance) `State` that has no iids of its own —
 * every card is keyed by its (unique-per-state) `card.id`. Lets `projectState` run on a native state
 * for the replay-fidelity check; the iids are canonicalized away in the comparison, so they only need
 * to be internally consistent (and `projectState.cardRef` requires every projected card be present).
 */
export function synthCtx(state: State): IidContext {
  const iidToCard = new Map<string, Card>();
  const cardToIid = new Map<Card, string>();
  for (const card of collectAllCards(state)) {
    const iid = String(card.id);
    iidToCard.set(iid, card);
    cardToIid.set(card, iid);
  }
  return { iidToCard, cardToIid };
}

// ── snapshot ──

function snapshotSlot(slot: PokemonCardList): SlotSnapshot {
  return {
    stack: slot.getPokemons().map(c => c.fullName),
    energies: slot.energies.cards.map(c => c.fullName),
    tools: slot.tools.map(c => c.fullName),
    damage: slot.damage,
    hp: slot.hp,
    conditions: slot.specialConditions.slice().sort((a, b) => a - b),
    pokemonPlayedTurn: slot.pokemonPlayedTurn,
    cannotAttackNextTurn: slot.cannotAttackNextTurn,
    markers: slot.marker.markers.map(m => m.name).sort(),
  };
}

function snapshotZone(list: CardList): ZoneSnapshot {
  return { cards: list.cards.map(c => c.fullName), isPublic: list.isPublic, isSecret: list.isSecret };
}

function snapshotPlayer(player: Player): PlayerSnapshot {
  return {
    active: player.active.getPokemonCard() !== undefined ? snapshotSlot(player.active) : null,
    bench: player.bench.filter(b => b.getPokemonCard() !== undefined).map(snapshotSlot),
    hand: snapshotZone(player.hand),
    deck: snapshotZone(player.deck),
    discard: snapshotZone(player.discard),
    lostzone: snapshotZone(player.lostzone),
    stadium: snapshotZone(player.stadium),
    supporter: snapshotZone(player.supporter),
    prizes: player.prizes
      .filter(p => p.cards.length > 0)
      .map(p => ({ fullName: p.cards[0].fullName, faceUp: p.faceUpPrize })),
    flags: {
      energyPlayedTurn: player.energyPlayedTurn,
      supporterTurn: player.supporterTurn,
      stadiumPlayedTurn: player.stadiumPlayedTurn,
      retreatedTurn: player.retreatedTurn,
      prizesTakenThisTurn: player.prizesTakenThisTurn,
      prizesTakenLastTurn: player.prizesTakenLastTurn,
      usedVSTAR: player.usedVSTAR,
      usedGX: player.usedGX,
    },
  };
}

export function snapshotRawState(state: State): RawSnapshot {
  return {
    phase: state.phase,
    turn: state.turn,
    activePlayer: state.activePlayer,
    winner: state.winner,
    players: [snapshotPlayer(state.players[0]), snapshotPlayer(state.players[1])],
  };
}
