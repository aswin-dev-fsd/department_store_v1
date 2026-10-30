// The i18n gate (D-25, Task 6.9): every UI label comes from the dictionary (frontend/src/i18n),
// so a Tamil dictionary (FP-07) needs no screen changes. Scans frontend/src/**/*.tsx (tests
// excepted) with the TypeScript parser and fails, listing file:line, for:
// - literal text between JSX tags, or a string literal as a JSX child ({'Save'});
// - a literal placeholder, title, alt, aria-label or aria-description value.
// Text without a letter (₹, /, ×, —, ·, digits) is not a label and passes. Run: npm run check:i18n
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const ROOT = join(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'frontend', 'src');
const LABEL_ATTRIBUTES = new Set(['placeholder', 'title', 'alt', 'aria-label', 'aria-description']);

/** Words that are not UI text in any language; add one only with a reason beside it. */
const ALLOWED = new Set([]);

const HAS_LETTER = /\p{L}/u;

/** Every .tsx file under `dir`, tests left out. */
function tsxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : [];
  });
}

/** Whether `text` reads as words a person would see. */
function isLabel(text) {
  const trimmed = text.trim();
  return trimmed !== '' && HAS_LETTER.test(trimmed) && !ALLOWED.has(trimmed);
}

/** A literal string an attribute or child holds directly, or null. */
function literalOf(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node) && node.expression) return literalOf(node.expression);
  return null;
}

const problems = [];

for (const file of tsxFiles(SOURCE)) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const report = (node, what, value) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    problems.push(
      `${relative(ROOT, file).replaceAll('\\', '/')}:${line + 1}  ${what}: ${JSON.stringify(value.trim())}`,
    );
  };

  const visit = (node) => {
    if (ts.isJsxText(node) && isLabel(node.text)) {
      report(node, 'text', node.text);
    } else if (
      ts.isJsxExpression(node) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      const value = literalOf(node);
      if (value !== null && isLabel(value)) report(node, 'text', value);
    } else if (ts.isJsxAttribute(node) && LABEL_ATTRIBUTES.has(node.name.getText(source))) {
      const value = literalOf(node.initializer);
      if (value !== null && isLabel(value)) report(node, node.name.getText(source), value);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

// Plain stream writes: this is a command-line check, not app code, and console.* is linted out
if (problems.length > 0) {
  process.stderr.write(
    `UI text outside the dictionary (${problems.length}). Move it to en.ts and use t():\n`,
  );
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  process.exit(1);
}
process.stdout.write('check:i18n: every UI label comes from the dictionary.\n');
