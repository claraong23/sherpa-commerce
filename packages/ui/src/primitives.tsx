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
        <header className="flex items-center justify-between gap-3 border-b border-ink-800 px-4 py-2.5">
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
    primary: 'bg-brand-500 text-white hover:bg-brand-400',
    secondary: 'border border-ink-600 bg-ink-800 text-ink-100 hover:border-ink-500 hover:bg-ink-700',
    ghost: 'text-ink-300 hover:bg-ink-800 hover:text-ink-100',
    danger: 'border border-bad-500/40 bg-bad-500/10 text-bad-400 hover:bg-bad-500/20',
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
    pending: 'bg-gold-500',
    fail: 'bg-bad-500',
    idle: 'bg-ink-600',
    info: 'bg-brand-400',
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
              ? 'border-bad-500/50 bg-bad-500/15 text-bad-400'
              : 'border-ok-500/50 bg-ok-500/15 text-ok-400'
            : 'border-ink-600 bg-ink-850 text-ink-500',
        )}
      >
        {done ? (tone === 'fail' ? '×' : '✓') : ''}
      </span>
      <span className={done ? 'text-ink-100' : 'text-ink-400'}>{label}</span>
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
    neutral: 'border-ink-600 bg-ink-800 text-ink-300',
    ok: 'border-ok-500/35 bg-ok-500/10 text-ok-400',
    warn: 'border-warn-500/35 bg-warn-500/10 text-warn-500',
    bad: 'border-bad-500/35 bg-bad-500/10 text-bad-400',
    brand: 'border-brand-400/35 bg-brand-500/15 text-brand-300',
    gold: 'border-gold-500/35 bg-gold-500/10 text-gold-400',
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
      <span className="mono text-right text-[12px] text-ink-100">{children}</span>
    </div>
  )
}

export function Meter({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'ok' | 'gold' }) {
  const colors = { brand: 'bg-brand-400', ok: 'bg-ok-500', gold: 'bg-gold-500' }
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-ink-800">
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
