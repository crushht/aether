'use client';

import * as React from 'react';
import { cn, initialsOf } from '@/lib/utils';
import { CheckMark } from './icons';

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white shadow-[inset_0_1px_0_rgba(255,255,255,.14)] hover:bg-accent-hover active:bg-[#5560c4]',
  secondary:
    'bg-[var(--bg-active)] text-t2 hover:bg-[var(--bg-selected)] hover:text-t1 shadow-[inset_0_0_0_1px_var(--line-strong)]',
  ghost: 'bg-transparent text-t3 hover:bg-[var(--bg-hover)] hover:text-t1',
  danger: 'bg-[rgba(235,87,87,.1)] text-[#f08080] hover:bg-[rgba(235,87,87,.18)]',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-[26px] px-2 gap-1.5 text-[13.5px] rounded-r6',
  md: 'h-[30px] px-2.5 gap-1.5 text-mini rounded-r6',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-[510]',
        'transition-[background-color,color,box-shadow,opacity] duration-100 ease-out',
        'disabled:pointer-events-none disabled:opacity-40',
        buttonSizes[size],
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
});

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: number;
  shape?: 'circle' | 'square';
  variant?: 'ghost' | 'pill' | 'secondary';
  active?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, size = 28, shape = 'circle', variant = 'ghost', active, style, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'relative inline-grid shrink-0 place-items-center',
        'transition-[background-color,color,box-shadow] duration-100 ease-out',
        'disabled:pointer-events-none disabled:opacity-35',
        shape === 'circle' ? 'rounded-full' : 'rounded-r6',
        variant === 'ghost' && 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t2',
        variant === 'pill' &&
          'bg-[var(--bg-hover)] text-t3 shadow-[inset_0_0_0_1px_var(--line-subtle)] hover:bg-[var(--bg-active)] hover:text-t2',
        variant === 'secondary' &&
          'bg-[var(--bg-active)] text-t2 shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-[var(--bg-selected)]',
        active && 'bg-[var(--bg-selected)] text-t1',
        className,
      )}
      style={{ width: size, height: size, ...style }}
      {...props}
    />
  );
});

/** The 28px pill used across the view bar — measured from linear.app */
export function PillButton({
  className,
  active,
  ref,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex h-[30px] select-none items-center gap-1.5 rounded-full px-2 text-[13.5px] text-t3',
        'shadow-[inset_0_0_0_1px_var(--line-subtle)] transition-[background-color,color,box-shadow] duration-100 ease-out',
        'hover:bg-[var(--bg-active)] hover:text-t2',
        active ? 'bg-[var(--bg-selected)] text-t1' : 'bg-[var(--bg-hover)]',
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Kbd                                                                 */
/* ------------------------------------------------------------------ */

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] select-none items-center justify-center rounded-[4px] px-1',
        'bg-[var(--bg-active)] font-sans text-[12px] font-[510] leading-none text-t3',
        'shadow-[inset_0_0_0_1px_var(--line),inset_0_-1px_0_rgba(0,0,0,.25)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ */
/* Avatar                                                              */
/* ------------------------------------------------------------------ */

const avatarSizes = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

export function Avatar({
  name,
  color,
  size = 'sm',
  className,
  imageUrl,
  ring,
}: {
  name: string;
  color: string;
  size?: keyof typeof avatarSizes;
  className?: string;
  imageUrl?: string;
  ring?: boolean;
}) {
  const px = avatarSizes[size];
  const initials = initialsOf(name);
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full',
        ring && 'shadow-[0_0_0_1.5px_var(--bg-panel)]',
        className,
      )}
      style={{
        width: px,
        height: px,
        background: imageUrl
          ? undefined
          : `linear-gradient(140deg, color-mix(in srgb, ${color} 92%, white 12%), color-mix(in srgb, ${color} 62%, #08090a))`,
        boxShadow: `inset 0 0 0 1px var(--bg-selected)`,
      }}
      title={name}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span
          className="font-[590] leading-none text-white"
          style={{ fontSize: Math.max(7, px * 0.4), textShadow: '0 0 6px rgba(0,0,0,.35)' }}
        >
          {initials}
        </span>
      )}
    </span>
  );
}

export function AvatarStack({
  people,
  size = 'sm',
  max = 3,
}: {
  people: { id: string; name: string; color: string }[];
  size?: keyof typeof avatarSizes;
  max?: number;
}) {
  const shown = people.slice(0, max);
  return (
    <span className="flex items-center">
      {shown.map((p, i) => (
        <span key={p.id} style={{ marginLeft: i === 0 ? 0 : -5 }}>
          <Avatar name={p.name} color={p.color} size={size} ring />
        </span>
      ))}
      {people.length > max && (
        <span className="ml-1 text-[12px] text-t4">+{people.length - max}</span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Checkbox                                                            */
/* ------------------------------------------------------------------ */

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  className,
  size = 14,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange?: (next: boolean) => void;
  className?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!checked);
      }}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-[4px] transition-[background-color,box-shadow] duration-100 ease-out',
        checked || indeterminate
          ? 'bg-accent text-white shadow-[inset_0_0_0_1px_var(--line-strong)]'
          : 'bg-transparent text-transparent shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {indeterminate ? (
        <span className="h-[1.5px] w-[7px] rounded-full bg-white" />
      ) : (
        <CheckMark width={size - 2} height={size - 2} />
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Label chip                                                          */
/* ------------------------------------------------------------------ */

export function LabelChip({
  name,
  color,
  className,
  onClick,
  active,
}: {
  name: string;
  color: string;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
}) {
  const Comp = onClick ? 'button' : 'span';
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'inline-flex h-[22px] max-w-full items-center gap-1.5 rounded-full px-2 text-[13px] leading-none text-t2',
        'shadow-[inset_0_0_0_1px_var(--line-solid)] transition-colors duration-100 ease-out',
        onClick && 'hover:bg-[var(--bg-hover)] hover:text-t1',
        active && 'bg-[var(--bg-selected)] text-t1',
        className,
      )}
    >
      <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{name}</span>
    </Comp>
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-[var(--line)]', className)} />;
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className={cn('animate-spin', className)} aria-hidden>
      <circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeOpacity=".22" strokeWidth="1.6" fill="none" />
      <path d="M7 1.8a5.2 5.2 0 0 1 5.2 5.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}
