import { useId, type InputHTMLAttributes, type Ref } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string;
  /** 'code' = large monospace upper-case (serial numbers). */
  variant?: 'text' | 'code';
  ref?: Ref<HTMLInputElement>;
}

export function TextField({
  label,
  error,
  hint,
  id,
  variant = 'text',
  className = '',
  ...rest
}: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-semibold">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`mt-1 ${/(^|\s)min-h-/.test(className) ? '' : 'min-h-14'} w-full rounded-md border bg-surface px-3 ${variant === 'code' ? 'font-mono text-xl uppercase' : 'text-lg'} ${
          error ? 'border-danger' : 'border-line'
        } ${className}`}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
