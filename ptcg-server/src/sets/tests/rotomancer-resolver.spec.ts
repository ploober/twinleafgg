import { resolvePrinting, normalizeName } from './rotomancer/bridge';

describe('Rotomancer printing resolver — exact / mismatch / unmapped buckets', () => {

  it('resolves an sv-era printing exactly when the name matches', () => {
    const r = resolvePrinting('sv8-87', 'Dedenne');
    expect(r.status).toBe('exact');
    expect(r.fullName).toBe('Dedenne SSP');
  });

  it('resolves exactly without a name (set + number only)', () => {
    const r = resolvePrinting('sv8-116');
    expect(r.status).toBe('exact');
    expect(r.fullName).toBe('Koraidon SSP');
  });

  it('reports mismatch when the resolved card name differs (printing/number drift)', () => {
    // SV11W-135 is not Terrakion in Twinleaf (Terrakion is SV11W-54) — number drift.
    const r = resolvePrinting('rsv10pt5-135', 'Terrakion');
    expect(r.status).toBe('mismatch');
    expect(r.fullName).toBeUndefined();
  });

  it('reports unmapped for the deferred Mega-Evolution block', () => {
    const r = resolvePrinting('me2pt5-148', 'Kingambit');
    expect(r.status).toBe('unmapped');
  });

  it('reports mismatch for a number with no card in the mapped set', () => {
    const r = resolvePrinting('sv8-99999', 'Nonesuch');
    expect(r.status).toBe('mismatch');
  });

  it('normalizes names across punctuation, case, and accents', () => {
    expect(normalizeName("Team Rocket's Ampharos")).toBe('teamrocketsampharos');
    expect(normalizeName('Flabébé')).toBe('flabebe');
    expect(normalizeName('Iron Boulder ex')).toBe('ironboulderex');
  });
});
