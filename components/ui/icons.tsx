import type { SVGProps } from 'react';
import type { Priority, StatusKey } from '@/lib/types';
import { cn } from '@/lib/utils';

const svgProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 14 14',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true as const,
});

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export function StatusIcon({
  status,
  size = 14,
  className,
  style,
}: {
  status: StatusKey;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const p = svgProps(size);
  const stroke = 1.6;

  if (status === 'backlog') {
    return (
      <svg {...p} className={className} style={style}>
        <circle
          cx="7"
          cy="7"
          r="5.6"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray="1.8 2.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (status === 'todo') {
    return (
      <svg {...p} className={className} style={style}>
        <circle cx="7" cy="7" r="5.6" stroke="currentColor" strokeWidth={stroke} />
      </svg>
    );
  }
  if (status === 'in_progress') {
    return (
      <svg {...p} className={className} style={style}>
        <circle cx="7" cy="7" r="5.6" stroke="currentColor" strokeOpacity="0.45" strokeWidth={stroke} />
        <path d="M7 1.4A5.6 5.6 0 0 1 12.6 7H7V1.4Z" fill="currentColor" />
      </svg>
    );
  }
  if (status === 'in_review') {
    return (
      <svg {...p} className={className} style={style}>
        <circle cx="7" cy="7" r="5.6" stroke="currentColor" strokeOpacity="0.45" strokeWidth={stroke} />
        <path d="M7 7V1.4A5.6 5.6 0 0 1 12.6 7H7Z" fill="currentColor" />
        <path d="M7 7H1.4A5.6 5.6 0 0 1 7 1.4V7Z" fill="currentColor" fillOpacity="0.55" />
      </svg>
    );
  }
  if (status === 'done') {
    return (
      <svg {...p} className={className} style={style}>
        <circle cx="7" cy="7" r="6.4" fill="currentColor" />
        <path
          d="M4.1 7.2 6.1 9.2 9.9 5.1"
          stroke="var(--bg-panel)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // canceled / duplicate
  return (
    <svg {...p} className={className} style={style}>
      <circle cx="7" cy="7" r="6.4" fill="currentColor" fillOpacity="0.9" />
      <path d="M4.8 4.8 9.2 9.2M9.2 4.8 4.8 9.2" stroke="var(--bg-panel)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Priority                                                            */
/* ------------------------------------------------------------------ */

export function PriorityIcon({
  priority,
  size = 14,
  className,
}: {
  priority: Priority;
  size?: number;
  className?: string;
}) {
  const p = svgProps(size);
  if (priority === 'urgent') {
    return (
      <svg {...p} className={className}>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--orange)" />
        <rect x="6.35" y="3.6" width="1.3" height="4.6" rx="0.65" fill="#0b0c0d" />
        <rect x="6.35" y="9.2" width="1.3" height="1.4" rx="0.65" fill="#0b0c0d" />
      </svg>
    );
  }
  const bar = (i: number, h: number) => (
    <rect
      key={i}
      x={1.6 + i * 4.2}
      y={11.4 - h}
      width="2.9"
      height={h}
      rx="1"
      fill="currentColor"
      opacity={priority === 'none' ? 0.5 : 1}
    />
  );
  const height = priority === 'low' ? [4] : priority === 'medium' ? [4, 8] : priority === 'high' ? [4, 8, 11.4] : [];
  return (
    <svg {...p} className={className}>
      {height.length === 0 ? (
        <>
          <rect x="1.6" y="6.6" width="2.9" height="1.6" rx="0.8" fill="currentColor" opacity="0.45" />
          <rect x="5.8" y="6.6" width="2.9" height="1.6" rx="0.8" fill="currentColor" opacity="0.45" />
          <rect x="10" y="6.6" width="2.9" height="1.6" rx="0.8" fill="currentColor" opacity="0.45" />
        </>
      ) : (
        height.map((h, i) => bar(i, h))
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Team / project / label marks                                        */
/* ------------------------------------------------------------------ */

export function TeamIcon({ color, size = 14, className }: { color: string; size?: number; className?: string }) {
  return (
    <svg {...svgProps(size)} className={className}>
      <rect x="1.2" y="1.2" width="11.6" height="11.6" rx="3.2" fill={color} fillOpacity="0.18" />
      <rect x="1.2" y="1.2" width="11.6" height="11.6" rx="3.2" stroke={color} strokeOpacity="0.55" strokeWidth="1" />
      <circle cx="7" cy="7" r="2.1" fill={color} />
    </svg>
  );
}

export function ProjectMark({
  color,
  glyph,
  size = 16,
  className,
}: {
  color: string;
  glyph?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-r4 leading-none', className)}
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${color} 18%, transparent)`,
        color,
        fontSize: size * 0.62,
        fontWeight: 590,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 38%, transparent)`,
      }}
    >
      {glyph ?? '◈'}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Small utility marks used in the chrome                              */
/* ------------------------------------------------------------------ */

export function LinearMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="lg-mark" x1="0" y1="16" x2="16" y2="0">
          <stop stopColor="#8A94E8" />
          <stop offset="1" stopColor="#5E6AD2" />
        </linearGradient>
      </defs>
      <circle cx="8" cy="8" r="7" fill="url(#lg-mark)" />
      <path
        d="M2.4 10.2 9.8 2.8M3.4 12.3 11.4 4.3M5.4 13.6l7.4-7.4"
        stroke="#fff"
        strokeOpacity=".92"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CheckMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 14 14" fill="none" {...props}>
      <path d="M2.9 7.3 5.6 10 11 4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DashMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 14 14" fill="none" {...props}>
      <path d="M3 7h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
