/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // the desktop build ships the server as a self-contained folder
  output: process.env.NEXT_OUTPUT === 'export' ? undefined : 'standalone',
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  async headers() {
    const csp = [
      "default-src 'self'",
      // Next injects inline bootstrap scripts; keep them while we observe real violations.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      'report-uri /api/csp-report',
    ].join('; ');
    // Observe by default; `npm run csp:check` tells you when it is safe to enforce.
    const enforced = process.env.AETHER_CSP_ENFORCE === '1';
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
          { key: enforced ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
