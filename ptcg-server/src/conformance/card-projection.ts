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
import { CardType, SuperType, Stage, TrainerType, EnergyType } from '../game/store/card/card-types';
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

/** Trainer sub-classification (OpenAPI `Card.category`) — aligned to `card-data/final`'s `category`
 *  vocabulary so the harness can validate it as a direct field compare. An old-style "Technical
 *  Machine" is a TrainerType.ITEM carrying the CardTag.TECHNICAL_MACHINE marker in `tags`, so it
 *  projects as `Item` here (the harness reconciles the TM case via the tag). */
const TRAINER_CATEGORY_NAMES: { [k: number]: string } = {
  [TrainerType.ITEM]: 'Item',
  [TrainerType.SUPPORTER]: 'Supporter',
  [TrainerType.STADIUM]: 'Stadium',
  [TrainerType.TOOL]: 'Tool',
};

/** Energy sub-classification (OpenAPI `Card.category`) — `card-data/final` spells these `Basic Energy`
 *  / `Special Energy` (not the bare enum), so mirror that spelling. */
const ENERGY_CATEGORY_NAMES: { [k: number]: string } = {
  [EnergyType.BASIC]: 'Basic Energy',
  [EnergyType.SPECIAL]: 'Special Energy',
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

/**
 * TA-295 — a fossil's rule box, recovered as `text`.
 *
 * TA-257 correctly stopped emitting the `isFossil` power as an ABILITY (canonical and rotomancer
 * both list only the real Ability, so emitting it made all in-pool Antique Fossils deviate from the
 * oracle by a phantom ability named after the card). But filtering it dropped it from the wire
 * ENTIRELY, and canonical does carry it — as the card's rule-box `text`. The result was that the one
 * sentence making a Fossil play as a Pokemon reached the wire in NEITHER field, on all six in-pool
 * Fossils: nothing observable said the card has 60 HP, is Colorless, can't retreat, can't take
 * Special Conditions, or can be discarded at will. That is the exact TA-272/B.37 cast, and a spec
 * author reading /v1/cards could not author a B.37 cell from it at all.
 */
function fossilRuleBox(powers: Power[] | undefined): string | undefined {
  const fossil = (powers ?? []).find(p => p.isFossil && p.text);
  return fossil ? norm(fossil.text) : undefined;
}

function projectAbilities(powers: Power[] | undefined): NeutralAbility[] | undefined {
  if (!powers || powers.length === 0) { return undefined; }
  // TA-257: a fossil's play-as-a-Pokemon/discard-from-play rule is modeled as an `isFossil` power
  // so the engine can offer the discard action, but on the CARD it is rule-box text, not an
  // Ability — the canonical golden data and rotomancer both list only the real Ability. Emitting
  // it here made all 4 in-pool Antique Fossils deviate from the oracle by a phantom ability named
  // after the card itself.
  const out = powers.filter(p => p.name && !p.isFossil).map(p => {
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
  // Rule-box / mechanical-class markers live on the base Card (`tags`, populated with CardTag enum
  // values by ~1780 set files — the modern field; the legacy `PokemonCard.cardTag` is used by ~18).
  // Applies to every supertype (ex/V/Tera on Pokémon, ACE SPEC/Team Plasma on Trainers, Prism Star on
  // Energy). Emitted verbatim (no silent cap); the harness scopes which markers it corroborates.
  if (card.tags && card.tags.length) { out.tags = [...card.tags]; }

  if (card.superType === SuperType.POKEMON) {
    const p = card as PokemonCard;
    const stage = STAGE_NAMES[p.stage];
    if (stage) { out.stage = stage; }
    out.hp = p.hp;
    // Version-agnostic: upstream 7a35128f0 (2026-08-30) turned `cardType` into `CardType[]` and
    // removed `additionalCardTypes`. This lens is grafted onto EVERY ref the pristine-witness dumper
    // samples (tools/dump_twinleaf_ref.py), so it must read both shapes identically.
    const shape = p as unknown as { cardType: CardType | CardType[]; additionalCardTypes?: CardType[] };
    const types = ([] as CardType[]).concat(shape.cardType, shape.additionalCardTypes ?? []).map(typeName);
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
    const category = TRAINER_CATEGORY_NAMES[t.trainerType];
    if (category) { out.category = category; }
    // a fossil carries no `text` of its own; its rule box lives on the isFossil power (TA-295)
    const text = norm(t.text) ?? fossilRuleBox(t.powers);
    if (text) { out.text = text; }
    const abilities = projectAbilities(t.powers);
    if (abilities) { out.abilities = abilities; }
    const attacks = projectAttacks(t.attacks);
    if (attacks) { out.attacks = attacks; }
  } else if (card.superType === SuperType.ENERGY) {
    const e = card as EnergyCard;
    const category = ENERGY_CATEGORY_NAMES[e.energyType];
    if (category) { out.category = category; }
    const text = norm(e.text);
    if (text) { out.text = text; }
  }
  return out;
}
