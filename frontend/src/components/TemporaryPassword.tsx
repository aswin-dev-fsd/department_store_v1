import { useEffect, useId, useRef, useState } from 'react';
import { copyText } from '../lib/clipboard';
import { t } from '../i18n/t';
import { Button } from './ui';

interface TemporaryPasswordProps {
  title: string;
  password: string;
  onDone: () => void;
}

/**
 * Shows a one-time temporary password with a Copy button. It takes focus when it appears, and
 * stays until the Admin presses Done: once gone it cannot be looked up again.
 */
export function TemporaryPassword({ title, password, onDone }: TemporaryPasswordProps) {
  const headingId = useId();
  const card = useRef<HTMLElement>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    card.current?.focus();
  }, []);

  async function copyPassword() {
    setCopy((await copyText(password)) ? 'copied' : 'failed');
  }

  return (
    <section
      ref={card}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="rounded-lg border-2 border-blue-700 bg-blue-50 p-5 focus:outline-none"
    >
      <h2 id={headingId} className="text-lg font-semibold">
        {title}
      </h2>
      <p className="mt-1 text-sm text-slate-700">{t('tempPassword.note')}</p>
      <p className="my-4">
        <code className="select-all rounded bg-white px-3 py-2 font-mono text-xl tracking-wider">
          {password}
        </code>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void copyPassword()}>{t('tempPassword.copy')}</Button>
        <Button variant="secondary" onClick={onDone}>
          {t('tempPassword.done')}
        </Button>
        <span role="status" className="text-sm text-slate-800">
          {copy === 'copied' && t('tempPassword.copied')}
          {copy === 'failed' && t('tempPassword.copyFailed')}
        </span>
      </div>
    </section>
  );
}
