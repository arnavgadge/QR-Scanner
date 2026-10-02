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

export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-touch items-center justify-center rounded-md px-5 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}
