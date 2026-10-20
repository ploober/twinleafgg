import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { HealEffect } from '../../../game/store/effects/game-effects';
import { ChoosePokemonPrompt } from '../../../game/store/prompts/choose-pokemon-prompt';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { SuperType } from '../../../game/store/card/card-types';
import { PlayerType, SlotType, CardTarget, GameError, GameMessage, PokemonCardList, Card, ChooseCardsPrompt } from '../../../game';
import { SuperPotion } from '../../07-x-and-y/set-x-and-y/super-potion';
import { BlackBeltsTraining } from '../set-prismatic-evolution/black-belts-training';
import { ProfessorsResearch } from '../set-scarlet-and-violet/professors-research';
import { BrocksScouting } from './brocks-scouting';
import { Dudunsparceex } from './dudunsparce-ex';
import { HopsWooloo } from './hops-wooloo';
import { HopsZacianex } from './hops-zacian-ex';
import { IonosBelliboltex } from './ionos-bellibolt-ex';
import { IonosKilowattrel } from './ionos-kilowattrel';
import { IrisFightingSpirit } from './iris-fighting-spirit';
import { LilliesClefairyex } from './lillies-clefairy-ex';
import { LilliesRibombee } from './lillies-ribombee';
import { Lycanroc } from './lycanroc';
import { Mamoswineex } from './mamoswine-ex';
import { Maractus } from './maractus';
import { NsReshiram } from './ns-reshiram';
import { NsZoroarkex } from './ns-zoroark-ex';
import { Ruffian } from './ruffian';
import { Salamenceex } from './salamence-ex';
import { SpikyEnergy } from './spiky-energy';
import { Swinub } from './swinub';
import { Volcanionex } from './volcanion-ex';
import { Wailord } from './wailord';

// MARK: Trainer Reprints

// TA-717: the JTG text heals FIRST and discards an Energy only if it healed; the inherited XY effect made the discard a
// cost (Energy required, asked before the heal). Own effect here; the XY card keeps its own.
function* playSuperPotionJTG(next: Function, store: StoreLike, state: State, effect: TrainerEffect): IterableIterator<State> {
  const player = effect.player;
  const blocked: CardTarget[] = [];
  player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card, target) => {
    if (cardList.damage === 0) {
      blocked.push(target);
    }
  });
  let damaged = false;
  player.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => { damaged = damaged || cardList.damage > 0; });
  if (!damaged) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }
  // We will discard this card after prompt confirmation
  effect.preventDefault = true;

  let targets: PokemonCardList[] = [];
  yield store.prompt(state, new ChoosePokemonPrompt(
    player.id,
    GameMessage.CHOOSE_POKEMON_TO_HEAL,
    PlayerType.BOTTOM_PLAYER,
    [SlotType.ACTIVE, SlotType.BENCH],
    { allowCancel: false, blocked }
  ), results => {
    targets = results || [];
    next();
  });
  if (targets.length === 0) {
    return state;
  }

  const target = targets[0];
  const before = target.damage;
  store.reduceEffect(state, new HealEffect(player, target, 60));
  if (target.damage >= before || !target.cards.some(c => c.superType === SuperType.ENERGY)) {
    return state;
  }

  let cards: Card[] = [];
  yield store.prompt(state, new ChooseCardsPrompt(
    player,
    GameMessage.CHOOSE_CARD_TO_DISCARD,
    target,
    { superType: SuperType.ENERGY },
    { min: 1, max: 1, allowCancel: false }
  ), selected => {
    cards = selected || [];
    next();
  });
  MOVE_CARDS(store, state, target, player.discard, { cards, sourceCard: effect.trainerCard });
  return state;
}

export class SuperPotionJTG extends SuperPotion {
  public setNumber = '158';
  public fullName: string = 'Super Potion JTG';
  public set = 'JTG';
  public regulationMark = 'I';
  public legacyFullName = 'Super Potion MC';
  public text: string =
    'Heal 60 damage from 1 of your Pokémon. If you healed any damage in this way, discard an Energy from that Pokémon.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const generator = playSuperPotionJTG(() => generator.next(), store, state, effect);
      return generator.next().value;
    }
    return state;
  }
}

export class MaractusIR extends Maractus {
  public fullName = 'MaractusIR JTG';
  public setNumber = '160';
}

// export class ArticunoIR extends Articuno {
//   public fullName = 'ArticunoIR JTG';
//   public setNumber = '161';
// }

export class WailordIR extends Wailord {
  public fullName = 'WailordIR JTG';
  public setNumber = '162';
}

export class IonosKilowattrelIR extends IonosKilowattrel {
  public fullName = 'Iono\'s KilowattrelIR JTG';
  public setNumber = '163';
}

export class LilliesRibombeeIR extends LilliesRibombee {
  public fullName = 'Lillie\'s RibombeeIR JTG';
  public setNumber = '164';
}

export class SwinubIR extends Swinub {
  public fullName = 'SwinubIR JTG';
  public setNumber = '165';
}

export class LycanrocIR extends Lycanroc {
  public fullName = 'LycanrocIR JTG';
  public setNumber = '166';
}

//export class NsZoruaIR extends NsZorua {
//  public fullName = 'N\'s ZoruaIR JTG';
//  public setNumber = '100';
//}

export class NsReshiramIR extends NsReshiram {
  public fullName = 'N\'s ReshiramIR JTG';
  public setNumber = '167';
}

// export class FurretIR extends Furret {
//   public fullName = 'FurretIR JTG';
//   public setNumber = '168';
// }

// export class NoibatIR extends Noibat {
//   public fullName = 'NoibatIR JTG';
//   public setNumber = '169';
// }

export class HopsWoolooIR extends HopsWooloo {
  public fullName = 'Hop\'s WoolooIR JTG';
  public setNumber = '170';
}

export class VolcanionexFA extends Volcanionex {
  public fullName = 'Volcanion exFA JTG';
  public setNumber = '171';
}

export class IonosBelliboltexFA extends IonosBelliboltex {
  public fullName = 'Iono\'s Bellibolt exFA JTG';
  public setNumber = '172';
}

export class LilliesClefairyexFA extends LilliesClefairyex {
  public fullName = 'Lillie\'s Clefairy exFA JTG';
  public setNumber = '173';
}

export class MamoswineexFA extends Mamoswineex {
  public fullName = 'Mamoswine exFA JTG';
  public setNumber = '174';
}

export class NsZoroarkexFA extends NsZoroarkex {
  public fullName = 'N\'s Zoroark exFA JTG';
  public setNumber = '175';
}

export class HopsZacianexFA extends HopsZacianex {
  public fullName = 'Hop\'s Zacian exFA JTG';
  public setNumber = '176';
}

export class SalamenceexFA extends Salamenceex {
  public fullName = 'Salamence exFA JTG';
  public setNumber = '177';
}

export class DudunsparceexFA extends Dudunsparceex {
  public regulationMark = 'I';
  public fullName = 'Dudunsparce exFA JTG';
  public setNumber = '178';
}

export class BrocksRecruitmentFA extends BrocksScouting {
  public fullName = 'Brock\'s RecruitmentFA JTG';
  public setNumber = '179';
}

export class IrisFightingSpiritFA extends IrisFightingSpirit {
  public fullName = 'Iris\'s Fighting SpiritFA JTG';
  public setNumber = '180';
}

export class RuffianFA extends Ruffian {
  public fullName = 'RuffianFA JTG';
  public setNumber = '181';
}

export class VolcanionexSIR extends Volcanionex {
  public fullName = 'Volcanion exSIR JTG';
  public setNumber = '182';
}

export class IonosBelliboltexSIR extends IonosBelliboltex {
  public fullName = 'Iono\'s Bellibolt exSIR JTG';
  public setNumber = '183';
}

export class LilliesClefairyexSIR extends LilliesClefairyex {
  public fullName = 'Lillie\'s Clefairy exSIR JTG';
  public setNumber = '184';
}

export class NsZoroarkexSIR extends NsZoroarkex {
  public fullName = 'N\'s Zoroark exSIR JTG';
  public setNumber = '185';
}

export class HopsZacianexSIR extends HopsZacianex {
  public fullName = 'Hop\'s Zacian exSIR JTG';
  public setNumber = '186';
}

export class SalamenceexSIR extends Salamenceex {
  public fullName = 'Salamence exSIR JTG';
  public setNumber = '187';
}

export class IonosBelliboltexUR extends IonosBelliboltex {
  public fullName = 'Iono\'s Bellibolt exUR JTG';
  public setNumber = '188';
}

export class NsZoroarkexUR extends NsZoroarkex {
  public fullName = 'N\'s Zoroark exUR JTG';
  public setNumber = '189';
}

export class SpikeEnergyUR extends SpikyEnergy {
  public fullName = 'Spike EnergyUR JTG';
  public setNumber = '190';
}

export class ProfessorsResearchJTG extends ProfessorsResearch {
  public set = 'JTG';
  public setNumber = '155';
  public name = 'Professor\'s Research';
  public fullName = 'Professor\'s Research JTG';
}

export class BlackBeltsTrainingJTG extends BlackBeltsTraining {
  public set = 'JTG';
  public setNumber = '145';
  public name = 'Black Belt\'s Training';
  public fullName = 'Black Belt\'s Training JTG';
}