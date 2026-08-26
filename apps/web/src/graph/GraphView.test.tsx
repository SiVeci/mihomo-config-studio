// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import type { ConfigPath, Cycle, Entity, GraphLayout, LayoutNode } from '../worker/protocol.js';
import { GraphView } from './GraphView.js';

afterEach(() => {
  cleanup();
});

const NODE_DIRECT: LayoutNode = {
  aggregated: false,
  id: 'builtin:DIRECT',
  kind: 'builtin',
  name: 'DIRECT',
  layer: 0,
};
const NODE_AUTO: LayoutNode = {
  aggregated: false,
  id: 'proxy-group:auto',
  kind: 'proxy-group',
  name: 'AUTO',
  layer: 1,
};
const NODE_PROXY: LayoutNode = {
  aggregated: false,
  id: 'proxy-group:proxy',
  kind: 'proxy-group',
  name: 'PROXY',
  layer: 1,
};
const NODE_RULE: LayoutNode = {
  aggregated: false,
  id: 'rule:0',
  kind: 'rule',
  name: 'RULE-SET,ads,PROXY',
  layer: 2,
};

const SAMPLE_LAYOUT: GraphLayout = {
  nodes: [NODE_DIRECT, NODE_AUTO, NODE_PROXY, NODE_RULE],
  edges: [
    { fromId: NODE_AUTO.id, toId: NODE_DIRECT.id, status: 'ok' },
    { fromId: NODE_PROXY.id, toId: NODE_AUTO.id, status: 'cycle' },
    { fromId: NODE_RULE.id, toId: NODE_PROXY.id, status: 'missing' },
  ],
};

const SAMPLE_ENTITIES: readonly Entity[] = [
  { id: NODE_DIRECT.id, kind: 'builtin', serializedName: 'DIRECT', sourcePath: [] },
  {
    id: NODE_AUTO.id,
    kind: 'proxy-group',
    serializedName: 'AUTO',
    sourcePath: ['proxy-groups', 0, 'name'],
  },
  {
    id: NODE_PROXY.id,
    kind: 'proxy-group',
    serializedName: 'PROXY',
    sourcePath: ['proxy-groups', 1, 'name'],
  },
  {
    id: NODE_RULE.id,
    kind: 'rule',
    serializedName: 'RULE-SET,ads,PROXY',
    sourcePath: ['rules', 0],
  },
];

const NO_CYCLES: readonly Cycle[] = [];

function renderGraph(overrides: Partial<Parameters<typeof GraphView>[0]> = {}) {
  const onJumpToField = vi.fn<(path: ConfigPath) => void>();
  const utils = render(
    <GraphView
      layout={SAMPLE_LAYOUT}
      entities={SAMPLE_ENTITIES}
      cycles={NO_CYCLES}
      onJumpToField={onJumpToField}
      containerHeight={300}
      {...overrides}
    />,
  );
  return { onJumpToField, ...utils };
}

describe('GraphView (v0.4.0 #13, FR-REL-04/06)', () => {
  it('renders the SVG as an accessible, labelled image', () => {
    renderGraph();
    const svg = screen.getByRole('img', { name: t('graph.svgLabel') });
    expect(svg.tagName.toLowerCase()).toBe('svg');
  });

  it('draws one node per entity and one line per edge', () => {
    const { container } = renderGraph();
    expect(container.querySelectorAll('.graph-view__node')).toHaveLength(4);
    expect(container.querySelectorAll('.graph-view__edge')).toHaveLength(3);
  });

  it('clicking a node calls onJumpToField with that entity’s own sourcePath', () => {
    const { container, onJumpToField } = renderGraph();
    const node = container.querySelector('[data-node-id="proxy-group:auto"]');
    if (!node) throw new Error('expected the AUTO node to render');
    fireEvent.click(node);
    expect(onJumpToField).toHaveBeenCalledExactlyOnceWith(['proxy-groups', 0, 'name']);
  });

  it('never calls onJumpToField for an aggregate node (it has no single field to jump to)', () => {
    const aggregate: LayoutNode = {
      aggregated: true,
      id: 'aggregate:2:rule',
      kind: 'rule',
      layer: 2,
      count: 50,
      memberIds: [],
    };
    const { container, onJumpToField } = renderGraph({
      layout: { nodes: [...SAMPLE_LAYOUT.nodes, aggregate], edges: SAMPLE_LAYOUT.edges },
    });
    const node = container.querySelector('[data-node-id="aggregate:2:rule"]');
    if (!node) throw new Error('expected the aggregate node to render');
    fireEvent.click(node);
    expect(onJumpToField).not.toHaveBeenCalled();
    expect(node.textContent).toContain('50');
  });

  it('the text-equivalent fallback offers the same jump as a real, keyboard/AT-reachable button (PRD §11.6)', () => {
    const { onJumpToField } = renderGraph();
    const details = screen.getByText(t('graph.textFallbackSummary')).closest('details');
    if (!details) throw new Error('expected a <details> fallback');
    const button = Array.from(details.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('AUTO'),
    );
    if (!button) throw new Error('expected a fallback button for AUTO');
    fireEvent.click(button);
    expect(onJumpToField).toHaveBeenCalledExactlyOnceWith(['proxy-groups', 0, 'name']);
  });

  it('the fallback lists every edge as text, status included, regardless of the "only abnormal" filter', () => {
    renderGraph();
    expect(
      screen.getByText(
        t('graph.edgeText', {
          from: 'AUTO',
          to: 'DIRECT',
          status: t('graph.edgeStatusOk'),
        }),
      ),
    ).not.toBeNull();
    expect(
      screen.getByText(
        t('graph.edgeText', {
          from: 'PROXY',
          to: 'AUTO',
          status: t('graph.edgeStatusCycle'),
        }),
      ),
    ).not.toBeNull();
  });

  it('"only abnormal" hides ok edges without touching node count or position (pure visibility, no re-layout)', () => {
    const { container } = renderGraph();
    expect(container.querySelectorAll('.graph-view__edge')).toHaveLength(3);

    fireEvent.click(screen.getByRole('checkbox', { name: t('graph.onlyAbnormalLabel') }));

    expect(container.querySelectorAll('.graph-view__edge')).toHaveLength(2);
    expect(container.querySelectorAll('.graph-view__edge--cycle')).toHaveLength(1);
    expect(container.querySelectorAll('.graph-view__edge--missing')).toHaveLength(1);
    // Nodes are never filtered by edge status — only edges carry a status.
    expect(container.querySelectorAll('.graph-view__node')).toHaveLength(4);
  });

  it('lists every detected cycle as a closed name-sequence path, not just a colour on the edge', () => {
    renderGraph({ cycles: [['AUTO', 'PROXY', 'AUTO']] });
    expect(screen.getByText(t('graph.cyclesHeading'))).not.toBeNull();
    expect(screen.getByText('AUTO → PROXY → AUTO')).not.toBeNull();
  });

  it('renders no cycle section at all when there are no cycles', () => {
    renderGraph({ cycles: [] });
    expect(screen.queryByText(t('graph.cyclesHeading'))).toBeNull();
  });

  it('renders far fewer DOM nodes than the total node count at large scale (virtualization is active)', () => {
    const manyNodes: LayoutNode[] = Array.from({ length: 2000 }, (_, i) => ({
      aggregated: false,
      id: `rule:${i}`,
      kind: 'rule' as const,
      name: `MATCH,PROXY-${i}`,
      layer: 2 as const,
    }));
    const { container } = renderGraph({
      layout: { nodes: manyNodes, edges: [] },
      entities: [],
      containerHeight: 200,
    });
    const rendered = container.querySelectorAll('.graph-view__node');
    expect(rendered.length).toBeLessThan(100);
    expect(rendered.length).toBeGreaterThan(0);
  });
});
