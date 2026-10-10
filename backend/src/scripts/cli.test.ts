import { describe, expect, it } from 'vitest';
import { CliUsageError } from './cli.js';

describe('CliUsageError', () => {
  it('lists every problem, one per line, and is still an Error', () => {
    const error = new CliUsageError(['--username is required', '--other: bad value']);
    expect(error).toBeInstanceOf(Error);
    expect(error.problems).toEqual(['--username is required', '--other: bad value']);
    expect(error.message).toBe('--username is required\n--other: bad value');
    expect(error.name).toBe('CliUsageError');
  });
});
