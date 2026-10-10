import { describe, expect, it } from 'vitest';
import { parseSetupArgs, SetupArgsError } from './setup-client.js';

const full = [
  '--business-name',
  'Demo Stores',
  '--admin-username',
  'admin',
  '--admin-name',
  'Store Admin',
];

function problemsOf(argv: string[]): string[] {
  try {
    parseSetupArgs(argv);
  } catch (error) {
    expect(error).toBeInstanceOf(SetupArgsError);
    return (error as SetupArgsError).problems;
  }
  throw new Error('expected parseSetupArgs to throw');
}

describe('parseSetupArgs', () => {
  it('reads the three options', () => {
    expect(parseSetupArgs(full)).toEqual({
      kind: 'run',
      input: { businessName: 'Demo Stores', adminUsername: 'admin', adminFullName: 'Store Admin' },
    });
  });

  it('accepts --option=value, and trims and lower-cases the username', () => {
    expect(
      parseSetupArgs([
        '--business-name=Demo Stores',
        '--admin-username=  Admin ',
        '--admin-name=Ravi',
      ]),
    ).toEqual({
      kind: 'run',
      input: { businessName: 'Demo Stores', adminUsername: 'admin', adminFullName: 'Ravi' },
    });
  });

  it('keeps Tamil business and admin names intact', () => {
    const parsed = parseSetupArgs([
      '--business-name',
      'கோவை ஸ்டோர்ஸ்',
      '--admin-username',
      'admin',
      '--admin-name',
      'ரவி குமார்',
    ]);
    expect(parsed).toMatchObject({
      input: { businessName: 'கோவை ஸ்டோர்ஸ்', adminFullName: 'ரவி குமார்' },
    });
  });

  it('answers --help without needing the other options', () => {
    expect(parseSetupArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseSetupArgs(['-h'])).toEqual({ kind: 'help' });
  });

  it('lists every missing option at once', () => {
    expect(problemsOf([])).toEqual([
      '--business-name is required',
      '--admin-username is required',
      '--admin-name is required',
    ]);
    expect(problemsOf(['--business-name', 'Demo'])).toEqual([
      '--admin-username is required',
      '--admin-name is required',
    ]);
  });

  it('explains an invalid value with the option it belongs to', () => {
    const problems = problemsOf([
      '--business-name',
      '   ',
      '--admin-username',
      'a b',
      '--admin-name',
      'Admin',
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^--business-name: /);
    expect(problems[1]).toMatch(/^--admin-username: .*3.32 characters/);
  });

  it('rejects unknown options and stray words', () => {
    expect(problemsOf([...full, '--password', 'x'])[0]).toMatch(/--password/);
    expect(problemsOf([...full, 'stray'])[0]).toMatch(/stray/);
  });

  it('rejects an option given without its value', () => {
    expect(problemsOf(['--business-name'])[0]).toMatch(/business-name/);
  });
});
