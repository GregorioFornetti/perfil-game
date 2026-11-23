import { type GameView, type PlayerView, type SpecialKind } from './types';

// Small questions the screens ask about the state the server sends.

export function playerById(view: GameView, id: string | null | undefined): PlayerView | undefined {
  return view.players.find((p) => p.id === id);
}

export function me(view: GameView): PlayerView | undefined {
  return playerById(view, view.you);
}

export function isHost(view: GameView): boolean {
  return view.hostId === view.you;
}

export function isHolder(view: GameView): boolean {
  return view.round?.holderId === view.you;
}

export function isMyTurn(view: GameView): boolean {
  return view.round?.turnId === view.you;
}

export function canPickTip(view: GameView, index: number): boolean {
  const round = view.round!;
  return (
    view.phase === 'choosing' &&
    round.cardChosen &&
    isMyTurn(view) &&
    !round.revealed.includes(index) &&
    round.revealed.length < round.maxTips
  );
}

export function canGuess(view: GameView): boolean {
  return view.phase === 'guessing' && isMyTurn(view);
}

/** Spaces a right guess would be worth with the tips currently on the table. */
export function guessWorth(view: GameView): number {
  const round = view.round;
  if (!round) return 0;
  // while picking, the guess will come after one more tip
  const tips = Math.min(round.maxTips, Math.max(1, round.revealed.length + (view.phase === 'guessing' ? 0 : 1)));
  const table = round.kind === 'individual' ? view.settings.scoring.individual : view.settings.scoring.guesser;
  return table[tips - 1] ?? 0;
}

/** The spaces an individual question is worth after 1 to 5 tips, as {p1 ... p5} for the translations. */
export function individualPointsParams(view: GameView): Record<string, number> {
  return Object.fromEntries(view.settings.scoring.individual.map((points, i) => [`p${i + 1}`, points]));
}

export function isIndividual(view: GameView): boolean {
  return view.round?.kind === 'individual';
}

/** The host or the card holder may cancel an individual question whose player is away. */
export function canSkipIndividual(view: GameView): boolean {
  if (!isIndividual(view) || (view.phase !== 'choosing' && view.phase !== 'guessing')) return false;
  if (playerById(view, view.round!.turnId)?.connected) return false;
  return isHost(view) || isHolder(view);
}

/** The kind of special space at a position of the board, if it is one. */
export function specialAt(view: GameView, index: number): SpecialKind | undefined {
  return view.specials.find((s) => s.index === index)?.kind;
}

export function connectedCount(view: GameView): number {
  return view.players.filter((p) => p.connected).length;
}

/** Players from the one furthest along the track to the last. */
export function ranking(view: GameView): PlayerView[] {
  return [...view.players].sort((a, b) => b.position - a.position);
}

/** Who may press "next round": the host, the player who held the card, or who answered an individual question. */
export function canStartNextRound(view: GameView): boolean {
  const r = view.result;
  return view.phase === 'roundEnd' && (isHost(view) || r?.holderId === view.you || r?.solverId === view.you);
}

/** Ids of guesses the card holder may still count as right. */
export function acceptableGuessIds(view: GameView): number[] {
  if (!view.round || !isHolder(view)) return [];
  const playing = view.phase === 'choosing' || view.phase === 'guessing';
  const justMissed = (view.phase === 'roundEnd' || view.phase === 'finished') && view.result?.reason === 'noTipsLeft';
  if (!playing && !justMissed) return [];
  return view.round.guesses.filter((g) => !g.correct && playerById(view, g.playerId)).map((g) => g.id);
}
