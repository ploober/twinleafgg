import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';

export class TeamRocketsNidoranMale extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public tags = [CardTag.TEAM_ROCKET];
  public cardType: CardType = D;
  public hp: number = 70;
  public weakness = [{ type: F }];
  public retreat = [C];

  public attacks = [{
    name: 'Pierce',
    cost: [D],
    damage: 10,
    text: ''
  },
  {
    // TA-245: printed cost is [D][C], not [D][D]. All five canonical sources agree
    // (limitless, pkmncards, pokemontcg-io, scrydex, tcgdex) and so does rotomancer's
    // card data; twinleaf was the lone dissenter. The wrong cost manufactured RE-103,
    // a filed "rotomancer accepts a typed cost paid by any Energy" finding — their
    // engine was correctly letting a Water pay the Colorless.
    name: 'Hammer In',
    cost: [D, C],
    damage: 30,
    text: ''
  }];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public setNumber: string = '117';
  public cardImage: string = 'assets/cardback.png';
  // TA-261: canonical (and every printed card) writes the gender glyph with NO space before it —
  // "Nidoran♀"/"Nidoran♂". The spaced form is a twinleaf-only orthography, and `evolvesFrom` is a
  // STRING MATCH, so the name and the two evolvesFrom references must move together or Nidorina /
  // Nidorino stop evolving. fullName (…"Nidoran F DRI"/"Nidoran M DRI") is the identity key and is
  // deliberately untouched.
  public name: string = "Team Rocket's Nidoran♂";
  public fullName: string = "Team Rocket's Nidoran M DRI";
}
