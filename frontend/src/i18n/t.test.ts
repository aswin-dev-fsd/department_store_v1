import { describe, expect, it } from 'vitest';
import { t } from './t';

describe('t', () => {
  it('returns the English label for a key', () => {
    expect(t('status.title')).toBe('System status');
  });

  it('fills {placeholders} from params', () => {
    expect(t('status.apiLine', { status: 'ok' })).toBe('API: ok');
  });

  it('leaves unknown placeholders visible so they get noticed', () => {
    expect(t('status.apiLine', {})).toBe('API: {status}');
  });

  it('rejects unknown keys at compile time', () => {
    // @ts-expect-error — 'no.such.key' is not in en.ts; check-types fails if this ever compiles
    const unknownKey = () => t('no.such.key');
    expect(unknownKey).toBeTypeOf('function');
  });
});
