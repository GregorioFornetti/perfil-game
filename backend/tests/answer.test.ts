import { isCorrectGuess, levenshtein, normalize } from '../src/game/answer';
import { Card } from '../src/types';

const tips = Array.from({ length: 20 }, (_, i) => `tip ${i}`);
const tower: Card = {
  id: 'place-eiffel-tower',
  category: 'place',
  answer: { en: 'Eiffel Tower', pt: 'Torre Eiffel' },
  aliases: { en: ['la tour eiffel'], pt: [] },
  tips: { en: tips, pt: tips },
};
const year: Card = { ...tower, id: 'year-1969', category: 'year', answer: { en: '1969', pt: '1969' }, aliases: { en: [], pt: [] } };
const pele: Card = { ...tower, id: 'person-pele', category: 'person', answer: { en: 'Pelé', pt: 'Pelé' }, aliases: { en: [], pt: [] } };
const car: Card = { ...tower, id: 'thing-car', category: 'thing', answer: { en: 'Car', pt: 'Carro' }, aliases: { en: [], pt: [] } };

describe('normalize', () => {
  it('ignores case, accents, punctuation and a leading article', () => {
    expect(normalize('  The  Eiffel-Tower! ')).toBe('eiffel tower');
    expect(normalize('São Paulo')).toBe('sao paulo');
    expect(normalize('Um violão')).toBe('violao');
    expect(normalize('A')).toBe('a');
  });
});

describe('levenshtein', () => {
  it('counts edits', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});

describe('isCorrectGuess', () => {
  it('accepts the answer in either language and the aliases', () => {
    expect(isCorrectGuess(tower, 'eiffel tower')).toBe(true);
    expect(isCorrectGuess(tower, 'A Torre Eiffel')).toBe(true);
    expect(isCorrectGuess(tower, 'La Tour Eiffel')).toBe(true);
  });

  it('forgives small typos in longer answers', () => {
    expect(isCorrectGuess(tower, 'Eifel Tower')).toBe(true);
    expect(isCorrectGuess(tower, 'Eifel Towr')).toBe(true);
    expect(isCorrectGuess(tower, 'Tower')).toBe(false);
    expect(isCorrectGuess(tower, 'Tower of London')).toBe(false);
  });

  it('is strict with short answers and with numbers', () => {
    expect(isCorrectGuess(car, 'cat')).toBe(false);
    expect(isCorrectGuess(car, 'carro')).toBe(true);
    expect(isCorrectGuess(pele, 'pele')).toBe(true);
    expect(isCorrectGuess(year, '1969')).toBe(true);
    expect(isCorrectGuess(year, '1968')).toBe(false);
    expect(isCorrectGuess(year, 'in 1969')).toBe(false);
  });

  it('rejects empty guesses', () => {
    expect(isCorrectGuess(tower, '   ')).toBe(false);
    expect(isCorrectGuess(tower, '!!!')).toBe(false);
  });
});
