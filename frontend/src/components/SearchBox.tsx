import { useState, type FormEvent } from 'react';
import { t } from '../i18n/t';
import { Button, TextField } from './ui';

interface SearchBoxProps {
  /** What the box looks for, as its label ("Search by name, code or barcode"). */
  label: string;
  /** The search now applied; empty when there is none. */
  applied: string;
  /** Runs when the person presses Enter or Search, or clears the search; the text is trimmed. */
  onSearch: (text: string) => void;
}

/**
 * A search box that searches when asked (Enter or the Search button), not on every keystroke,
 * so a slow connection is not asked a question per letter.
 */
export function SearchBox({ label, applied, onSearch }: SearchBoxProps) {
  const [text, setText] = useState(applied);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch(text.trim());
  }

  function clear() {
    setText('');
    onSearch('');
  }

  return (
    <form role="search" onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1">
        <TextField
          label={label}
          name="search"
          type="search"
          autoComplete="off"
          maxLength={100}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <Button type="submit">{t('common.search')}</Button>
      {(applied !== '' || text !== '') && (
        <Button variant="secondary" onClick={clear}>
          {t('common.clearSearch')}
        </Button>
      )}
    </form>
  );
}
