/**
 * A LIKE / ILIKE pattern that matches `term` anywhere in the text. The characters LIKE treats as
 * wildcards (% and _) and its escape character (\) are escaped, so a search for "100%" means
 * those characters and not "100 followed by anything".
 */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}
