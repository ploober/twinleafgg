import { Effect } from './effect';
import { Player } from '../state/player';
import { Card } from '../card/card';
import { Attack } from '../card/pokemon-types';
import { AttackEffect } from './game-effects';

export enum GamePhaseEffects {
  BEGIN_TURN_EFFECT = 'BEGIN_TURN_EFFECT',
  DRAW_CARD_FOR_TURN_EFFECT = 'DRAW_CARD_FOR_TURN_EFFECT',
  END_TURN_EFFECT = 'END_TURN_EFFECT',
  WHO_BEGINS_EFFECT = 'WHO_BEGINS_EFFECT',
  BETWEEN_TURNS_EFFECT = 'BETWEEN_TURNS_EFFECT',
  CHOOSE_STARTING_POKEMON_EFFECT = 'CHOOSE_STARTING_POKEMON_EFFECT',
  DREW_TOPDECK_EFFECT = 'DREW_TOPDECK_EFFECT',
  CHOOSE_PRIZE_EFFECT = 'CHOOSE_PRIZE_EFFECT',
  AFTER_ATTACK_EFFECT = 'AFTER_ATTACK_EFFECT',
  BEFORE_DOING_DAMAGE_EFFECT = 'BEFORE_DOING_DAMAGE_EFFECT',
}

export class BeginTurnEffect implements Effect {
  readonly type: string = GamePhaseEffects.BEGIN_TURN_EFFECT;
  public preventDefault = false;
  public player: Player;

  constructor(player: Player) {
    this.player = player;
  }
}

export class DrawCardForTurnEffect implements Effect {
  readonly type: string = GamePhaseEffects.DRAW_CARD_FOR_TURN_EFFECT;
  public preventDefault = false;
  public player: Player;
  public drawCount = 1;

  constructor(player: Player) {
    this.player = player;
  }
}

export class DrewTopdeckEffect implements Effect {
  readonly type: string = GamePhaseEffects.DREW_TOPDECK_EFFECT;
  public preventDefault = false;
  public player: Player;
  public handCard: Card;

  constructor(player: Player, handCard: Card) {
    this.player = player;
    this.handCard = handCard;
  }
}

export class ChooseStartingPokemonEffect implements Effect {
  readonly type: string = GamePhaseEffects.CHOOSE_STARTING_POKEMON_EFFECT;
  public preventDefault = false;
  public player: Player;

  constructor(player: Player) {
    this.player = player;
  }
}

export class BeforeDoingDamageEffect implements Effect {
  readonly type: string = GamePhaseEffects.BEFORE_DOING_DAMAGE_EFFECT;
  public preventDefault = false;
  public player: Player;
  public opponent: Player;
  public attack: Attack;
  public attackEffect: AttackEffect;

  constructor(attackEffect: AttackEffect) {
    this.attackEffect = attackEffect;
    this.player = attackEffect.player;
    this.opponent = attackEffect.opponent;
    this.attack = attackEffect.attack;
  }
}

export class AfterAttackEffect implements Effect {
  readonly type: string = GamePhaseEffects.AFTER_ATTACK_EFFECT;
  public preventDefault = false;
  public player: Player;
  public opponent: Player;
  public attack: Attack;
  // The originating AttackEffect, carried so a post-damage rider migrated onto AFTER_ATTACK can
  // construct damage/counter sub-effects (PutDamageEffect/PutCountersEffect etc.), which need the
  // AttackEffect's source/target — the family-A migration (TA-128).
  public attackEffect: AttackEffect;

  constructor(player: Player, opponent: Player, attack: Attack, attackEffect: AttackEffect) {
    this.player = player;
    this.opponent = opponent;
    this.attack = attack;
    this.attackEffect = attackEffect;
  }
}

export class ChoosePrizeEffect implements Effect {
  readonly type: string = GamePhaseEffects.CHOOSE_PRIZE_EFFECT;
  public preventDefault = false;
  public player: Player;

  constructor(player: Player) {
    this.player = player;
  }
}

export class EndTurnEffect implements Effect {
  readonly type: string = GamePhaseEffects.END_TURN_EFFECT;
  public preventDefault = false;
  public player: Player;
  /**
   * TA-549: end-of-turn steps that come AFTER the turn's Knock Outs are checked and their Prize cards taken, and
   * before Pokémon Checkup (#1869, Precious Gift: "used at the end of your turn after attacking and checking for a KO
   * but before Pokemon Checkup"). A card handler that prompted directly on this effect asked before the attack's
   * Knock Out was resolved; it pushes its step here instead, and the default handler runs the queue once the KO sweep
   * has completed, before the turn passes.
   */
  public afterKnockOuts: Array<() => void> = [];

  constructor(player: Player) {
    this.player = player;
  }
}

export class WhoBeginsEffect implements Effect {
  readonly type: string = GamePhaseEffects.END_TURN_EFFECT;
  public preventDefault = false;
  public player: Player | undefined;

  constructor() { }
}

export class BetweenTurnsEffect implements Effect {
  readonly type: string = GamePhaseEffects.BETWEEN_TURNS_EFFECT;
  public preventDefault = false;
  public player: Player;
  public poisonDamage: number;
  public flipsForSleep: number | undefined;
  public burnDamage: number;
  public burnFlipResult: boolean | undefined;
  public asleepFlipResult: boolean | undefined;
  public maternalComfortUsed?: boolean;

  constructor(player: Player) {
    this.player = player;
    this.poisonDamage = player.active.poisonDamage;
    this.burnDamage = player.active.burnDamage;
    this.flipsForSleep = undefined;
    this.burnFlipResult = undefined;
    this.asleepFlipResult = undefined;
  }
}
