import { errorMessage } from '../api/errors';
import { t } from '../i18n/t';
import { Button, ErrorAlert } from './ui';

/** Why a list or form could not load, with a button to try again. */
export function QueryProblem({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <ErrorAlert>{errorMessage(error)}</ErrorAlert>
      <Button variant="secondary" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}
