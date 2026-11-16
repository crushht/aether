import type { Config } from 'tailwindcss';

/**
 * Every colour here maps to a CSS variable in app/globals.css.
 * No component is allowed to hardcode a hex value.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: 'var(--bg-base)',
        panel: 'var(--bg-panel)',
        elevated: 'var(--bg-elevated)',
        dialog: 'var(--bg-dialog)',
        hover: 'var(--bg-hover)',
        active: 'var(--bg-active)',
        selected: 'var(--bg-selected)',
        hairline: 'var(--line-subtle)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        solid: 'var(--line-solid)',
        t1: 'var(--text-1)',
        t2: 'var(--text-2)',
        t3: 'var(--text-3)',
        t4: 'var(--text-4)',
        't-disabled': 'var(--text-disabled)',
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          fg: 'var(--accent-fg)',
          soft: 'var(--bg-accent-subtle)',
        },
        green: 'var(--green)',
        red: 'var(--red)',
        orange: 'var(--orange)',
        yellow: 'var(--yellow)',
        teal: 'var(--teal)',
        pink: 'var(--pink)',
      },
      borderColor: {
        DEFAULT: 'var(--line)',
      },
      borderRadius: {
        r4: '4px',
        r6: '6px',
        r8: '8px',
        r9: '9px',
        r10: '10px',
        r12: '12px',
        r16: '16px',
        full: '9999px',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        micro: ['11px', { lineHeight: '14px', letterSpacing: '0.004em' }],
        tiny: ['12px', { lineHeight: '16px', letterSpacing: '0' }],
        mini: ['13px', { lineHeight: '18px', letterSpacing: '-0.01em' }],
        small: ['14px', { lineHeight: '21px', letterSpacing: '-0.013em' }],
        reg: ['15px', { lineHeight: '24px', letterSpacing: '-0.011em' }],
        title1: ['17px', { lineHeight: '24px', letterSpacing: '-0.012em' }],
        title2: ['20px', { lineHeight: '27px', letterSpacing: '-0.012em' }],
        title3: ['24px', { lineHeight: '32px', letterSpacing: '-0.014em' }],
        title4: ['32px', { lineHeight: '40px', letterSpacing: '-0.018em' }],
      },
      boxShadow: {
        hairline: 'inset 0 0 0 1px var(--line)',
        'hairline-soft': 'inset 0 0 0 1px var(--line-subtle)',
        card: 'var(--shadow-card)',
        overlay: 'var(--shadow-overlay)',
        menu: 'var(--shadow-menu)',
        pop: 'var(--shadow-pop)',
        drag: 'var(--shadow-drag)',
        dialog: 'var(--shadow-dialog)',
        focus: '0 0 0 3px var(--focus)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(.25,.46,.45,.94)',
        'out-quart': 'cubic-bezier(.165,.84,.44,1)',
        'in-out-quad': 'cubic-bezier(.455,.03,.515,.955)',
      },
      transitionDuration: {
        quick: '100ms',
        base: '160ms',
        slow: '240ms',
        '160': '160ms',
        '240': '240ms',
      },
      zIndex: {
        header: '100',
        overlay: '500',
        popover: '600',
        command: '650',
        dialog: '700',
        toast: '800',
        tooltip: '1100',
      },
      spacing: {
        row: '36px',
        'row-sm': '28px',
        sidebar: '232px',
        props: '286px',
        topbar: '44px',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'pop-in': {
          from: { opacity: '0', transform: 'translateY(4px) scale(.985)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'pulse-ring': {
          '0%': { opacity: '.6', transform: 'scale(.9)' },
          '70%': { opacity: '0', transform: 'scale(1.6)' },
          '100%': { opacity: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms cubic-bezier(.25,.46,.45,.94) both',
        'pop-in': 'pop-in 160ms cubic-bezier(.25,.46,.45,.94) both',
        'toast-in': 'toast-in 200ms cubic-bezier(.25,.46,.45,.94) both',
        'pulse-ring': 'pulse-ring 1.6s cubic-bezier(.25,.46,.45,.94) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
