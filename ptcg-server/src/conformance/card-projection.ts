/**
 * Project a twinleaf `Card` to the engine-neutral `NeutralCard` (OpenAPI `Card`) served by
 * `GET /v1/cards/{setCode}`. Field-aligned to the harness's canonical `card-data/final/<code>.json`
 * so validation is a direct field compare. Optional fields are OMITTED when twinleaf does not model
 * them (rarity/illustrator/image are never modeled; hp/types/retreat/… apply only to Pokémon).
 *
 * This is the single source of the twinleaf card-data projection — both the live endpoint
 * (cards.ts) and the offline dumper (tools/dump-card-stats.ts) go through `projectCard`, so they
 * can't drift.
 */
import { Card } from '../game/store/card/card';
import { PokemonCard } from '../game/store/card/pokemon-card';
import { TrainerCard } from '../game/store/card/trainer-card';
import { EnergyCard } from '../game/store/card/energy-card';
import { CardType, SuperType, Stage } from '../game/store/card/card-types';
import { PowerType, Attack, Power, Weakness, Resistance } from '../game/store/card/pokemon-types';
import { NeutralCard, NeutralAttack, NeutralAbility, NeutralTypeValue } from './neutral-types';
import { toPrinting } from './printing';

/** The 11 real Energy types → canonical (pokemontcg.io-style) names. Card-specific CardType enum
 * members (auras, tags) are not Energy types and surface as `?<n>` — they never appear in a real
 * cost/type/weakness, so they never reach the wire. */
export const TYPE_NAMES: { [k: number]: string } = {
  [CardType.GRASS]: 'Grass',
  [CardType.FIRE]: 'Fire',
  [CardType.WATER]: 'Water',
  [CardType.LIGHTNING]: 'Lightning',
  [CardType.PSYCHIC]: 'Psychic',
  [CardType.FIGHTING]: 'Fighting',
  [CardType.DARK]: 'Darkness',
  [CardType.METAL]: 'Metal',
  [CardType.FAIRY]: 'Fairy',
  [CardType.DRAGON]: 'Dragon',
  [CardType.COLORLESS]: 'Colorless',
};

export function typeName(t: CardType): string {
  return TYPE_NAMES[t] ?? `?${t}`;
}

const SUPERTYPE_NAMES: { [k: number]: string } = {
  [SuperType.POKEMON]: 'Pokémon',
  [SuperType.TRAINER]: 'Trainer',
  [SuperType.ENERGY]: 'Energy',
};

const STAGE_NAMES: { [k: number]: string } = {
  [Stage.BASIC]: 'Basic',
  [Stage.STAGE_1]: 'Stage 1',
  [Stage.STAGE_2]: 'Stage 2',
  [Stage.VMAX]: 'VMAX',
  [Stage.VSTAR]: 'VSTAR',
  [Stage.VUNION]: 'V-UNION',
  [Stage.LEGEND]: 'LEGEND',
  [Stage.MEGA]: 'Mega',
  [Stage.BREAK]: 'BREAK',
  [Stage.LV_X]: 'LEVEL-UP',
  [Stage.RESTORED]: 'Restored',
};

const POWER_TYPE_NAMES: { [k: number]: string } = {
  [PowerType.ABILITY]: 'Ability',
  [PowerType.POKEPOWER]: 'Poké-Power',
  [PowerType.POKEBODY]: 'Poké-Body',
};

/** Collapse runtime whitespace (twinleaf uses `'   '` placeholders for blank text); omit if empty. */
function norm(text: string | undefined): string | undefined {
  if (!text) { return undefined; }
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length ? s : undefined;
}

/** Reconstruct the printed damage string from twinleaf's `damage` (number) + `damageCalculation`
 * (`'+'`/`'×'`/…). No-damage attacks (0, no calc) → omitted. `×`-attacks that store 0 render as
 * `"0×"`; the validator tolerates that against a canonical `"20×"`. */
function attackDamage(a: Attack): string | undefined {
  const calc = a.damageCalculation ?? '';
  if (!a.damage && !calc) { return undefined; }
  return `${a.damage}${calc}`;
}

function projectAttacks(attacks: Attack[] | undefined): NeutralAttack[] | undefined {
  if (!attacks || attacks.length === 0) { return undefined; }
  return attacks.map(a => {
    const out: NeutralAttack = { name: a.name, cost: (a.cost ?? []).map(typeName) };
    const dmg = attackDamage(a);
    if (dmg !== undefined) { out.damage = dmg; }
    const t = norm(a.text);
    if (t !== undefined) { out.text = t; }
    return out;
  });
}

function projectAbilities(powers: Power[] | undefined): NeutralAbility[] | undefined {
  if (!powers || powers.length === 0) { return undefined; }
  const out = powers.filter(p => p.name).map(p => {
    const a: NeutralAbility = { name: p.name };
    const t = norm(p.text);
    if (t !== undefined) { a.text = t; }
    const ty = POWER_TYPE_NAMES[p.powerType];
    if (ty !== undefined) { a.type = ty; }
    return a;
  });
  return out.length ? out : undefined;
}

/** twinleaf weakness `value` is undefined ⇒ ×2; a number ⇒ that multiplier (`×N`). */
function projectWeakness(ws: Weakness[] | undefined): NeutralTypeValue[] | undefined {
  if (!ws || ws.length === 0) { return undefined; }
  return ws.map(w => ({ type: typeName(w.type), value: w.value === undefined ? '×2' : `×${w.value}` }));
}

/** twinleaf resistance `value` is a signed reduction (e.g. -30) ⇒ rendered as-is. */
function projectResistance(rs: Resistance[] | undefined): NeutralTypeValue[] | undefined {
  if (!rs || rs.length === 0) { return undefined; }
  return rs.map(r => ({ type: typeName(r.type), value: String(r.value) }));
}

export function projectCard(card: Card): NeutralCard {
  const out: NeutralCard = {
    printing: toPrinting(card),
    name: card.name,
    supertype: SUPERTYPE_NAMES[card.superType] ?? 'Pokémon',
    setCode: card.set.toLowerCase(),
    number: card.setNumber,
  };
  if (card.regulationMark) { out.regulationMark = card.regulationMark; }

  if (card.superType === SuperType.POKEMON) {
    const p = card as PokemonCard;
    const stage = STAGE_NAMES[p.stage];
    if (stage) { out.stage = stage; }
    out.hp = p.hp;
    const types = [p.cardType, ...(p.additionalCardTypes ?? [])].map(typeName);
    if (types.length) { out.types = types; }
    if (p.evolvesFrom) { out.evolvesFrom = p.evolvesFrom; }
    const abilities = projectAbilities(p.powers);
    if (abilities) { out.abilities = abilities; }
    const attacks = projectAttacks(p.attacks);
    if (attacks) { out.attacks = attacks; }
    const weakness = projectWeakness(p.weakness);
    if (weakness) { out.weakness = weakness; }
    const resistance = projectResistance(p.resistance);
    if (resistance) { out.resistance = resistance; }
    out.retreat = (p.retreat ?? []).length;
  } else if (card.superType === SuperType.TRAINER) {
    const t = card as TrainerCard;
    const text = norm(t.text);
    if (text) { out.text = text; }
    const abilities = projectAbilities(t.powers);
    if (abilities) { out.abilities = abilities; }
    const attacks = projectAttacks(t.attacks);
    if (attacks) { out.attacks = attacks; }
  } else if (card.superType === SuperType.ENERGY) {
    const e = card as EnergyCard;
    const text = norm(e.text);
    if (text) { out.text = text; }
  }
  return out;
}
