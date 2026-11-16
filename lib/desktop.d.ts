export {};

declare global {
  interface Window {
    desktop?: {
      platform?: string;
      versions?: { electron?: string; chrome?: string };
      notify?: (
        title: string,
        body?: string,
        payload?: { issueId?: string | null; projectId?: string | null },
      ) => Promise<boolean> | void;
      onNotificationClick?: (
        callback: (payload: { issueId?: string | null; projectId?: string | null }) => void,
      ) => (() => void) | void;
      /** aether:// deep links forwarded by the desktop shell */
      onDeepLink?: (
        callback: (payload: { issueId?: string | null; projectId?: string | null }) => void,
      ) => (() => void) | void;
    };
  }
}
