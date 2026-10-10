import { en, type MessageKey } from './en';

const dictionary: Record<MessageKey, string> = en;

/**
 * Look up a UI label and fill its {placeholders}. Keys come from en.ts, so a typo is a
 * compile error. Unknown placeholders stay visible so they get noticed.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = dictionary[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}
