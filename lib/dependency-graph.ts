/**
 * The dependency graph: which issues block which, as a small layered drawing.
 *
 * This is geometry and graph theory only — no React, no DOM — because a layout
 * that cannot be asserted is a layout that silently drifts the first time
 * somebody adds a relation. The component next door renders exactly these
 * numbers.
 *
 * Rules that matter:
 * - Edges always point the same way (`blocker → blocked`), whichever side the
 *   relation was stored on, so a chain reads left to right.
 * - A cycle is a fact, not a crash: layering falls back to distance from the
 *   focus issue and the cycle members are named, so the UI can say so.
 * - The drawing is capped. Twenty nodes is a map; two hundred is fog.
 */

export interface GraphRelation {
  type: string;
  issueId: string;
}

export interface GraphIssue {
  id: string;
  key: string;
  title: string;
  status: string;
  relations?: GraphRelation[];
}

export interface GraphNode {
  id: string;
  key: string;
  title: string;
  status: string;
  /** 0 = nothing blocks it, inside this drawing */
  layer: number;
  x: number;
  y: number;
  /** the issue the graph was opened for */
  root: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** SVG path, drawn blocker → blocked */
  path: string;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  /** the focus issue, when it is in the drawing */
  rootId: string | null;
  /** at least one cycle exists among these nodes */
  cyclic: boolean;
  /** members of a cycle, so the UI can warn instead of lying about order */
  cycleIds: string[];
  /** the cap stopped the walk before it ran out of blockers */
  truncated: boolean;
}

export const NODE_W = 168;
export const NODE_H = 40;
const GAP_X = 56;
const GAP_Y = 12;
const PAD = 12;
const DEFAULT_DEPTH = 2;
const DEFAULT_MAX_NODES = 20;

/** Every blocking relation, normalised to `blocker → blocked`. */
export function blockingEdges(issues: GraphIssue[]): Array<{ from: string; to: string }> {
  const known = new Set(issues.map((issue) => issue.id));
  const seen = new Set<string>();
  const edges: Array<{ from: string; to: string }> = [];
  for (const issue of issues) {
    for (const relation of issue.relations ?? []) {
      let from = '';
      let to = '';
      if (relation.type === 'blocks') {
        from = issue.id;
        to = relation.issueId;
      } else if (relation.type === 'blocked_by') {
        from = relation.issueId;
        to = issue.id;
      } else {
        continue;
      }
      if (!from || !to || from === to) continue;
      if (!known.has(from) || !known.has(to)) continue;
      const key = `${from}->${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from, to });
    }
  }
  return edges;
}

/** Kahn's algorithm: whatever is left standing is in (or behind) a cycle. */
export function cycleIds(nodes: string[], edges: Array<{ from: string; to: string }>): string[] {
  const indegree = new Map(nodes.map((id) => [id, 0]));
  const outgoing = new Map(nodes.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    if (!indegree.has(edge.to) || !indegree.has(edge.from)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const queue = nodes.filter((id) => (indegree.get(id) ?? 0) === 0);
  const settled = new Set<string>();
  while (queue.length) {
    const id = queue.shift() as string;
    settled.add(id);
    for (const next of outgoing.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  return nodes.filter((id) => !settled.has(id));
}

/**
 * Longest-path layering over an acyclic graph; distance from the focus when the
 * graph has a cycle (a cyclic graph has no longest path to speak of).
 */
function layerNodes(
  nodes: string[],
  edges: Array<{ from: string; to: string }>,
  rootId: string | null,
  cyclic: boolean,
): Map<string, number> {
  const layers = new Map<string, number>(nodes.map((id) => [id, 0]));
  if (cyclic) {
    const adjacency = new Map(nodes.map((id) => [id, [] as string[]]));
    for (const edge of edges) adjacency.get(edge.from)?.push(edge.to);
    const start = rootId && layers.has(rootId) ? rootId : nodes[0];
    if (!start) return layers;
    const seen = new Set<string>([start]);
    let frontier = [start];
    let depth = 0;
    layers.set(start, 0);
    while (frontier.length) {
      depth += 1;
      const next: string[] = [];
      for (const id of frontier) {
        for (const target of adjacency.get(id) ?? []) {
          if (seen.has(target)) continue;
          seen.add(target);
          layers.set(target, depth);
          next.push(target);
        }
      }
      frontier = next;
    }
    return layers;
  }
  // acyclic: relax until stable, bounded by the node count
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let moved = false;
    for (const edge of edges) {
      const wanted = (layers.get(edge.from) ?? 0) + 1;
      if ((layers.get(edge.to) ?? 0) < wanted) {
        layers.set(edge.to, wanted);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return layers;
}

function edgePath(from: GraphNode, to: GraphNode): string {
  const sx = from.x + NODE_W;
  const sy = from.y + NODE_H / 2;
  const tx = to.x;
  const ty = to.y + NODE_H / 2;
  if (tx > sx + 8) {
    // left to right: a short flat curve, no elbows to get wrong
    const dx = Math.max(24, Math.round((tx - sx) / 2));
    return `M${sx},${sy} C${sx + dx},${sy} ${tx - dx},${ty} ${tx},${ty}`;
  }
  // a back edge (only possible in a cycle): leave the bottom, arrive at the top
  const bx = from.x + NODE_W / 2;
  const by = from.y + NODE_H;
  const ax = to.x + NODE_W / 2;
  const ay = to.y;
  const drop = Math.max(18, Math.round((by - ay) / 2) + 18);
  return `M${bx},${by} C${bx},${by + drop} ${ax},${ay - drop} ${ax},${ay}`;
}

export interface GraphOptions {
  /** how far to walk the chain from the focus issue */
  depth?: number;
  /** hard cap on nodes */
  maxNodes?: number;
}

/**
 * The neighbourhood of one issue: everything within `depth` hops that blocks it
 * or is blocked by it. Non-blocking relations (related / duplicate) belong on
 * the list, not on the map.
 */
export function dependencyGraph(
  rootId: string,
  issues: GraphIssue[],
  options: GraphOptions = {},
): DependencyGraph {
  const depth = Math.max(1, Math.trunc(options.depth ?? DEFAULT_DEPTH));
  const maxNodes = Math.max(2, Math.trunc(options.maxNodes ?? DEFAULT_MAX_NODES));
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const edges = blockingEdges(issues);
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from]);
  }

  const reached: string[] = byId.has(rootId) ? [rootId] : [];
  let truncated = false;
  if (reached.length) {
    const seen = new Set<string>([rootId]);
    let frontier = [rootId];
    for (let hop = 0; hop < depth && frontier.length; hop += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const neighbour of adjacency.get(id) ?? []) {
          if (seen.has(neighbour)) continue;
          if (reached.length >= maxNodes) {
            truncated = true;
            break;
          }
          seen.add(neighbour);
          reached.push(neighbour);
          next.push(neighbour);
        }
        if (truncated) break;
      }
      if (truncated) break;
      frontier = next;
    }
  }

  const kept = new Set(reached);
  const drawn = edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to));
  const cyclicIds = cycleIds(reached, drawn);
  const cyclic = cyclicIds.length > 0;
  const layers = layerNodes(reached, drawn, byId.has(rootId) ? rootId : null, cyclic);

  // stable order: by layer, then by key, so two renders agree
  const ordered = [...reached].sort((a, b) => {
    const layerA = layers.get(a) ?? 0;
    const layerB = layers.get(b) ?? 0;
    if (layerA !== layerB) return layerA - layerB;
    return (byId.get(a)?.key ?? a).localeCompare(byId.get(b)?.key ?? b);
  });

  const perLayer = new Map<number, number>();
  const nodes: GraphNode[] = ordered.map((id) => {
    const issue = byId.get(id);
    const layer = layers.get(id) ?? 0;
    const row = perLayer.get(layer) ?? 0;
    perLayer.set(layer, row + 1);
    return {
      id,
      key: issue?.key ?? id,
      title: issue?.title ?? '',
      status: issue?.status ?? 'todo',
      layer,
      x: PAD + layer * (NODE_W + GAP_X),
      y: PAD + row * (NODE_H + GAP_Y),
      root: id === rootId,
    };
  });

  const positions = new Map(nodes.map((node) => [node.id, node]));
  const drawnEdges: GraphEdge[] = drawn
    .slice()
    .sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`))
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      path: edgePath(positions.get(edge.from) as GraphNode, positions.get(edge.to) as GraphNode),
    }))
    .filter((edge) => Boolean(positions.get(edge.from) && positions.get(edge.to)));

  const width = nodes.length ? Math.max(...nodes.map((node) => node.x + NODE_W)) + PAD : 0;
  const height = nodes.length ? Math.max(...nodes.map((node) => node.y + NODE_H)) + PAD : 0;

  return {
    nodes,
    edges: drawnEdges,
    width,
    height,
    rootId: byId.has(rootId) ? rootId : null,
    cyclic,
    cycleIds: cyclicIds,
    truncated,
  };
}
