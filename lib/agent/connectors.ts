/**
 * Connector URL and method rules, shared by the proxy route, the settings form
 * and the agent tool. Pure so the edge cases are testable without a network.
 */

export const CONNECTOR_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type ConnectorMethod = (typeof CONNECTOR_METHODS)[number];

export const isConnectorMethod = (value: unknown): value is ConnectorMethod =>
  typeof value === 'string' && (CONNECTOR_METHODS as readonly string[]).includes(value.toUpperCase());

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;

/** Build the final request URL without allowing the path to escape the base. */
export function connectorUrl(baseUrl: string, path: string): string | null {
  try {
    const base = new URL(baseUrl);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
    const hostLocal = LOCAL_HOSTS.test(base.hostname);
    // plain http is only acceptable for a locally hosted connector
    if (base.protocol === 'http:' && !hostLocal) return null;
    const raw = path.trim() || '/';
    if (raw.startsWith('http://') || raw.startsWith('https://')) return null;
    const joined = new URL(raw, base.href.endsWith('/') ? base.href : `${base.href}/`);
    if (joined.origin !== base.origin) return null;
    return joined.toString();
  } catch {
    return null;
  }
}

export function isReadOnlyConnectorMethod(method: ConnectorMethod): boolean {
  return method === 'GET' || method === 'HEAD';
}
