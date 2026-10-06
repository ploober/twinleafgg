import { handleCards } from '../http/handlers';
import { UnsupportedFormatError } from '../formats';

/**
 * TA-649: `GET /v1/cards/{setCode}` requires `format` (openapi: `required: true`, CF-85). A request without it read as
 * `standard` (the CF-85 rollout bridge for boards), answering a standard-only list with 200; it is now a malformed
 * request (400 via UnsupportedFormatError), as rotomancer answers.
 */
describe('TA-649: the card list requires a format', () => {
  it('no format: refused as unsupportedFormat [TA-649]', () => {
    expect(() => handleCards('sve', undefined)).toThrowError(UnsupportedFormatError);
  });
  it('control: format unlimited lists the set [TA-649]', () => {
    expect(handleCards('sve', 'unlimited').cards.length).toBeGreaterThan(0);
  });
});
