/**
 * Dump the engine-neutral printed data (`NeutralCard`) of every loadable card, keyed by conformance
 * `printing`, to JSON on stdout — the same projection the live `GET /v1/cards/{setCode}` endpoint
 * serves (both go through `projectCard`, so they can't drift). Consumed by the pmtcg-conformance-tests
 * card-data validator (`tools/validate_card_data.py --dump <file>`), which compares it against the
 * canonical `card-data/final` — so data defects like TA-20 (Karrablast retreat), TA-21 (Steaming
 * Stomp cost) and TA-32 (Hop's Silicobra hp) are caught wholesale instead of one fuzz divergence at
 * a time.
 *
 *   npx ts-node src/conformance/tools/dump-card-stats.ts > /tmp/twinleaf-card-stats.json
 */
import { CardManager } from '../../game/cards/card-manager';
import { loadAllSets } from '../../sets/tests/test-helpers';
import { projectCard } from '../card-projection';
import { toPrinting } from '../printing';
import { NeutralCard } from '../neutral-types';

loadAllSets();
const out: { [printing: string]: NeutralCard } = {};
// A printing-keyed map SILENTLY OVERWRITES: several twinleaf cards share a `set`+`setNumber`, so one
// wins and the rest vanish with no error. `set`/`setNumber` are immutable identity keys (never edit
// them), so these collisions are permanent — but a dump that quietly loses ~79 cards reads as
// "complete coverage" when it isn't. That blind spot hid a real bug (`Nidorino MEW` evolvesFrom '♂'
// was overwritten by Nidorina at mew-033) from the offline invariant checker; only a spec running
// against the registry itself caught it. So: never truncate silently — report what was dropped, and
// run STRUCTURAL checks against `CardManager`, not against this dump.
const dropped: string[] = [];
for (const card of CardManager.getInstance().getAllCards()) {
  const printing = toPrinting(card);
  if (out[printing] !== undefined) {
    dropped.push(`${printing}: ${card.fullName} (kept ${out[printing].name})`);
    continue;
  }
  out[printing] = projectCard(card);
}
if (dropped.length > 0) {
  process.stderr.write(
    `[dump-card-stats] ${dropped.length} card(s) DROPPED by printing-key collision ` +
    `(${Object.keys(out).length} emitted). These are invisible to any printing-keyed analysis:\n` +
    dropped.map(d => `  - ${d}\n`).join(''));
}
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
