/** A short, human label for a User-Agent string; never a full UA dump. */
export function describeUserAgent(ua: string): string {
  const value = (ua ?? '').trim();
  if (!value) return 'Unknown device';
  const browser = /Edg\//.test(value)
    ? 'Edge'
    : /OPR\/|Opera/.test(value)
      ? 'Opera'
      : /Firefox\//.test(value)
        ? 'Firefox'
        : /Chrome\//.test(value)
          ? 'Chrome'
          : /Safari\//.test(value)
            ? 'Safari'
            : /Electron\//.test(value)
              ? 'Desktop app'
              : 'Browser';
  const os = /iPhone|iPad|iOS/.test(value)
    ? 'iOS'
    : /Android/.test(value)
      ? 'Android'
      : /Windows NT/.test(value)
        ? 'Windows'
        : /Macintosh|Mac OS X/.test(value)
          ? 'macOS'
          : /Linux/.test(value)
            ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}
