export class Rules {

  public firstTurnDrawCard = true;

  public firstTurnUseSupporter = true;

  public attackFirstTurn = false;

  // If true, supporters remain in the play zone until end-turn cleanup.
  public supporterCleanupAtEndTurn = false;

  public unlimitedEnergyAttachments = false;

  public alternativeSetup = false;

  // When both players win at the same time in the SAME number of ways. Rulebook: "If this happens, play a
  // tiebreaker game." true (every real game) = start the tiebreaker game. false = the game ends as a tie: the
  // conformance contract scores the tied game itself (outcome `tie`), and its tiebreaker is a new game outside
  // any scenario, so the conformance importer sets this false. TA-561, 2026-10-01.
  public tiebreakerGame = true;

  constructor(init: Partial<Rules> = {}) {
    Object.assign(this, init);
  }

}
