import { MoveDamagePrompt, DamageTransfer } from '../../game/store/prompts/move-damage-prompt';
import { CardTarget } from '../../game/store/actions/play-card-action';
import { LegalAction } from '../neutral-types';
import {
  PromptDecomposer, WirePick, realPicks, hasDone, buildPending, END_CHOICE, enumerateTargets, targetKey
} from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget } from '../iid-targets';

const COUNTER = 10;

/**
 * MoveDamagePrompt: relocating a damage counter has no single contract Action (there is no
 * `moveCounter`/`removeCounter`), so each transfer decomposes into TWO picks (design R2): a
 * `choose{target}` naming the SOURCE Pokemon, then a `placeCounter{target}` naming the DESTINATION.
 * Removing the counter from the source is a state consequence (the source's `damage` drops), not a
 * decision. Picks alternate source,dest,source,dest…; `assemble` pairs them into DamageTransfer[].
 */

/** The (from,to) transfers completed so far, pairing the alternating source/dest picks. */
function pairTransfers(rp: WirePick[]): Array<{ from: CardTarget; to: CardTarget }> {
  const transfers: Array<{ from: CardTarget; to: CardTarget }> = [];
  for (let k = 0; k + 1 < rp.length; k += 2) {
    transfers.push({
      from: (rp[k] as { target: CardTarget }).target,
      to: (rp[k + 1] as { target: CardTarget }).target,
    });
  }
  return transfers;
}

export const moveDamageDecomposer: PromptDecomposer<MoveDamagePrompt> = {
  type: 'Move damage',

  next(prompt, picks, ctx, state) {
    if (hasDone(picks)) {
      return null;
    }
    const rp = realPicks(picks);
    const { min, max } = prompt.options;
    const atSourceStep = rp.length % 2 === 0; // even count → choose a source next; odd → choose its dest
    const transfers = pairTransfers(rp);
    if (atSourceStep && max !== undefined && transfers.length >= max) {
      return null; // reached the max number of transfers, at a transfer boundary
    }

    const player = promptPlayer(state, prompt.playerId);
    const firstFrom = transfers.length > 0 ? targetKey(transfers[0].from) : undefined;
    const firstTo = transfers.length > 0 ? targetKey(transfers[0].to) : undefined;
    const legalActions: LegalAction[] = [];

    if (atSourceStep) {
      // Offer SOURCES: maxAllowedDamage entries with movable damage remaining (cap − 10 × prior moves).
      const blockedFromKeys = new Set(prompt.options.blockedFrom.map(targetKey));
      const movedFrom = new Map<string, number>();
      transfers.forEach(t => {
        const k = targetKey(t.from);
        movedFrom.set(k, (movedFrom.get(k) ?? 0) + COUNTER);
      });
      for (const entry of prompt.maxAllowedDamage) {
        const k = targetKey(entry.target);
        if (blockedFromKeys.has(k) || entry.damage <= 0) { continue; }
        if ((movedFrom.get(k) ?? 0) >= entry.damage) { continue; }
        if (prompt.options.singleSourceTarget && firstFrom !== undefined && k !== firstFrom) { continue; }
        legalActions.push({ type: 'choose', target: pokemonTargetToIid(state, player, ctx, entry.target) });
      }
      if (transfers.length >= min) {
        legalActions.push(END_CHOICE);
      }
    } else {
      // Mid-transfer: a source was just chosen; offer its DESTINATIONS (any in-play target but itself).
      const source = (rp[rp.length - 1] as { target: CardTarget }).target;
      const sourceKey = targetKey(source);
      const dests = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blockedTo)
        .filter(t => targetKey(t) !== sourceKey)
        .filter(t => !(prompt.options.singleDestinationTarget && firstTo !== undefined && targetKey(t) !== firstTo));
      for (const dest of dests) {
        legalActions.push({ type: 'placeCounter', target: pokemonTargetToIid(state, player, ctx, dest) });
      }
    }

    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(_prompt, action, ctx, state) {
    const player = promptPlayer(state, _prompt.playerId);
    if (action.type === 'choose') { // a SOURCE pick
      const card = ctx.iidToCard.get(action.target as string);
      if (card === undefined) {
        throw new Error(`[conformance] MoveDamage source iid '${action.target}' unknown`);
      }
      return { kind: 'target', target: resolveAnyPokemonTarget(state, player, card) };
    }
    if (action.type === 'placeCounter') { // a DESTINATION pick
      const card = ctx.iidToCard.get(action.target as string);
      if (card === undefined) {
        throw new Error(`[conformance] MoveDamage destination iid '${action.target}' unknown`);
      }
      return { kind: 'counter', target: resolveAnyPokemonTarget(state, player, card) };
    }
    throw new Error(`[conformance] MoveDamage expected 'choose'/'placeCounter', got '${action.type}'`);
  },

  assemble(_prompt, picks): DamageTransfer[] {
    return pairTransfers(realPicks(picks));
  },
};
