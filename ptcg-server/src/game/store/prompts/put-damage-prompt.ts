import { GameMessage } from '../../game-message';
import { Prompt, TargetOperation } from './prompt';
import { PlayerType, SlotType, CardTarget } from '../actions/play-card-action';
import { State } from '../state/state';
import { StateUtils } from '../state-utils';
import { DamageMap } from './move-damage-prompt';

export const PutDamagePromptType = 'Put damage';

export interface PutDamageOptions {
  allowCancel: boolean;
  blocked: CardTarget[];
  allowPlacePartialDamage?: boolean | undefined;
  /**
   * HP applied by a single pick. Defaults to 10 — one damage counter — because that is what this
   * prompt is for: distributing N damage counters over targets. The "Choose 1 of your opponent's
   * Pokémon K times … do X damage to it" family reuses the prompt with `damageMultiple: X`, where a
   * pick is one of the K choices rather than one counter.
   */
  damageMultiple?: number;
  /**
   * What each pick does to its target. Defaults to `'placeCounters'` — the prompt's own reason for
   * existing. The repeated-choice damage family above sets `'dealDamage'`: those cards choose a
   * Pokémon and deal damage to it, which is not counter placement (it runs through the damage
   * pipeline, and the printed text says "do X damage to it", not "put X damage counters on it").
   */
  operation?: TargetOperation;
}

export class PutDamagePrompt extends Prompt<DamageMap[]> {

  readonly type: string = PutDamagePromptType;

  public options: PutDamageOptions;

  constructor(
    playerId: number,
    public message: GameMessage,
    public playerType: PlayerType,
    public slots: SlotType[],
    public damage: number,
    public maxAllowedDamage: DamageMap[],
    options?: Partial<PutDamageOptions>
  ) {
    super(playerId);

    // Default options
    this.options = Object.assign({}, {
      allowCancel: true,
      blocked: [],
      allowPlacePartialDamage: false,
      damageMultiple: 10,
      operation: 'placeCounters' as TargetOperation,
    }, options);
  }

  public decode(result: DamageMap[] | null, state: State): DamageMap[] | null {
    return result;
  }

  public validate(result: DamageMap[] | null, state: State): boolean {
    if (result === null) {
      return this.options.allowCancel;  // operation cancelled
    }

    let damage = 0;
    result.forEach(r => { damage += r.damage; });

    if (this.damage !== damage && !this.options.allowPlacePartialDamage) {
      return false;
    }

    const player = state.players.find(p => p.id === this.playerId);
    if (player === undefined) {
      return false;
    }
    const blocked = this.options.blocked.map(b => StateUtils.getTarget(state, player, b));

    for (const r of result) {
      const target = StateUtils.getTarget(state, player, r.target);
      if (target === undefined || blocked.includes(target)) {
        return false;
      }
    }

    if (this.playerType !== PlayerType.ANY) {
      if (result.some(r => r.target.player !== this.playerType)) {
        return false;
      }
    }

    if (result.some(r => !this.slots.includes(r.target.slot))) {
      return false;
    }

    return true;
  }

}
