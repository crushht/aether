'use client';

import * as React from 'react';
import { useT } from '@/lib/use-t';
import { useData } from '@/lib/store/data';
import { useView } from '@/lib/store/view';
import { NODE_H, NODE_W, dependencyGraph, type GraphIssue } from '@/lib/dependency-graph';
import type { Issue } from '@/lib/types';

/** The status dot colours the drawer already uses; kept local so the SVG does not import UI. */
function statusColor(status: string) {
  if (status === 'in_progress') return 'var(--status-progress)';
  if (status === 'in_review') return 'var(--status-review)';
  if (status === 'done') return 'var(--status-done)';
  if (status === 'canceled' || status === 'duplicate') return 'var(--status-canceled)';
  return 'var(--status-todo)';
}

const clip = (text: string, limit = 24) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/**
 * The blocking chain around one issue, drawn once from the pure layout.
 *
 * A node is a button: Enter or a click opens that issue, so the map is a way to
 * navigate, not a picture to admire.
 */
export function DependencyGraph({ issue }: { issue: Issue }) {
  const t = useT();
  const issues = useData((s) => s.issues);
  const openIssue = useView((s) => s.openIssue);

  const graph = React.useMemo(
    () => dependencyGraph(issue.id, issues as unknown as GraphIssue[]),
    [issue.id, issues],
  );

  if (!graph.nodes.length) {
    return (
      <div data-dep-graph-empty className="mt-1 rounded-r6 bg-[var(--bg-hover)] px-3 py-2 text-[12.5px] text-t4">
        {t('Nothing blocks this issue yet.')}
      </div>
    );
  }

  return (
    <div className="mt-1.5" data-dep-graph data-dep-cyclic={graph.cyclic ? '1' : '0'} data-dep-nodes={graph.nodes.length}>
      <div className="overflow-x-auto rounded-r8 bg-[var(--bg-hover)] p-1 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        <svg
          width={graph.width}
          height={graph.height}
          viewBox={`0 0 ${graph.width} ${graph.height}`}
          role="group"
          aria-label={t('Dependency graph')}
          className="block"
        >
          <defs>
            <marker id="dep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--line-strong)" />
            </marker>
          </defs>
          {graph.edges.map((edge) => (
            <path
              key={`${edge.from}-${edge.to}`}
              data-dep-edge
              d={edge.path}
              fill="none"
              stroke="var(--line-strong)"
              strokeWidth={1.2}
              markerEnd="url(#dep-arrow)"
            />
          ))}
          {graph.nodes.map((node) => (
            <g
              key={node.id}
              data-dep-node={node.key}
              data-dep-root={node.root ? '1' : '0'}
              role="button"
              tabIndex={0}
              aria-label={`${node.key} ${node.title}`}
              onClick={() => openIssue(node.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openIssue(node.id);
                }
              }}
              className="cursor-pointer"
            >
              <title>{`${node.key} · ${node.title}`}</title>
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
                rx={7}
                fill="var(--bg-elevated)"
                stroke={node.root ? 'var(--accent)' : 'var(--line-subtle)'}
                strokeWidth={node.root ? 1.4 : 1}
              />
              <circle cx={node.x + 13} cy={node.y + NODE_H / 2} r={3.4} fill={statusColor(node.status)} />
              <text
                x={node.x + 24}
                y={node.y + 16}
                fill="var(--text-4)"
                fontSize={10.5}
                fontFamily="var(--font-mono, monospace)"
              >
                {node.key}
              </text>
              <text x={node.x + 24} y={node.y + 30} fill="var(--text-2)" fontSize={11.5}>
                {clip(node.title)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-t4">
        {graph.cyclic ? (
          <span data-dep-cycle className="text-[var(--orange)]">
            {t('These issues form a cycle: the order is not linear.')}
          </span>
        ) : null}
        {graph.truncated ? <span data-dep-truncated>{t('Only the nearest issues are drawn.')}</span> : null}
        <span>{t('{n} blockers', { n: graph.edges.length })}</span>
      </div>
    </div>
  );
}
