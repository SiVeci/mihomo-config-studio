import { computeVirtualWindow } from '@mcs/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/index.js';
import type {
  ConfigPath,
  Cycle,
  EdgeStatus,
  Entity,
  GraphLayout,
  LayoutNode,
} from '../worker/protocol.js';
import './GraphView.css';

const NODE_HEIGHT = 32;
const NODE_WIDTH = 176;
const COLUMN_WIDTH = 220;
const DEFAULT_CONTAINER_HEIGHT = 420;
const OVERSCAN = 4;
const LAYER_COUNT = 3;

const LAYER_LABEL_KEYS = [
  'graph.layerNodeLabel',
  'graph.layerGroupLabel',
  'graph.layerRuleLabel',
] as const satisfies readonly TranslationKey[];

const EDGE_STATUS_LABEL_KEYS: Record<EdgeStatus, TranslationKey> = {
  ok: 'graph.edgeStatusOk',
  missing: 'graph.edgeStatusMissing',
  cycle: 'graph.edgeStatusCycle',
};

export interface GraphViewProps {
  readonly layout: GraphLayout;
  /** Resolves a clicked node's id back to a jump-to-field path (`GraphNode` itself excludes `sourcePath`, NFR-SEC-03). */
  readonly entities: readonly Entity[];
  /** Raw name sequences from `detectCycles()` — an edge's `status: 'cycle'` alone cannot reconstruct a full path (exit condition 6). */
  readonly cycles: readonly Cycle[];
  readonly onJumpToField: (path: ConfigPath) => void;
  /**
   * Test override — see `RuleListPage`'s identical prop for why: jsdom has
   * no layout engine, so `ResizeObserver` never reports a real size there.
   */
  readonly containerHeight?: number;
}

function nodeLabel(node: LayoutNode): string {
  return node.aggregated ? t('graph.aggregateLabel', { count: node.count }) : node.name;
}

/**
 * Renders #12's already-decided layout as inline SVG (E2) — no layout
 * computation happens here, only a deterministic column/row coordinate
 * assignment from the layer index and each node's position within its
 * already-sorted layer (v0.4.0 #13, FR-REL-04/06). Correctness of *what*
 * belongs where is `layout.test.ts`'s job in a plain Node environment; this
 * component's own tests only need to assert wiring (click → jump, filter →
 * fewer edges, virtualization → far fewer DOM nodes than the full count).
 *
 * The SVG is `role="img"` (a flat, opaque image to assistive tech — graphics
 * are not screen-reader-friendly no matter how many ARIA roles are sprinkled
 * on individual nodes, PRD §11.6) so mouse click-to-jump on a node is a
 * sighted-only shortcut; the `<details>` fallback below is the actual
 * accessible equivalent, with real `<button>`s doing the same jump.
 */
export function GraphView({
  layout,
  entities,
  cycles,
  onJumpToField,
  containerHeight: containerHeightProp,
}: GraphViewProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [onlyAbnormal, setOnlyAbnormal] = useState(false);

  useEffect(() => {
    if (containerHeightProp !== undefined) return;
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setMeasuredHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerHeightProp]);

  const containerHeight =
    containerHeightProp ?? (measuredHeight > 0 ? measuredHeight : DEFAULT_CONTAINER_HEIGHT);

  const entityById = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities],
  );
  const nodeById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );

  const layers = useMemo(() => {
    const byLayer: LayoutNode[][] = [[], [], []];
    for (const node of layout.nodes) byLayer[node.layer]?.push(node);
    return byLayer;
  }, [layout.nodes]);

  const windows = useMemo(
    () =>
      layers.map((nodes) =>
        computeVirtualWindow({
          itemCount: nodes.length,
          itemHeight: NODE_HEIGHT,
          containerHeight,
          scrollTop,
          overscan: OVERSCAN,
        }),
      ),
    [layers, containerHeight, scrollTop],
  );

  const totalHeight = Math.max(...windows.map((w) => w.totalHeight), containerHeight);

  // Every node's coordinate, independent of whether it is currently within
  // the virtualized window — an edge whose one endpoint scrolled out of view
  // still needs its still-in-view endpoint's line to originate/end somewhere.
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    layers.forEach((nodes, layer) => {
      nodes.forEach((node, index) => {
        map.set(node.id, {
          x: layer * COLUMN_WIDTH + COLUMN_WIDTH / 2,
          y: index * NODE_HEIGHT + NODE_HEIGHT / 2,
        });
      });
    });
    return map;
  }, [layers]);

  const visibleIds = useMemo(() => {
    const set = new Set<string>();
    layers.forEach((nodes, layer) => {
      const window_ = windows[layer];
      if (!window_) return;
      for (let i = window_.startIndex; i < window_.endIndex; i += 1) {
        const node = nodes[i];
        if (node) set.add(node.id);
      }
    });
    return set;
  }, [layers, windows]);

  const visibleNodes = useMemo(
    () => layout.nodes.filter((node) => visibleIds.has(node.id)),
    [layout.nodes, visibleIds],
  );

  const visibleEdges = useMemo(
    () =>
      layout.edges.filter(
        (edge) =>
          (!onlyAbnormal || edge.status !== 'ok') &&
          visibleIds.has(edge.fromId) &&
          visibleIds.has(edge.toId),
      ),
    [layout.edges, visibleIds, onlyAbnormal],
  );

  function jumpToNode(node: LayoutNode): void {
    if (node.aggregated) return; // stands for many entities — no single field to jump to (see AggregateGraphNode's own doc comment)
    const entity = entityById.get(node.id);
    if (entity) onJumpToField(entity.sourcePath);
  }

  const svgWidth = LAYER_COUNT * COLUMN_WIDTH;

  return (
    <section className="graph-view" aria-label={t('graph.title')}>
      <label className="graph-view__filter">
        <input
          type="checkbox"
          checked={onlyAbnormal}
          onChange={(event) => setOnlyAbnormal(event.target.checked)}
        />
        {t('graph.onlyAbnormalLabel')}
      </label>

      <div
        ref={containerRef}
        className="graph-view__viewport"
        style={{ height: containerHeight }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <svg
          role="img"
          aria-label={t('graph.svgLabel')}
          width={svgWidth}
          height={totalHeight}
          className="graph-view__svg"
        >
          {LAYER_LABEL_KEYS.map((key, layer) => (
            <text
              key={key}
              x={layer * COLUMN_WIDTH + COLUMN_WIDTH / 2}
              y={16}
              textAnchor="middle"
              className="graph-view__layer-label"
            >
              {t(key)}
            </text>
          ))}
          {visibleEdges.map((edge) => {
            const from = positions.get(edge.fromId);
            const to = positions.get(edge.toId);
            if (!from || !to) return null;
            return (
              <line
                key={`${edge.fromId}->${edge.toId}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className={`graph-view__edge graph-view__edge--${edge.status}`}
              />
            );
          })}
          {visibleNodes.map((node) => {
            const position = positions.get(node.id);
            if (!position) return null;
            const label = nodeLabel(node);
            return (
              <g
                key={node.id}
                data-node-id={node.id}
                transform={`translate(${position.x - NODE_WIDTH / 2}, ${position.y - NODE_HEIGHT / 2})`}
                className={`graph-view__node graph-view__node--${node.kind}${node.aggregated ? ' graph-view__node--aggregate' : ''}`}
                onClick={() => jumpToNode(node)}
              >
                <title>{label}</title>
                <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={4} />
                <text x={NODE_WIDTH / 2} y={NODE_HEIGHT / 2 + 4} textAnchor="middle">
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {cycles.length > 0 && (
        <div className="graph-view__cycles">
          <h3>{t('graph.cyclesHeading')}</h3>
          <ul>
            {cycles.map((cycle, index) => (
              <li key={index}>{cycle.join(' → ')}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="graph-view__text-fallback">
        <summary>{t('graph.textFallbackSummary')}</summary>
        {LAYER_LABEL_KEYS.map((key, layer) => (
          <div key={key}>
            <h4>{t(key)}</h4>
            <ul>
              {(layers[layer] ?? []).map((node) => (
                <li key={node.id}>
                  {node.aggregated ? (
                    nodeLabel(node)
                  ) : (
                    <button type="button" onClick={() => jumpToNode(node)}>
                      {nodeLabel(node)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <h4>{t('graph.edgesHeading')}</h4>
        <ul>
          {layout.edges.map((edge) => {
            const fromNode = nodeById.get(edge.fromId);
            const toNode = nodeById.get(edge.toId);
            return (
              <li key={`${edge.fromId}->${edge.toId}`}>
                {t('graph.edgeText', {
                  from: fromNode ? nodeLabel(fromNode) : edge.fromId,
                  to: toNode ? nodeLabel(toNode) : edge.toId,
                  status: t(EDGE_STATUS_LABEL_KEYS[edge.status]),
                })}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
