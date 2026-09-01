// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import { EMPTY_PROJECT_FILTER_QUERY, type ProjectRecord } from './model.js';
import { ProjectFilter } from './ProjectFilter.js';

afterEach(() => {
  cleanup();
});

function record(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'p1',
    name: 'Project One',
    description: '',
    targetProfile: 'v1.19.29',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ProjectFilter (FR-PROJ-07)', () => {
  it('always shows the text search input, even with a single untagged project', () => {
    render(
      <ProjectFilter
        records={[record()]}
        query={EMPTY_PROJECT_FILTER_QUERY}
        onQueryChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(t('projectFilter.searchLabel'))).toBeDefined();
  });

  it('reports a text edit via onQueryChange, keeping the rest of the query unchanged', () => {
    const onQueryChange = vi.fn();
    render(
      <ProjectFilter
        records={[record()]}
        query={EMPTY_PROJECT_FILTER_QUERY}
        onQueryChange={onQueryChange}
      />,
    );

    fireEvent.change(screen.getByLabelText(t('projectFilter.searchLabel')), {
      target: { value: 'router' },
    });

    expect(onQueryChange).toHaveBeenCalledWith({ text: 'router', tag: null, targetProfile: null });
  });

  it('hides the tag dropdown when no project has any tag', () => {
    render(
      <ProjectFilter
        records={[record({ tags: [] })]}
        query={EMPTY_PROJECT_FILTER_QUERY}
        onQueryChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(t('projectFilter.tagLabel'))).toBeNull();
  });

  it('shows every distinct tag once the tag dropdown appears', () => {
    render(
      <ProjectFilter
        records={[record({ id: 'a', tags: ['home'] }), record({ id: 'b', tags: ['home', 'work'] })]}
        query={EMPTY_PROJECT_FILTER_QUERY}
        onQueryChange={vi.fn()}
      />,
    );

    const select = screen.getByLabelText(t('projectFilter.tagLabel')) as HTMLSelectElement;
    const options = [...select.options].map((option) => option.value);
    expect(options).toEqual(['', 'home', 'work']);
  });

  it('reports null (not an empty string) for "all tags" once a specific tag was selected', () => {
    const onQueryChange = vi.fn();
    render(
      <ProjectFilter
        records={[record({ tags: ['home'] })]}
        query={{ text: '', tag: 'home', targetProfile: null }}
        onQueryChange={onQueryChange}
      />,
    );

    fireEvent.change(screen.getByLabelText(t('projectFilter.tagLabel')), { target: { value: '' } });

    expect(onQueryChange).toHaveBeenCalledWith({ text: '', tag: null, targetProfile: null });
  });

  it('hides the target-profile dropdown when every project shares the same one (ADR-012: only one Stable profile exists yet)', () => {
    render(
      <ProjectFilter
        records={[
          record({ targetProfile: 'v1.19.29' }),
          record({ id: 'p2', targetProfile: 'v1.19.29' }),
        ]}
        query={EMPTY_PROJECT_FILTER_QUERY}
        onQueryChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(t('projectFilter.targetProfileLabel'))).toBeNull();
  });

  it('shows the target-profile dropdown once two distinct profiles exist, with candidates read from the real records, not a hardcoded list', () => {
    render(
      <ProjectFilter
        records={[
          record({ id: 'p1', targetProfile: 'v1.19.29' }),
          record({ id: 'p2', targetProfile: 'v2.0.0' }),
        ]}
        query={EMPTY_PROJECT_FILTER_QUERY}
        onQueryChange={vi.fn()}
      />,
    );

    const select = screen.getByLabelText(
      t('projectFilter.targetProfileLabel'),
    ) as HTMLSelectElement;
    const options = [...select.options].map((option) => option.value);
    expect(options).toEqual(['', 'v1.19.29', 'v2.0.0']);
  });
});
