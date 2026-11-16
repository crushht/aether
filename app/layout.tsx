import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

/**
 * The headless workflow scheduler starts once per server process. It lives here
 * rather than in instrumentation.ts because the instrumentation graph is
 * compiled for every runtime, and the scheduler needs Node built-ins.
 */
if (typeof window === 'undefined' && process.env.NEXT_PHASE !== 'phase-production-build') {
  void import('@/lib/server/scheduler')
    .then((mod) => mod.startServerScheduler())
    .catch(() => undefined);
}

const inter = localFont({
  src: [
    { path: '../public/fonts/inter-latin.woff2', weight: '100 900', style: 'normal' },
  ],
  variable: '--font-inter',
  display: 'swap',
  adjustFontFallback: 'Arial',
  fallback: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'Aether — the agent workspace',
  description:
    'An agent-centric workspace: issue tracking with Linear-level craft, and a bring-your-own-model agent that reads, plans and executes.',
};

export const viewport: Viewport = {
  themeColor: '#08090a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* theme + language are applied before paint so switching never flashes */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('linear-lab:theme');document.documentElement.dataset.theme=(t==='light'?'light':'dark');var l=localStorage.getItem('linear-lab:locale');l=(l==='en'?'en':'zh');document.documentElement.lang=l==='zh'?'zh-CN':'en';document.documentElement.dataset.locale=l}catch(e){}`,
          }}
        />
      </head>
      <body className={`${inter.variable} overflow-hidden`}>{children}</body>
    </html>
  );
}
