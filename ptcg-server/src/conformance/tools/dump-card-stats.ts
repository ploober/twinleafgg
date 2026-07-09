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
for (const card of CardManager.getInstance().getAllCards()) {
  out[toPrinting(card)] = projectCard(card);
}
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
