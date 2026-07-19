/* Diagnostic: run the in-process step() driver on a crash-repro scenario and print the full stack. */
import * as fs from 'fs';
import { step } from '../driver';

const path = process.argv[2];
const nact = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
const sc = JSON.parse(fs.readFileSync(path, 'utf8'));
let actions = sc.actions ?? [];
if (nact !== undefined) { actions = actions.slice(0, nact); }
try {
  const r = step(sc.initialState, actions);
  console.log('NO CRASH — status', r.status, 'applied', (r as { applied?: number }).applied);
  console.log('legalActions', (r.pending?.legalActions ?? []).map((a: { type: string }) => a.type));
} catch (err) {
  console.log('CRASH:', (err as Error).message);
  console.log((err as Error).stack);
}
