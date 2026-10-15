import { describe, expect, it } from 'vitest';
import { likePattern } from './like.js';

describe('likePattern', () => {
  it('wraps the term in % so it matches anywhere in the text', () => {
    expect(likePattern('rice')).toBe('%rice%');
  });

  it('escapes % and _ so they stand for themselves', () => {
    expect(likePattern('100%')).toBe('%100\\%%');
    expect(likePattern('a_b')).toBe('%a\\_b%');
  });

  it('escapes the escape character itself', () => {
    expect(likePattern('a\\b')).toBe('%a\\\\b%');
  });

  it('escapes every occurrence', () => {
    expect(likePattern('%_%')).toBe('%\\%\\_\\%%');
  });

  it('leaves everything else alone, in any script', () => {
    expect(likePattern("O'Neil (1 kg) [x] *? அரிசி")).toBe("%O'Neil (1 kg) [x] *? அரிசி%");
  });

  it('turns an empty term into a pattern that matches everything', () => {
    expect(likePattern('')).toBe('%%');
  });
});
