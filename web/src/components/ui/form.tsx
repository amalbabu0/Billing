import { forwardRef, useEffect, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle, Search, X } from 'lucide-react';

interface FieldProps { label?: ReactNode; hint?: ReactNode; error?: string; required?: boolean; optional?: boolean; children: (id: string, describedBy?: string) => ReactNode; className?: string }

/** Label + control + hint/error, wired for screen readers (aria-describedby, aria-invalid). */
export function Field({ label, hint, error, required, optional, children, className = '' }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}{required && <span className="req" aria-hidden>*</span>}{optional && <span className="opt">optional</span>}
        </label>
      )}
      {children(id, describedBy)}
      {error ? <div className="field-error" id={`${id}-err`} role="alert"><AlertCircle aria-hidden />{error}</div>
        : hint ? <div className="field-hint" id={`${id}-hint`}>{hint}</div> : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string; optional?: boolean; left?: ReactNode; prefix?: string; wrapClass?: string };

export const TextInput = forwardRef<HTMLInputElement, InputProps>(function TextInput({ label, hint, error, optional, left, prefix, className = '', wrapClass = '', required, ...rest }, ref) {
  return (
    <Field label={label} hint={hint} error={error} required={required} optional={optional} className={wrapClass}>
      {(id, d) => (
        <div className={`input-wrap${left ? ' has-left' : ''}${prefix ? ' has-prefix' : ''}`}>
          {left && <span className="adorn" aria-hidden>{left}</span>}
          {prefix && <span className="adorn" aria-hidden>{prefix}</span>}
          <input ref={ref} id={id} className={`input ${className}`} aria-invalid={error ? true : undefined} aria-describedby={d} required={required} {...rest} />
        </div>
      )}
    </Field>
  );
});

/**
 * Number input that keeps what the user types (so "12." or "" are allowed mid-edit) and reports numbers.
 * Money fields show the ₹ prefix and right-align digits.
 */
export function NumberInput({ value, onChange, money, label, hint, error, min, max, step, placeholder, className = '', wrapClass = '', required, optional, disabled, autoFocus, id: idProp, ...rest }: {
  value: number | null | undefined; onChange: (v: number | null) => void; money?: boolean; label?: ReactNode; hint?: ReactNode; error?: string; min?: number; max?: number;
  step?: number; placeholder?: string; className?: string; wrapClass?: string; required?: boolean; optional?: boolean; disabled?: boolean; autoFocus?: boolean; id?: string;
  'aria-label'?: string; onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; onBlur?: () => void; selectOnFocus?: boolean;
}) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => {
    const parsed = text.trim() === '' ? null : Number(text.replace(/,/g, ''));
    if (parsed !== (value ?? null)) setText(value === null || value === undefined ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const { selectOnFocus, onKeyDown, onBlur, ...aria } = rest;
  const input = (id: string, d?: string) => (
    <div className={`input-wrap${money ? ' has-prefix' : ''}`}>
      {money && <span className="adorn" aria-hidden>₹</span>}
      <input
        id={idProp ?? id} className={`input num ${className}`} inputMode="decimal" autoComplete="off" value={text} placeholder={placeholder} disabled={disabled}
        aria-invalid={error ? true : undefined} aria-describedby={d} required={required} autoFocus={autoFocus} {...aria}
        onFocus={e => selectOnFocus !== false && e.currentTarget.select()}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onChange={e => {
          const t = e.target.value.replace(/[^\d.,-]/g, '');
          setText(t);
          if (t.trim() === '' || t === '-') { onChange(null); return; }
          let n = Number(t.replace(/,/g, ''));
          if (Number.isNaN(n)) return;
          if (min !== undefined && n < min) n = min;
          if (max !== undefined && n > max) n = max;
          onChange(n);
        }}
        step={step}
      />
    </div>
  );
  if (!label && !hint && !error) return input('');
  return <Field label={label} hint={hint} error={error} required={required} optional={optional} className={wrapClass}>{input}</Field>;
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; hint?: ReactNode; error?: string; optional?: boolean; options?: { value: string | number; label: string; disabled?: boolean }[]; placeholder?: string; wrapClass?: string };

export function Select({ label, hint, error, optional, options, placeholder, children, className = '', wrapClass = '', required, ...rest }: SelectProps) {
  const ownId = useId();
  const control = (id: string, d?: string) => (
    <select id={id} className={`select ${className}`} aria-invalid={error ? true : undefined} aria-describedby={d} required={required} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options?.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      {children}
    </select>
  );
  if (!label && !hint && !error) return control(rest.id ?? ownId);
  return <Field label={label} hint={hint} error={error} required={required} optional={optional} className={wrapClass}>{control}</Field>;
}

export function TextArea({ label, hint, error, optional, className = '', required, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode; error?: string; optional?: boolean }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} optional={optional}>
      {(id, d) => <textarea id={id} className={`textarea ${className}`} aria-invalid={error ? true : undefined} aria-describedby={d} required={required} {...rest} />}
    </Field>
  );
}

export function Checkbox({ label, checked, onChange, disabled, indeterminate, hint }: { label?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; indeterminate?: boolean; hint?: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} ref={el => { if (el) el.indeterminate = !!indeterminate; }} />
      {label && <span>{label}{hint && <span className="field-hint" style={{ display: 'block' }}>{hint}</span>}</span>}
    </label>
  );
}

export function Switch({ label, checked, onChange, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="stack gap-1"><span>{label}</span>{hint && <span className="field-hint">{hint}</span>}</span>
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search', className = '', autoFocus, inputRef, onKeyDown, label }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean; inputRef?: React.Ref<HTMLInputElement>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; label?: string;
}) {
  return (
    <div className={`input-wrap has-left search ${className}`}>
      <span className="adorn" aria-hidden><Search /></span>
      <input
        ref={inputRef} className="input" type="search" value={value} placeholder={placeholder} autoFocus={autoFocus} aria-label={label ?? placeholder}
        onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown} autoComplete="off" spellCheck={false}
      />
      {value && (
        <span className="adorn-right">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onChange('')} aria-label="Clear search"><X /></button>
        </span>
      )}
    </div>
  );
}

/** Helper to read field errors from an ApiError-like object with camelCase keys. */
export function fieldError(errors: Record<string, string> | undefined, key: string) {
  if (!errors) return undefined;
  return errors[key] ?? errors[key.charAt(0).toLowerCase() + key.slice(1)];
}
