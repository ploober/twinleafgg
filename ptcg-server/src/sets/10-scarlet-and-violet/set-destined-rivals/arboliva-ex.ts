import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import {
  StoreLike,
  State,
  GameMessage,
  PlayerType,
  SlotType,
  DamageMap,
  PutDamagePrompt,
  StateUtils,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import {
  WAS_ATTACK_USED,
  DAMAGE_OPPONENT_POKEMON,
} from '../../../game/store/prefabs/prefabs';

export class Arbolivaex extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Dolliv';
  public tags = [CardTag.POKEMON_ex];
  public cardType: CardType = G;
  public hp: number = 310;
  public weakness = [{ type: R }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Oil Salvo',
      cost: [G],
      damage: 0,
      text: "Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance.",
    },
    {
      name: 'Aroma Shot',
      cost: [C, C, C],
      damage: 160,
      text: 'This Pokémon recovers from all Special Conditions.',
    },
  ];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public setNumber: string = '23';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Arboliva ex';
  public fullName: string = 'Arboliva ex DRI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Oil Machine Gun
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = effect.opponent;

      const maxAllowedDamage: DamageMap[] = [];
      opponent.forEachPokemon(
        PlayerType.TOP_PLAYER,
        (cardList, card, target) => {
          maxAllowedDamage.push({ target, damage: card.hp + 120 });
        },
      );

      const damage = 120;

      return store.prompt(
        state,
        new PutDamagePrompt(
          effect.player.id,
          GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
          PlayerType.TOP_PLAYER,
          [SlotType.ACTIVE, SlotType.BENCH],
          damage,
          maxAllowedDamage,
          { allowCancel: false, damageMultiple: 20, operation: 'dealDamage' },
        ),
        (targets) => {
          const results = targets || [];
          for (const result of results) {
            const target = StateUtils.getTarget(state, player, result.target);
            // Applying ONE summed hit per target is CORRECT, and there is a ruling that says so directly.
            // Compendium **#2161** (Destined Rivals FAQ, TPCi Rules Team 2025-05-29), on this exact attack:
            // *"Oil Salvo is a single attack. The attack's damage is calculated AFTER you finish making all
            // choices, so all damage modifiers are applied to the TOTAL damage for each Pokémon."* Its
            // worked example is dispositive — choose three Pokémon twice each ⇒ 40 per Pokémon (20×2), then
            // Granite Cave's −30 applied ONCE to that total ⇒ 10 damage each.
            //
            // So `PutDamagePrompt`'s `DamageMap[]` (a per-target total) is exactly the right shape here, and
            // TA-148 — which I filed claiming this should be six discrete 20s — is **RETRACTED 2026-07-29**.
            // Landing that "fix" would have been a rules VIOLATION: six separate 20s each reduced by 30
            // under Granite Cave give 0, where the ruling requires 10. The revert was right for the reason
            // the ruling confirms (per-hit modifiers must not apply per hit); it is now grounded rather
            // than merely cautious. Do not "fix" this again without re-reading #2161.
            //
            // Rotomancer's six `damaged hp=20` events are the side now in question — see `dri-023`. Note
            // #2161 constrains damage CALCULATION, not logging, so per-choice logging could still be
            // faithful; the discriminating test is a Granite Cave `dri-166` board (10 = correct, 0 = six
            // reductions). Related: **#2160** (same FAQ) — *"All damage is done before KO's happen"*, so a
            // chosen Active that would be KO'd still shields the Bench for the rest of the attack.
            DAMAGE_OPPONENT_POKEMON(store, state, effect, result.damage, [
              target,
            ]);
          }
        },
      );
    }

    return state;
  }
}
