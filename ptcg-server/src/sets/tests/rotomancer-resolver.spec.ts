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

  it('reports unmapped for a prefix with no Twinleaf set code', () => {
    // me4 (a future Mega-era set) is not yet mapped — me1/me2/me2pt5/me3 now are.
    const r = resolvePrinting('me4-1', 'Whatever');
    expect(r.status).toBe('unmapped');
  });

  it('resolves the newly-mapped Mega-era sets (me2pt5 → ASC, me3 → POR)', () => {
    expect(resolvePrinting('me3-65', 'Diggersby').status).toBe('exact');            // POR-65
    expect(resolvePrinting('me2pt5-22', 'Mega Charizard Y ex').status).toBe('exact'); // ASC-22 (loader fix)
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
