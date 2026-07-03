/**
 * Dump per-card mechanical stats (hp / retreat / weakness / attacks' name+cost+damage) for every
 * loadable card, keyed by conformance `printing`, to JSON on stdout. Consumed by the
 * pmtcg-conformance-tests card-stats audit (compares against canonical card-data — the adjudicated
 * source of truth) so data defects like TA-20 (Karrablast retreat), TA-21 (Steaming Stomp cost) and
 * TA-32 (Hop's Silicobra hp) are caught wholesale instead of one fuzz divergence at a time.
 *
 *   npx ts-node src/conformance/tools/dump-card-stats.ts > /tmp/twinleaf-card-stats.json
 */
import { CardManager } from '../../game/cards/card-manager';
import { PokemonCard } from '../../game/store/card/pokemon-card';
import { CardType, SuperType } from '../../game/store/card/card-types';
import { loadAllSets } from '../../sets/tests/test-helpers';
import { toPrinting } from '../printing';

const TYPE_NAMES: { [k: number]: string } = {
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

function typeName(t: CardType): string {
  return TYPE_NAMES[t] ?? `?${t}`;
}

loadAllSets();
const out: { [printing: string]: unknown } = {};
for (const card of CardManager.getInstance().getAllCards()) {
  if (card.superType !== SuperType.POKEMON) { continue; }
  const p = card as PokemonCard;
  out[toPrinting(card)] = {
    fullName: p.fullName,
    hp: p.hp,
    retreat: (p.retreat ?? []).length,
    weakness: (p.weakness ?? []).map(w => typeName(w.type)).sort(),
    attacks: (p.attacks ?? []).map(a => ({
      name: a.name,
      cost: (a.cost ?? []).map(typeName).sort(),
      damage: typeof a.damage === 'number' ? a.damage : parseInt(String(a.damage), 10) || 0,
    })),
  };
}
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
