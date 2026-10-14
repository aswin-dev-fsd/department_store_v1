import type { ReactNode } from 'react';

const TONES = {
  green: 'bg-green-100 text-green-900',
  grey: 'bg-slate-200 text-slate-800',
  amber: 'bg-amber-100 text-amber-900',
} as const;

/** A small label such as "Active". The words carry the meaning; the colour only backs them up. */
export function StatusBadge({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
