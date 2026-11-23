import { Game } from '../src/game/Game';
import { Card, Category, SpecialSpace } from '../src/types';

/**
 * A game in which the card holder always keeps the first card drawn, at once: for tests about
 * the other rules (choosing the card is tested with Game itself).
 */
export class QuickGame extends Game {
  start(by: string, goal?: number): void {
    super.start(by, goal);
    this.takeCard();
  }

  nextRound(by: string): void {
    super.nextRound(by);
    this.takeCard();
  }

  private takeCard(): void {
    const round = this.viewFor('', 'en').round;
    if (round && !round.cardChosen) this.chooseCard(round.holderId);
  }
}

export function makeCard(n: number, category: Category = 'thing'): Card {
  return {
    id: `${category}-test-${n}`,
    category,
    answer: { en: `Answer ${n}`, pt: `Resposta ${n}` },
    aliases: { en: [`alias ${n}`], pt: [] },
    tips: {
      en: Array.from({ length: 20 }, (_, i) => `Card ${n} tip ${i + 1}`),
      pt: Array.from({ length: 20 }, (_, i) => `Carta ${n} dica ${i + 1}`),
    },
  };
}

export const testCards: Card[] = [makeCard(1), makeCard(2, 'place'), makeCard(3, 'person')];

/** A "random" source that always returns 0, so tests know who holds the first card and which card it is. */
export const zero = () => 0;

/** A board without special spaces, for tests about the plain rules. */
export const noSpecials = (): SpecialSpace[] => [];
