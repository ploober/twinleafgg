import { importState } from '../state-adapter';
import { topLevelMenu } from '../legal-actions';
import { materializeNeutral } from './support/scenario-runner';
import { StateLog } from '../../game/store/state/state-log';
import { GameLog } from '../../game/game-message';
import { conformanceSnapshotBackend } from '../conformance-store';

describe('Conformance menu probes with append-only history', () => {
  it('shares frozen historical entries, isolates the log array, and preserves the offered menu', () => {
    const game = importState(materializeNeutral({
      turn: 3,
      players: {
        A: {
          active: { card: 'jtg-068', energy: ['sve-005'] },
          bench: [{ card: 'asc-004' }],
          hand: ['meg-130'], deck: ['sve-005'], prizeCount: 6,
        },
        B: { active: { card: 'asc-004' }, deck: ['sve-005'], prizeCount: 6 },
      },
    }));
    const before = topLevelMenu(game);
    const history = new StateLog(GameLog.LOG_PLAYER_ENDS_TURN, { name: 'A' });
    Object.freeze(history.params);
    Object.freeze(history);
    game.state.logs.push(...Array(256).fill(history));
    const backend = conformanceSnapshotBackend();
    const original = backend.capture;
    let checked = 0;
    spyOn(backend, 'capture').and.callFake((source: any, effect: any, site: any, pins?: ReadonlyArray<object>) => {
      const copy = original.call(backend, source, effect, site, pins);
      if (source === game.state) {
        checked++;
        expect(copy.state.logs).not.toBe(game.state.logs);
        expect(copy.state.logs[0]).toBe(history);
      }
      return copy;
    });
    expect(topLevelMenu(game)).toEqual(before);
    expect(checked).toBeGreaterThan(0);
    expect(game.state.logs.length).toBe(256);
    expect(history.params).toEqual({ name: 'A' });
  });
});
