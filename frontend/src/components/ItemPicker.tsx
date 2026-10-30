import type { Item, Page } from '@ds/shared';
import { useId, useState, type KeyboardEvent, type Ref } from 'react';
import { api, ApiError } from '../api/client';
import { errorMessage } from '../api/errors';
import { t } from '../i18n/t';
import { itemLookupPaths, itemSearchPath } from '../purchases/paths';

interface ItemPickerProps {
  /** Runs with the chosen item; the box then empties, ready for the next one. */
  onPick: (item: Item) => void;
  label?: string;
  /** Lets the screen put the cursor back here (e.g. after the last field of a line). */
  inputRef?: Ref<HTMLInputElement>;
}

/** The exact item for a scanned barcode or typed code, or null when neither matches. */
async function findExact(text: string): Promise<Item | null> {
  for (const path of itemLookupPaths(text)) {
    try {
      return await api.get<Item>(path);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
  }
  return null;
}

/**
 * Pick an active item of the branch, the fast way first: scan a barcode or type a code and press
 * Enter. If nothing matches exactly, the text is searched in names, codes and barcodes and the
 * matches are listed: arrow keys move, Enter picks, Escape closes. Used by purchases and billing.
 */
export function ItemPicker({ onPick, label = t('picker.label'), inputRef }: ItemPickerProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState('');
  const [matches, setMatches] = useState<Item[] | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function pick(item: Item) {
    onPick(item);
    setText('');
    setMatches(null);
    setProblem(null);
  }

  async function find() {
    const query = text.trim();
    if (query === '' || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const exact = await findExact(query);
      if (exact) {
        pick(exact);
        return;
      }
      const page = await api.get<Page<Item>>(itemSearchPath(query));
      if (page.items.length === 0) {
        setProblem(t('picker.noMatch', { text: query }));
      } else {
        setMatches(page.items);
        setActive(0);
      }
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (matches && event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, matches.length - 1));
    } else if (matches && event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (matches && event.key === 'Escape') {
      event.preventDefault();
      setMatches(null);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (matches && matches[active]) pick(matches[active]);
      else void find();
    }
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={matches !== null}
        aria-controls={listId}
        aria-activedescendant={matches ? `${listId}-${active}` : undefined}
        aria-describedby={`${id}-hint`}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setMatches(null);
          setProblem(null);
        }}
        onKeyDown={onKeyDown}
        className="h-11 w-full rounded-md border border-slate-400 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      />
      <p id={`${id}-hint`} className="mt-1 text-sm text-slate-600">
        {busy ? t('picker.searching') : t('picker.hint')}
      </p>
      {problem && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {problem}
        </p>
      )}
      {matches && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('picker.matches')}
          className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-slate-300 bg-white shadow-lg"
        >
          {matches.map((item, index) => (
            <li
              key={item.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                // Keep the focus in the box, so typing can continue after the pick
                event.preventDefault();
                pick(item);
              }}
              className={`cursor-pointer px-3 py-2 ${index === active ? 'bg-blue-100' : ''}`}
            >
              <span className="font-medium">{item.name}</span>{' '}
              <span className="text-sm text-slate-600">
                {t('picker.codeLine', { code: item.code })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
