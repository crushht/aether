'use client';

import * as React from 'react';
import { useUI } from './store/ui';
import { translate, type Locale } from './i18n';

export function useLocale(): Locale {
  return useUI((s) => s.locale);
}

/** `t('Done')` → '已完成' when the locale is zh. Missing keys fall back to English. */
export function useT() {
  const locale = useUI((s) => s.locale);
  return React.useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
}
