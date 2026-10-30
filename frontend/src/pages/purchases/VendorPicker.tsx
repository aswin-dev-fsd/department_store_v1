import type { Vendor } from '@ds/shared';
import { useId, useState, type KeyboardEvent } from 'react';
import { t } from '../../i18n/t';

/** How many matches the list shows at once. */
const MAX_SHOWN = 8;

interface VendorPickerProps {
  /** The branch's active vendors. */
  vendors: readonly Pick<Vendor, 'id' | 'name'>[];
  /** The chosen vendor's id as text; empty while none is chosen. */
  value: string;
  onChange: (vendorId: string) => void;
  error?: string | undefined;
}

/**
 * One box to choose the vendor: type a few letters of the name and pick from the matches below
 * with a click, or the arrow keys and Enter. Enter on a pick also moves on to the next box (the
 * editor's Enter-to-move); editing the name again clears the choice until a vendor is picked.
 */
export function VendorPicker({ vendors, value, onChange, error }: VendorPickerProps) {
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const chosen = vendors.find((vendor) => String(vendor.id) === value);
  // What the person is typing; null shows the chosen vendor's name
  const [typed, setTyped] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const text = typed ?? chosen?.name ?? '';
  const query = (typed ?? '').trim().toLowerCase();
  const matches = vendors
    .filter((vendor) => vendor.name.toLowerCase().includes(query))
    .slice(0, MAX_SHOWN);
  const showList = open && matches.length > 0;

  function pick(vendor: Pick<Vendor, 'id' | 'name'>) {
    onChange(String(vendor.id));
    setTyped(null);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp' && showList) {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Escape' && showList) {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Enter' && showList && matches[active] && typed !== null) {
      // Picks, then lets the editor move on to the next box
      pick(matches[active]);
    }
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">
        {t('purchases.vendor')}
      </label>
      <input
        id={id}
        type="text"
        name="vendor"
        data-entry=""
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        value={text}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          // Leaving a half-typed name shows the chosen vendor again (or nothing)
          if (value !== '') setTyped(null);
        }}
        onChange={(event) => {
          setTyped(event.target.value);
          setOpen(true);
          setActive(0);
          if (value !== '') onChange('');
        }}
        onKeyDown={onKeyDown}
        className={`h-11 w-full rounded-md border bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
          error ? 'border-red-600' : 'border-slate-400'
        }`}
      />
      <p id={hintId} className="mt-1 text-sm text-slate-600">
        {vendors.length === 0
          ? t('purchases.noVendors')
          : typed !== null && query !== '' && matches.length === 0
            ? t('purchases.vendorNoMatch', { text: typed.trim() })
            : t('purchases.vendorHint')}
      </p>
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('purchases.vendorMatches')}
          className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-slate-300 bg-white shadow-lg"
        >
          {matches.map((vendor, index) => (
            <li
              key={vendor.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                // Keep the focus in the box
                event.preventDefault();
                pick(vendor);
              }}
              className={`cursor-pointer px-3 py-2 ${index === active ? 'bg-blue-100' : ''}`}
            >
              {vendor.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
