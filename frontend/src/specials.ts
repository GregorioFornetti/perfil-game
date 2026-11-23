import type { SpecialKind } from './types';

/** Look of the special spaces, used on the board, in its legend and in the game options. */
export const SPECIAL_STYLE: Record<SpecialKind, { icon: string; tile: string }> = {
  individual: { icon: '❓', tile: 'border-violet-300 bg-violet-600 text-violet-100' },
  back: { icon: '−5', tile: 'border-rose-300 bg-rose-700 text-rose-50' },
  forward: { icon: '+5', tile: 'border-emerald-300 bg-emerald-600 text-emerald-50' },
  dead: { icon: '💀', tile: 'border-slate-400 bg-black text-slate-300' },
  win: { icon: '🏆', tile: 'border-yellow-200 bg-yellow-400 text-slate-900' },
};
