// Shared plumbing for the operator command-line tasks in this folder.

/** Print one line to stdout. Scripts stick to plain ASCII, so output reads correctly in any Windows terminal. */
export const out = (line = ''): void => {
  process.stdout.write(`${line}\n`);
};

/** Print one line to stderr. */
export const fail = (line = ''): void => {
  process.stderr.write(`${line}\n`);
};

/** Bad command-line arguments; `problems` lists everything wrong, one line each. */
export class CliUsageError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems.join('\n'));
    this.name = 'CliUsageError';
    this.problems = problems;
  }
}
