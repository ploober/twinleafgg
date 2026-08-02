/**
 * probe-playability.ts — read the engine's OWN `player.playableCardIds` and diff it against the
 * `legalActions` the conformance adapter enumerates.
 *
 * WHY THIS EXISTS
 * ---------------
 * `playableCardIds` is what a real client glows from (ptcg-play hand.component `isCardPlayable`,
 * the React board services). It is filled by `Store.calculatePlayability` -> `CAN_PLAY_CARD`, and it
 * is **never projected onto `/v1/step`** — the adapter substitutes `trainerPlayable`, which
 * deliberately over-reports past `CAN_PLAY_CARD` because `playCardAction` accepts cards that
 * `CAN_PLAY_TRAINER_CARD` defaults to `false`. So the surface a player actually sees is invisible to
 * the whole cross-engine differential, and no conformance test can reach it. This probe can.
 *
 * It also exists because deriving playability by PARSING CARD SOURCE is unreliable: reprints are
 * subclasses that override `setNumber` while inheriting `set`, so a naive `(set, setNumber)` scan
 * silently drops them and mislabels inherited `canPlay` as absent. Ask the engine instead.
 *
 * Usage:  npx ts-node src/conformance/tools/probe-playability.ts <seed-dir>
 */
import * as fs from 'fs';
import * as path from 'path';
import { importState } from '../state-adapter';
import { topLevelMenu } from '../legal-actions';

const dir = process.argv[2];
const files = fs.readdirSync(dir).filter(f => f.startsWith('tr-') && f.includes('-bench-'));
let divergent = 0, agree = 0;
const rows: string[] = [];
for (const f of files) {
  const seed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  let g;
  try { g = importState(seed.initialState); } catch { continue; }
  let state;
  try { state = (g.store as any).calculatePlayability(g.state); } catch { continue; }
  const idToIid = new Map<number, string>();
  g.ctx.cardToIid.forEach((iid: string, card: any) => idToIid.set(card.id, iid));
  const p = state.players[0];
  const playable = new Set(p.playableCardIds.map((id: number) => idToIid.get(id)));
  let offered = new Set<string>();
  try {
    const menu: any = topLevelMenu(g);
    for (const a of (menu && menu.legalActions) || []) {
      if (a.type && String(a.type).startsWith('play') && a.card) offered.add(a.card);
    }
  } catch { continue; }
  const subject = (seed.initialState.players.A.hand[0] || {}).iid;
  const inOffered = offered.has(subject), inPlayable = playable.has(subject);
  if (inOffered !== inPlayable) { divergent++; rows.push(`${f.replace('.json','')}  legalActions=${inOffered} playableCardIds=${inPlayable}`); }
  else agree++;
}
console.log(`boards probed: ${divergent + agree}   AGREE: ${agree}   DIVERGE: ${divergent}`);
rows.slice(0, 15).forEach(r => console.log('   ' + r));
