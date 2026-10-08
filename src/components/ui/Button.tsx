import type { ButtonHTMLAttributes, Ref } from 'react';

type Variant = 'primary' | 'success' | 'danger' | 'secondary';

const variants: Record<Variant, string> = {
  primary: 'bg-action text-white hover:bg-action-hover',
  success: 'bg-success text-white hover:bg-success-hover',
  danger: 'bg-danger text-white hover:bg-danger-hover',
  secondary: 'border border-line bg-surface text-ink hover:bg-info-soft',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  ref?: Ref<HTMLButtonElement>;
}

/** Default touch-target height, used only when the caller does not set its own min-h-*. */
const hasOwnMinHeight = (cls: string) => /(^|\s)(?:[a-z]+:)?min-h-/.test(cls);

export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: Props) {
  // Two competing min-h-* utilities are resolved by CSS order, not by class order, so the
  // default must be left out whenever a larger one is requested.
  const minHeight = hasOwnMinHeight(className) ? '' : 'min-h-touch';
  return (
    <button
      type={type}
      className={`inline-flex ${minHeight} items-center justify-center rounded-md px-5 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}
