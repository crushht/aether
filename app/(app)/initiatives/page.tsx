'use client';

import * as React from 'react';
import { useData } from '@/lib/store/data';
import { useT } from '@/lib/use-t';

/**
 * Initiatives are intentionally empty in this build: the workspace starts
 * without content and this version does not model an initiative entity yet.
 * The page stays so the navigation matches Linear, but it never invents rows.
 */
export default function InitiativesPage() {
  const t = useT();
  const projects = useData((s) => s.projects);

  return (
    <div className="mx-auto max-w-[1040px] px-4 py-4 sm:px-6 sm:py-5">
      <div className="mb-4 flex items-center gap-2.5">
        <h1 className="text-[15px] font-[590] text-t1">{t('Initiatives')}</h1>
        <span className="tnum text-[13px] text-t4">0</span>
      </div>

      <div className="flex h-[180px] flex-col items-center justify-center gap-2 rounded-r8 border border-dashed border-[var(--line)] px-6 text-center">
        <p className="text-[14px] text-t2">{t('No initiatives yet')}</p>
        <p className="max-w-[360px] text-[13px] leading-[1.6] text-t4">
          {t('Initiatives group projects under one goal. This build keeps the page but does not model initiatives, so nothing is listed here.')}
        </p>
        {projects.length ? (
          <p className="text-[13px] text-t4">
            {t('You have {n} project(s) — they live under Projects.', { n: projects.length })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
