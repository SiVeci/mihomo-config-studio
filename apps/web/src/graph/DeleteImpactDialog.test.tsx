// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import type { Entity, Reference } from '../worker/protocol.js';
import { DeleteImpactDialog } from './DeleteImpactDialog.js';

afterEach(() => {
  cleanup();
});

const ONE_REPLACEABLE: readonly Reference[] = [
  {
    fromId: 'proxy-group:1',
    toId: 'proxy-group:0',
    path: ['proxy-groups', 1, 'proxies', 0],
    referenceType: 'seq-item',
  },
];
const ONE_CASCADING: readonly Entity[] = [
  {
    id: 'proxy-group:2',
    kind: 'proxy-group',
    serializedName: 'SOLO',
    sourcePath: ['proxy-groups', 2, 'name'],
  },
];

function renderDialog(overrides: Partial<Parameters<typeof DeleteImpactDialog>[0]> = {}) {
  const onReplace = vi.fn<(newTarget: string) => void>();
  const onCascadeDelete = vi.fn();
  const onCancel = vi.fn();
  render(
    <DeleteImpactDialog
      entityName="AUTO"
      replaceable={ONE_REPLACEABLE}
      cascading={[]}
      targetOptions={['DIRECT', 'PROXY']}
      onReplace={onReplace}
      onCascadeDelete={onCascadeDelete}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onReplace, onCascadeDelete, onCancel };
}

describe('DeleteImpactDialog (v0.4.0 #11, FR-REL-03 UI)', () => {
  it('shows the replace exit, not the cascade exit, when cascading is empty', () => {
    renderDialog();
    expect(
      screen.getByRole('button', { name: t('deleteImpact.confirmReplaceButton') }),
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: t('deleteImpact.confirmCascadeButton') }),
    ).toBeNull();
  });

  it('shows the cascade exit, not the replace exit, when cascading is non-empty', () => {
    renderDialog({ cascading: ONE_CASCADING });
    expect(
      screen.getByRole('button', { name: t('deleteImpact.confirmCascadeButton') }),
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: t('deleteImpact.confirmReplaceButton') }),
    ).toBeNull();
  });

  it('lists every cascading entity by name in the cascade preview (NFR-SEC-03: entity names, not rule payload text)', () => {
    renderDialog({
      cascading: [
        ...ONE_CASCADING,
        {
          id: 'proxy-group:3',
          kind: 'proxy-group',
          serializedName: 'BACKUP',
          sourcePath: ['proxy-groups', 3, 'name'],
        },
      ],
    });
    expect(screen.getByText('SOLO')).not.toBeNull();
    expect(screen.getByText('BACKUP')).not.toBeNull();
  });

  it('disables the replace button until a target is typed, then calls onReplace with the trimmed value', () => {
    const { onReplace } = renderDialog();
    const replaceButton = screen.getByRole('button', {
      name: t('deleteImpact.confirmReplaceButton'),
    });
    expect(replaceButton).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText(t('deleteImpact.targetLabel')), {
      target: { value: '  DIRECT  ' },
    });
    expect(replaceButton).toHaveProperty('disabled', false);
    fireEvent.click(replaceButton);

    expect(onReplace).toHaveBeenCalledExactlyOnceWith('DIRECT');
  });

  it('offers the given target options through a datalist, autocomplete only (free text still works)', () => {
    renderDialog();
    const input = screen.getByLabelText(t('deleteImpact.targetLabel'));
    const listId = input.getAttribute('list');
    const datalist = document.getElementById(listId as string);
    const options = Array.from(datalist?.querySelectorAll('option') ?? []).map((o) =>
      o.getAttribute('value'),
    );
    expect(options).toEqual(['DIRECT', 'PROXY']);
  });

  it('calls onCascadeDelete when the cascade exit is confirmed', () => {
    const { onCascadeDelete } = renderDialog({ cascading: ONE_CASCADING });
    fireEvent.click(screen.getByRole('button', { name: t('deleteImpact.confirmCascadeButton') }));
    expect(onCascadeDelete).toHaveBeenCalledOnce();
  });

  it('calls onCancel from either exit without calling onReplace/onCascadeDelete', () => {
    const { onCancel, onReplace } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: t('deleteImpact.cancelButton') }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onReplace).not.toHaveBeenCalled();
  });
});
