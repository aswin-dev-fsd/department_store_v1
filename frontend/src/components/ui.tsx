import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

// Small building blocks shared by every screen. Controls are 44px tall so they work with
// a finger on a counter tablet as well as a mouse.

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

/** What a form control needs to be linked to its label, hint and error. */
interface ControlProps {
  id: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
  /** Border, colours and focus ring; each control adds its own size. */
  className: string;
}

interface FieldFrameProps {
  label: string;
  error: string | undefined;
  hint: string | undefined;
  children: (control: ControlProps) => ReactNode;
}

/** A label above a control, with an optional hint and error below, wired for screen readers. */
function FieldFrame({ label, error, hint, children }: FieldFrameProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">
        {label}
      </label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
        className: `w-full rounded-md border bg-white px-3 text-base text-slate-900 read-only:bg-slate-100 ${
          error ? 'border-red-600' : 'border-slate-400'
        } ${focusRing}`,
      })}
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

interface TextFieldProps extends FieldProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {}

/** A labelled text input with an optional hint and error. */
export function TextField({ label, error, hint, className = '', ...input }: TextFieldProps) {
  return (
    <FieldFrame label={label} error={error} hint={hint}>
      {(control) => (
        <input {...input} {...control} className={`h-11 ${control.className} ${className}`} />
      )}
    </FieldFrame>
  );
}

interface TextAreaFieldProps
  extends FieldProps, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {}

/** A labelled multi-line input with an optional hint and error. */
export function TextAreaField({
  label,
  error,
  hint,
  className = '',
  ...input
}: TextAreaFieldProps) {
  return (
    <FieldFrame label={label} error={error} hint={hint}>
      {(control) => (
        <textarea
          rows={3}
          {...input}
          {...control}
          className={`min-h-24 py-2 ${control.className} ${className}`}
        />
      )}
    </FieldFrame>
  );
}

interface SelectFieldProps
  extends FieldProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {}

/** A labelled drop-down with an optional hint and error; pass the <option>s as children. */
export function SelectField({
  label,
  error,
  hint,
  className = '',
  children,
  ...select
}: SelectFieldProps) {
  return (
    <FieldFrame label={label} error={error} hint={hint}>
      {(control) => (
        <select {...select} {...control} className={`h-11 ${control.className} ${className}`}>
          {children}
        </select>
      )}
    </FieldFrame>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-blue-700 text-white hover:bg-blue-800 disabled:bg-blue-300',
  secondary:
    'border border-slate-400 bg-white text-slate-900 hover:bg-slate-100 disabled:text-slate-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300',
};

/** A 44px button. Type defaults to "button" so it never submits a form by accident. */
export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      className={`inline-flex h-11 items-center justify-center rounded-md px-4 text-base font-medium disabled:cursor-not-allowed ${buttonStyles[variant]} ${focusRing} ${className}`}
    />
  );
}

/** A problem message; announced to screen readers as soon as it appears. */
export function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {children}
    </p>
  );
}

/** A neutral or positive message; announced politely. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900"
    >
      {children}
    </p>
  );
}

/** A white panel for a screen's main content. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </section>
  );
}
