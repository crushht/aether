'use client';

/**
 * Last-resort boundary: if the root layout itself throws, Next renders this
 * instead of a blank page. It must return its own <html>/<body>.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#0e0f11',
          color: '#e6e6e6',
          font: '14px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ maxWidth: 520, padding: 24 }}>
          <h1 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>Aether 遇到了一个错误</h1>
          <p style={{ margin: '0 0 12px', color: '#9a9a9a' }}>
            界面没能渲染。可以先重试；如果反复出现，把下面的信息发给我。
          </p>
          <pre
            style={{
              margin: '0 0 16px',
              padding: 12,
              background: '#17181b',
              border: '1px solid #2a2c31',
              borderRadius: 8,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
            }}
          >
            {error.message || 'Unknown error'}
            {error.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '7px 14px',
              borderRadius: 7,
              border: 'none',
              background: '#5e6ad2',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
