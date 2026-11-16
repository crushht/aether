'use client';

import * as React from 'react';
import type { Issue, Label, User } from '@/lib/types';
import { cn, shortDate } from '@/lib/utils';
import { ListChecks } from 'lucide-react';
import { Avatar, Checkbox, LabelChip } from '@/components/ui/primitives';
import { PriorityIcon } from '@/components/ui/icons';
import { getLocale, translate } from '@/lib/i18n';
import { useView, type DisplayOptions } from '@/lib/store/view';
import { RowActions, RowStatus } from './row-actions';

export const IssueRow = React.memo(function IssueRow({
  issue,
  cursor,
  selected,
  display,
  labels,
  assignee,
  onOpen,
  onClickRow,
  onToggleSelect,
  showCheckbox,
  subDone = 0,
  subTotal = 0,
}: {
  issue: Issue;
  cursor: boolean;
  selected: boolean;
  display: DisplayOptions;
  labels: Label[];
  assignee?: User;
  onOpen: () => void;
  onClickRow: (e: React.MouseEvent) => void;
  onToggleSelect: () => void;
  showCheckbox: boolean;
  subDone?: number;
  subTotal?: number;
}) {
  return (
    <div
      data-issue-row={issue.id}
      role="row"
      tabIndex={0}
      onClick={onClickRow}
      onKeyDown={(event) => {
        // Only the row itself reacts; keys inside the inline controls bubble here.
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          onOpen();
        } else if (event.key === ' ') {
          event.preventDefault();
          onToggleSelect();
        }
      }}
      aria-selected={selected}
      className={cn(
        'group relative flex h-[40px] select-none items-center gap-2 pl-2 pr-2 text-[14px] transition-colors duration-75 sm:h-[40px] sm:pl-3 sm:pr-4',
        'outline-none focus-visible:shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--accent)_60%,transparent)]',
        'hover:bg-[var(--bg-hover)]',
        cursor && !selected && 'bg-[var(--bg-active)]',
        selected && 'bg-[color-mix(in_srgb,var(--accent)_13%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_17%,transparent)]',
      )}
    >
      {selected ? (
        <span className="absolute inset-y-0 left-0 w-[2px] bg-accent" aria-hidden />
      ) : null}

      <span
        className={cn(
          'w-[20px] shrink-0 place-items-center transition-opacity duration-100',
          selected ? 'grid' : 'hidden sm:grid',
          showCheckbox || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox checked={selected} onChange={onToggleSelect} size={14} />
      </span>

      {display.showId ? (
        <span className="tnum hidden w-[62px] shrink-0 truncate text-[13.5px] text-t4 sm:block">{issue.key}</span>
      ) : null}

      <RowStatus issue={issue} />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        className={cn(
          'min-w-0 flex-1 truncate text-left text-[14.5px] font-[510] transition-colors duration-75',
          selected ? 'text-t1' : 'text-t2 group-hover:text-t1',
        )}
      >
        {(() => {
          const tag = issue.title.match(/^\[([^\]]+)\]\s*/);
          return tag ? (
            <span
              role="button"
              tabIndex={0}
              title={`${tag[1]} · ${translate(getLocale(), 'Filter by workflow')}`}
              onClick={(event) => {
                event.stopPropagation();
                useView.getState().setFilter('query', `[${tag[1]}]`);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  useView.getState().setFilter('query', `[${tag[1]}]`);
                }
              }}
              className="mr-1.5 inline-flex max-w-[110px] items-center truncate rounded-[3px] bg-[var(--bg-selected)] px-1 py-[1px] align-[1px] text-[10px] font-[510] text-t4 transition-colors hover:bg-[var(--bg-active)] hover:text-t2"
            >
              {tag[1]}
            </span>
          ) : null;
        })()}
        {issue.title.replace(/^\[[^\]]+\]\s*/, '')}
      </button>

      {subTotal > 0 ? (
        <span
          data-sub-progress={issue.id}
          title={`${subDone}/${subTotal}`}
          className="hidden shrink-0 items-center gap-1 rounded-full bg-[var(--bg-hover)] px-1.5 text-[12px] text-t4 lg:flex"
        >
          <ListChecks size={11} strokeWidth={1.9} />
          <span className="tnum">
            {subDone}/{subTotal}
          </span>
        </span>
      ) : null}

      {display.showLabels ? (
        <span className="hidden shrink-0 items-center gap-1 xl:flex">
          {issue.labelIds.slice(0, 2).map((id) => {
            const label = labels.find((l) => l.id === id);
            if (!label) return null;
            return (
              <LabelChip
                key={id}
                name={label.name}
                color={label.color}
                className="h-[20px] text-[12.5px]"
                onClick={(e) => {
                  e.stopPropagation();
                  useView.getState().toggleFilterValue('labelIds', id);
                }}
              />
            );
          })}
          {issue.labelIds.length > 2 ? (
            <span className="text-[12px] text-t4">+{issue.labelIds.length - 2}</span>
          ) : null}
        </span>
      ) : null}

      {display.showPriority ? (
        <span className="hidden w-[18px] shrink-0 place-items-center sm:grid">
          {issue.priority !== 'none' ? (
            <PriorityIcon priority={issue.priority} size={14} className="text-t3" />
          ) : (
            <PriorityIcon priority="none" size={14} className="text-t4 opacity-0 group-hover:opacity-100" />
          )}
        </span>
      ) : null}

      {display.showAssignee ? (
        <span className="hidden w-[18px] shrink-0 place-items-center sm:grid">
          {assignee ? (
            <Avatar name={assignee.name} color={assignee.color} size="sm" />
          ) : (
            <span className="grid h-[16px] w-[16px] place-items-center rounded-full text-t4 opacity-0 transition-opacity group-hover:opacity-100">
              <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none">
                <circle cx="7" cy="5" r="2.4" stroke="currentColor" strokeWidth="1.3" />
                <path d="M2.8 11.6c.6-2 2.2-3.1 4.2-3.1s3.6 1.1 4.2 3.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </span>
          )}
        </span>
      ) : null}

      <span className="relative flex w-[30px] shrink-0 items-center justify-end sm:w-[64px]">
        {display.showDates ? (
          <span className="tnum hidden whitespace-nowrap text-[13px] text-t4 transition-opacity duration-100 group-hover:opacity-0 md:inline">
            {shortDate(issue.updatedAt)}
          </span>
        ) : null}
        <span className="coarse-show absolute inset-0 flex items-center justify-end opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
          <RowActions issue={issue} />
        </span>
      </span>
    </div>
  );
});
