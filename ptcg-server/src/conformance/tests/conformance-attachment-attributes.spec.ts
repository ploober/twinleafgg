import * as fs from 'fs';
import * as path from 'path';
import { step } from '../driver';
import { NeutralAction, NeutralState } from '../neutral-types';
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/okidogi-clawitzer/cases.json'), 'utf8'));
describe('Attachment consequence answers [TA-828]', () => {
  for (const c of cases) {
    const offered = c.expected.menu?.find((a: any) => a.type === 'choose' && a.recipient);
    if (!offered) { continue; }
    for (const op of [undefined, 'attach', 'discard']) {
      it(c.id + ' op=' + op, () => {
        const actions: NeutralAction[] = [...c.request.actions, { ...offered, op }];
        const r = step(c.request.initialState as NeutralState, actions);
        expect(r.applied).toBe(actions.length - (op === 'discard' ? 1 : 0));
        if (op === 'discard') { expect(r.status).toBe('invalidAction'); }
        else { expect(r.status).not.toBe('invalidAction'); }
      });
    }
  }
});
