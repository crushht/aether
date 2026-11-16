const BLOCKED_HOSTS = [/^169\.254\./, /^\[?::1\]?$/i, /^metadata\.google\.internal$/i, /^10\.0\.0\.0$/];

/** On a shared deployment, pin the endpoints your users may reach. */
const ALLOWED_HOSTS = (process.env.AGENT_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

/**
 * The browser sends whatever endpoint the user configured, so the proxy keeps a
 * shallow guard: http(s) only, no link-local / metadata hosts, and an optional
 * allowlist via AGENT_ALLOWED_HOSTS for public deployments.
 */
const PRIVATE_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^\[?::1\]?$/i,
  /\.internal$/i,
  /\.local$/i,
];

/**
 * The page reader fetches whatever URL a person pastes, so it must not become a
 * probe into the host's own network. Model endpoints are allowed to be local
 * (Ollama); page reads are not.
 */
export function safePageUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('URL is required.');
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('That is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) pages can be read.');
  if (PRIVATE_HOSTS.some((pattern) => pattern.test(url.hostname))) {
    throw new Error('Local and private addresses cannot be read.');
  }
  return value;
}

export function safeBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Base URL is required.');
  const value = raw.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Base URL is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Base URL must be http(s).');
  if (BLOCKED_HOSTS.some((pattern) => pattern.test(url.hostname))) throw new Error('Base URL host is not allowed.');
  if (ALLOWED_HOSTS.length && !ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new Error('Base URL host is not in AGENT_ALLOWED_HOSTS.');
  }
  return value;
}
