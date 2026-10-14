import { en, type MessageKey } from './en';

const dictionary: Record<MessageKey, string> = en;

/** Whether `key` is a label in the dictionary — for keys built at runtime, e.g. from an error code. */
export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(dictionary, key);
}

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
