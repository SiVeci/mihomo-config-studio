import {
  computeKnownPaths,
  isArrayEntryModule,
  type FormMode,
  type SchemaModule,
} from '@mcs/schema-core';
import { SchemaArrayForm, SchemaForm } from '@mcs/form-renderer';
import { forwardRef, useImperativeHandle, useMemo, useRef, type ReactNode } from 'react';

import { getLocale, t, translateModuleAware } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/index.js';
import { toPointer, type ConfigPath } from '../worker/protocol.js';
import './ModuleFormPage.css';

export interface ModuleFormPageProps {
  /** Dependency-first order from `SchemaRegistry.modules()` — this page never hardcodes a module id (FR-SCHEMA-05). */
  readonly modules: readonly SchemaModule[];
  /** The whole Mihomo document as plain JS; `null` before the Worker's first parse resolves. */
  readonly value: unknown;
  readonly mode: FormMode;
  readonly onModeChange: (mode: FormMode) => void;
  /** Reports a field edit by absolute path, ready for the Worker's `applyPatch`. */
  readonly onFieldChange: (path: ConfigPath, value: unknown) => void;
}

/** Imperative surface for #16's IssuePanel/UnknownFieldTree: jump straight to a rendered form field. */
export interface ModuleFormPageHandle {
  jumpToField: (path: ConfigPath) => void;
}

/**
 * Renders every resolved Schema module as its own form section, plus the
 * basic/advanced mode toggle (PRD §7.4). Toggling mode never itself edits
 * the document — it only changes which already-present fields are visible
 * (exit condition 6) — `onFieldChange` is wired to the field controls alone.
 *
 * `general`/`inbound` share a document root (`root: []`, v0.3.0 #8): without
 * `additionalKnownPaths`, each module's own plan would flag the other's
 * declared fields as unknown. `computeKnownPaths` is safe to pass back into
 * *every* module's own `buildFormPlan` call, not just the modules that
 * actually share a root — see its own doc comment (v0.3.0 #14).
 */
export const ModuleFormPage = forwardRef<ModuleFormPageHandle, ModuleFormPageProps>(
  function ModuleFormPage({ modules, value, mode, onModeChange, onFieldChange }, ref): ReactNode {
    const rootRef = useRef<HTMLElement>(null);
    const knownPaths = useMemo(
      () => computeKnownPaths(modules, value, { mode: 'advanced' }),
      [modules, value],
    );

    useImperativeHandle(ref, () => ({
      jumpToField: (path) => {
        const pointer = toPointer(path);
        const field = rootRef.current?.querySelector(`[data-field="${pointer}"]`);
        if (!(field instanceof HTMLElement)) return;
        field.scrollIntoView({ block: 'center' });
        // The field's own row is a `<div>`/container, not itself focusable
        // (see `form-renderer`'s `FieldRow`) — focus its first real control
        // instead. A genuinely inert field (an `unknown` control, which
        // renders a plain read-only `<output>` with nothing focusable
        // inside — confirmed live: without this, `.focus()` on the plain
        // `<div>` container is a silent no-op, `document.activeElement`
        // never moves, and the "jump" only ever scrolls) gets a temporary
        // `tabindex="-1"` so the row itself can still take focus
        // programmatically, without joining the natural tab order.
        const control = field.querySelector('input, select, textarea, button, [tabindex]');
        if (control instanceof HTMLElement) {
          control.focus();
        } else {
          field.setAttribute('tabindex', '-1');
          field.focus();
        }
      },
    }));

    // `value === null` covers both "the Worker hasn't reported a parsed
    // document yet" and "the current document has a blocking syntax error"
    // (`protocol.ts`'s `handleParse` sends `value: null` for either) — in
    // both cases there is no document to plan fields against yet, so this
    // renders the same placeholder rather than flashing schema-default values
    // that may not reflect the real file at all.
    if (modules.length === 0 || value === null) {
      return <p className="module-form-page__empty">{t('form.emptyState')}</p>;
    }

    return (
      <section className="module-form-page" ref={rootRef}>
        <div className="module-form-page__toolbar">
          <label className="module-form-page__mode-label" htmlFor="module-form-mode">
            {t('form.modeLabel')}
          </label>
          <select
            id="module-form-mode"
            className="module-form-page__mode-select"
            value={mode}
            onChange={(event) => onModeChange(event.target.value as FormMode)}
          >
            <option value="basic">{t('form.modeBasicOption')}</option>
            <option value="advanced">{t('form.modeAdvancedOption')}</option>
          </select>
        </div>

        {modules.map((module) => {
          const locale = getLocale();
          const translate = (key: string): string =>
            translateModuleAware(key, module.i18n?.[locale]);
          const titleKey = `form.module.${module.manifest.id}` as TranslationKey;

          return (
            <section
              key={module.manifest.id}
              className="module-form-page__module"
              data-module-section={module.manifest.id}
            >
              <h2 className="module-form-page__module-title">{t(titleKey)}</h2>
              {isArrayEntryModule(module) ? (
                <SchemaArrayForm
                  module={module}
                  value={value}
                  mode={mode}
                  onChange={onFieldChange}
                  t={translate}
                />
              ) : (
                <SchemaForm
                  module={module}
                  value={value}
                  mode={mode}
                  onChange={onFieldChange}
                  additionalKnownPaths={knownPaths}
                  t={translate}
                />
              )}
            </section>
          );
        })}
      </section>
    );
  },
);
