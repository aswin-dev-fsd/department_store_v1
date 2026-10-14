import { isMessageKey, t } from '../i18n/t';
import { ApiError } from './client';

/**
 * Text to show a person for a failed call. Order: the dictionary text for the error code,
 * then the server's own wording for a refusal (4xx) whose code is new to the dictionary,
 * then a generic line. A server fault (5xx) never shows server wording.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const key = `error.${error.code}`;
    if (isMessageKey(key)) return t(key);
    if (error.status >= 400 && error.status < 500 && error.message) return error.message;
  }
  return t('error.generic');
}
