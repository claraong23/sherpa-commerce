'use client'

import clsx from 'clsx'
import type { ReactNode } from 'react'

/* Shared presentational primitives. No business logic, no data fetching. */

export function Panel({
  children,
  className,
  title,
  right,
  dense,
}: {
  children: ReactNode
  className?: string
  title?: ReactNode
  right?: ReactNode
  dense?: boolean
}) {
  return (
    <section className={clsx('panel flex flex-col overflow-hidden', className)}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
          <div className="label-xs">{title}</div>
          {right}
        </header>
      )}
      <div className={clsx('flex-1 overflow-auto', dense ? 'p-3' : 'p-4')}>{children}</div>
    </section>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  type = 'button',
  className,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
  title?: string
}) {
  const base =
    'focus-ring inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45'
  const sizes = { sm: 'px-2.5 py-1 text-[11.5px]', md: 'px-3.5 py-2 text-[13px]' }
  const variants = {
    // Wisteria at 2.63:1 on white cannot carry white text, so the primary
    // action is a light fill with dark text. Hover deepens the fill.
    primary: 'bg-brand-400 text-slate-900 hover:bg-brand-500',
    secondary: 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
    danger: 'border border-bad-200 bg-bad-50 text-bad-600 hover:bg-bad-100',
  }
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={clsx(base, sizes[size], variants[variant], className)}
    >
      {children}
    </button>
  )
}

export type StatusTone = 'ok' | 'pending' | 'fail' | 'idle' | 'info'

export function StatusDot({ tone, pulse }: { tone: StatusTone; pulse?: boolean }) {
  const colors: Record<StatusTone, string> = {
    ok: 'bg-ok-500',
    pending: 'bg-warn-500',
    fail: 'bg-bad-500',
    idle: 'bg-slate-300',
    info: 'bg-brand-500',
  }
  return (
    <span
      className={clsx('inline-block h-1.5 w-1.5 shrink-0 rounded-full', colors[tone], pulse && 'anim-pulse')}
      aria-hidden
    />
  )
}

export function Check({ done, label, tone }: { done: boolean; label: string; tone?: StatusTone }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      <span
        className={clsx(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border text-[10px] font-bold',
          done
            ? tone === 'fail'
              ? 'border-bad-500 bg-bad-500 text-white'
              : 'border-ok-400 bg-ok-400 text-slate-900'
            : 'border-slate-300 bg-white text-slate-400',
        )}
      >
        {done ? (tone === 'fail' ? '×' : '✓') : ''}
      </span>
      <span className={done ? 'text-slate-900' : 'text-slate-600'}>{label}</span>
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'brand' | 'gold'
  className?: string
}) {
  const tones = {
    neutral: 'border-slate-200 bg-slate-50 text-slate-600',
    ok: 'border-ok-200 bg-ok-50 text-ok-700',
    // Amber is 1.68:1 on white and never carries text: 700 on a 50 fill.
    warn: 'border-warn-200 bg-warn-50 text-warn-700',
    bad: 'border-bad-200 bg-bad-50 text-bad-700',
    brand: 'border-brand-200 bg-brand-50 text-brand-700',
    gold: 'border-gold-200 bg-gold-50 text-gold-700',
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="label-xs">{label}</span>
      <span className="mono text-right text-[12px] text-slate-900">{children}</span>
    </div>
  )
}

export function Meter({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'ok' | 'gold' }) {
  const colors = { brand: 'bg-brand-400', ok: 'bg-ok-400', gold: 'bg-warn-400' }
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={clsx('h-full rounded-full transition-[width] duration-500', colors[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  )
}

export function Money({ amount, currency }: { amount: number; currency: string }) {
  return (
    <span className="mono">
      {currency} {amount.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('h-3.5 w-3.5 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
