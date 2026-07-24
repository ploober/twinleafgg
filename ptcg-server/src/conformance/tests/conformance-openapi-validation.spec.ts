import * as fs from 'fs';
import { step } from '../driver';
import { buildCapabilities } from '../capabilities';
import { buildCardsForSet } from '../cards';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, SCHEMA_VERSION } from '../neutral-types';
import { toPrinting } from '../printing';
import { getCardByName } from '../../sets/tests/test-helpers';

/**
 * Validate live adapter responses against the actual OpenAPI contract schemas (the source of truth,
 * `~/projects/pmtcg-conformance-tests/openapi/conformance-api.yaml`). Step 1 covers the response
 * envelope, `GameState`, `Capabilities`, and `Error`; Step 2a adds the `pending.legalActions[]`
 * action vocabulary (closed `Action` enum + required `actor`), validated via a full `awaitingAction`
 * response and each legalAction against `Action`; Step 2b adds the significant-event vocabulary,
 * validated via the turn-boundary `events[]` against `Event`. The full contract surface now validates.
 *
 * Skips when the cross-repo contract file is absent (e.g. CI without the conformance-tests checkout).
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Ajv = require('ajv');

const SPEC_PATH = `${process.env.HOME}/projects/pmtcg-conformance-tests/openapi/conformance-api.yaml`;
const SPEC_EXISTS = fs.existsSync(SPEC_PATH);

const RALTS = toPrinting(getCardByName('Ralts SIT'));
const WATER = toPrinting(getCardByName('Water Energy SVE'));

function flags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}
function pip(iid: string, printing: string, energy: { iid: string; printing: string }[] = []): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function side(active: PokemonInPlay, over: Partial<PlayerState> = {}): PlayerState {
  return {
    active, bench: [], hand: [], deck: [{ iid: `${active.stack[0].iid}-d`, printing: WATER }],
    discard: [], lostZone: [], prizes: [{ iid: `${active.stack[0].iid}-p`, printing: WATER, faceUp: false }], flags: flags(), ...over,
  };
}
const BOARD: NeutralState = {
  schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
  players: {
    A: side(pip('A-act', RALTS), { hand: [{ iid: 'A-e0', printing: WATER }, { iid: 'A-e1', printing: WATER }] }),
    B: side(pip('B-act', RALTS)),
  },
  activeEffects: [],
};

/**
 * The contract marks `stadium`/`active`/`pending` nullable via a DELIBERATE codegen convention (spec
 * §"Codegen conventions": a plain `$ref` + a nullable description, NOT `oneOf:[…,'null']`, because
 * openapi-generator 7.x's 3.1 support mishandles the union). A literal JSON-Schema validator therefore
 * rejects the `null` those fields permit at runtime, so we relax any `{$ref, description:"…null…"}`
 * property to also accept null — validating the convention's INTENT, not its generator-facing letter.
 */
function relaxNullableRefs(schemas: Record<string, any>): void {
  for (const schema of Object.values(schemas)) {
    if (!schema || !schema.properties) { continue; }
    for (const [key, prop] of Object.entries<any>(schema.properties)) {
      if (prop && prop.$ref && typeof prop.description === 'string' && /null/i.test(prop.description)) {
        schema.properties[key] = { description: prop.description, anyOf: [{ $ref: prop.$ref }, { type: 'null' }] };
      }
    }
  }
}

(SPEC_EXISTS ? describe : xdescribe)('Conformance — OpenAPI schema validation', () => {
  const spec = SPEC_EXISTS ? yaml.load(fs.readFileSync(SPEC_PATH, 'utf8')) : { components: { schemas: {} } };
  relaxNullableRefs(spec.components.schemas);
  const ajv = new Ajv({ allErrors: true });
  ajv.addSchema(spec, 'api');
  /** Validate `value` against component schema `name`; on failure, print the violations. */
  function check(name: string, value: unknown): boolean {
    const v = ajv.compile({ $ref: `api#/components/schemas/${name}` });
    const ok = v(value) as boolean;
    if (!ok) {
      // eslint-disable-next-line no-console
      console.log(`[${name}] schema violations:`, JSON.stringify(v.errors, null, 2));
    }
    return ok;
  }

  it('Capabilities validates', () => {
    expect(check('Capabilities', buildCapabilities())).toBe(true);
  });

  it('a GET /v1/cards response validates as CardList (and each entry as Card)', () => {
    const list = buildCardsForSet('sit');
    expect(check('CardList', list)).toBe(true);
    // every projected card independently satisfies the closed Card schema (additionalProperties:false)
    for (const card of list.cards) {
      expect(check('Card', card)).toBe(true);
    }
  });

  // Positive regression guard: the closed schema only rejects EXTRA fields, so it cannot catch the
  // projection silently DROPPING category/tags (the subtype gap this endpoint had for a long time —
  // both engines omitted subtype symmetrically, so a divergence was invisible). Assert they are emitted.
  it('projects category for every Trainer/Energy (and tags for rule-box Pokémon)', () => {
    const svi = buildCardsForSet('svi').cards;
    const TRAINER_CATS = new Set(['Item', 'Supporter', 'Stadium', 'Tool', 'Technical Machine']);
    const ENERGY_CATS = new Set(['Basic Energy', 'Special Energy']);
    for (const c of svi) {
      if (c.supertype === 'Trainer') {
        expect(TRAINER_CATS.has(c.category as string)).toBe(true);
      } else if (c.supertype === 'Energy') {
        expect(ENERGY_CATS.has(c.category as string)).toBe(true);
      } else {
        expect(c.category).toBeUndefined(); // Pokémon carry stage, not category
      }
    }
    // Arven is a Supporter; at least one printed `ex` Pokémon carries the `ex` rule-box tag (prize count).
    expect(svi.find(c => c.name === 'Arven')?.category).toBe('Supporter');
    expect(svi.some(c => (c.tags ?? []).includes('ex'))).toBe(true);
  });

  it('a successful step state validates as GameState', () => {
    expect(check('GameState', step(BOARD, []).state)).toBe(true);
  });

  it('an invalidAction response validates as StepResponse (full envelope, pending null)', () => {
    // a second energy attach in one turn → invalidAction (pending: null, so legalActions don't apply)
    const res = step(BOARD, [
      { actor: 'A', type: 'attachEnergy', card: 'A-e0', target: 'A-act' },
      { actor: 'A', type: 'attachEnergy', card: 'A-e1', target: 'A-act' },
    ]);
    expect(res.status).toBe('invalidAction');
    expect(check('StepResponse', res)).toBe(true);
  });

  it('an awaitingAction response validates as StepResponse (non-null pending + legalActions)', () => {
    // an empty log at a main-phase boundary surfaces the active player's top-level menu
    const res = step(BOARD, []);
    expect(res.status).toBe('awaitingAction');
    expect(res.pending).not.toBeNull();
    expect(res.pending!.legalActions.length).toBeGreaterThan(0);
    expect(check('StepResponse', res)).toBe(true);
  });

  it('every surfaced legalAction validates against the closed Action schema (actor + enum)', () => {
    const res = step(BOARD, []);
    for (const action of res.pending!.legalActions) {
      expect(check('Action', action)).toBe(true);
    }
  });

  it('a confirm legalAction validates against the Action schema (value: boolean)', () => {
    // ConfirmPrompt decomposes to both templates; both must validate against the contract `confirm`.
    expect(check('Action', { actor: 'A', type: 'confirm', value: true })).toBe(true);
    expect(check('Action', { actor: 'A', type: 'confirm', value: false })).toBe(true);
  });

  it('significant events validate against the Event schema (turnEnded/turnStarted/draw)', () => {
    // A ends the turn → B's turn starts and B draws: the turn boundary's significant events.
    const res = step(BOARD, [{ actor: 'A', type: 'endTurn' }]);
    const kinds = res.events.map(e => e.kind);
    expect(kinds).toContain('turnEnded');
    expect(kinds).toContain('turnStarted');
    expect(kinds).toContain('draw');
    for (const event of res.events) {
      expect(check('Event', event)).toBe(true);
    }
  });

  it('the Error body validates', () => {
    expect(check('Error', { error: 'malformedRequest', message: 'x' })).toBe(true);
    expect(check('Error', { error: 'unsupportedSchemaVersion' })).toBe(true);
  });
});
