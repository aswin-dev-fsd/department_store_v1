import { describe, expect, it } from 'vitest';
import { isMessageKey, t } from './t';

describe('isMessageKey', () => {
  it('recognises keys that exist in the dictionary and nothing else', () => {
    expect(isMessageKey('status.title')).toBe(true);
    expect(isMessageKey('no.such.key')).toBe(false);
    // Inherited object properties are not keys
    expect(isMessageKey('toString')).toBe(false);
    expect(isMessageKey('__proto__')).toBe(false);
  });
});

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
