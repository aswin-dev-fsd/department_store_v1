import { describe, expect, it } from 'vitest';
import { CliUsageError } from './cli.js';
import { parseResetArgs } from './reset-password.js';

function problemsOf(argv: string[]): string[] {
  try {
    parseResetArgs(argv);
  } catch (error) {
    expect(error).toBeInstanceOf(CliUsageError);
    return (error as CliUsageError).problems;
  }
  throw new Error('expected parseResetArgs to throw');
}

describe('parseResetArgs', () => {
  it('reads --username, trimmed and lower-cased', () => {
    expect(parseResetArgs(['--username', '  Admin '])).toEqual({
      kind: 'run',
      input: { username: 'admin' },
    });
    expect(parseResetArgs(['--username=Ravi.K'])).toEqual({
      kind: 'run',
      input: { username: 'ravi.k' },
    });
  });

  it('answers --help without needing a username', () => {
    expect(parseResetArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseResetArgs(['-h'])).toEqual({ kind: 'help' });
  });

  it('says what is missing or wrong', () => {
    expect(problemsOf([])).toEqual(['--username is required']);
    expect(problemsOf(['--username', 'a b'])[0]).toMatch(/^--username: .*3.32 characters/);
  });

  it('rejects unknown options, stray words and an option without its value', () => {
    expect(problemsOf(['--username', 'admin', '--password', 'x'])[0]).toMatch(/--password/);
    expect(problemsOf(['--username', 'admin', 'stray'])[0]).toMatch(/stray/);
    expect(problemsOf(['--username'])[0]).toMatch(/username/);
  });
});
