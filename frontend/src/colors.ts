import type { PlayerColor } from './types';

/** How each token colour is painted: the fill, and a letter colour that reads well on it. */
export const TOKEN_COLORS: Record<PlayerColor, { bg: string; fg: string }> = {
  red: { bg: '#ef4444', fg: '#ffffff' },
  orange: { bg: '#f97316', fg: '#ffffff' },
  yellow: { bg: '#facc15', fg: '#1e293b' },
  lime: { bg: '#a3e635', fg: '#1e293b' },
  green: { bg: '#16a34a', fg: '#ffffff' },
  teal: { bg: '#2dd4bf', fg: '#1e293b' },
  sky: { bg: '#7dd3fc', fg: '#1e293b' },
  blue: { bg: '#2563eb', fg: '#ffffff' },
  purple: { bg: '#9333ea', fg: '#ffffff' },
  pink: { bg: '#f472b6', fg: '#1e293b' },
  brown: { bg: '#92400e', fg: '#ffffff' },
  white: { bg: '#f8fafc', fg: '#1e293b' },
};

/** The letter shown on a player's token: the first character of their name, in capitals. */
export function initial(name: string): string {
  const first = Array.from(name.trim())[0] ?? '?';
  return first.toUpperCase();
}
