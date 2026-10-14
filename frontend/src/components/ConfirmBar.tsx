import { useId } from 'react';
import { t } from '../i18n/t';
import { Button, ErrorAlert } from './ui';

interface ConfirmBarProps {
  /** What will happen, in a sentence. */
  message: string;
  confirmLabel: string;
  /** A request is in flight. */
  busy?: boolean;
  /** Why the last attempt failed, if it did. */
  error?: string | null | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * An inline "are you sure?" for actions with consequences (deactivating someone, resetting a
 * password). Cancel has the focus, so an accidental Enter does nothing.
 */
export function ConfirmBar({
  message,
  confirmLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmBarProps) {
  const messageId = useId();
  return (
    <div
      role="group"
      aria-labelledby={messageId}
      className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4"
    >
      <p id={messageId} className="mb-3 text-sm text-amber-950">
        {message}
      </p>
      {error && (
        <div className="mb-3">
          <ErrorAlert>{error}</ErrorAlert>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" autoFocus onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
