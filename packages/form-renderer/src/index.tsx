import {
  buildFormPlan,
  type FormMode,
  type FormPlan,
  type PlannedField,
  type Platform,
  type SchemaModule,
} from '@mcs/schema-core';
import { toPointer, type ConfigPath } from '@mcs/yaml-engine';
import type { JSX } from 'react';

import { DEFAULT_CONTROLS, type ControlComponent } from './controls.js';

export { DEFAULT_CONTROLS } from './controls.js';
export type { ControlComponent, ControlProps } from './controls.js';

export interface SchemaFormProps {
  module: SchemaModule;
  /** The whole Mihomo document; the module reads its own subtree. */
  value: unknown;
  mode?: FormMode;
  platform?: Platform;
  /** Reports an edit by absolute path, ready for `MihomoYamlDocument`. */
  onChange: (path: ConfigPath, value: unknown) => void;
  /** Override or extend the control map without forking the renderer. */
  controls?: Record<string, ControlComponent>;
  /** Translate an i18n key. Defaults to echoing the key. */
  t?: (key: string) => string;
}

/**
 * Render a schema module as a form.
 *
 * There is no field-specific code path in here: every control is chosen from
 * the plan, so a Schema Bundle that adds an ordinary field produces a working
 * control with no application release (FR-SCHEMA-01, FR-SCHEMA-05, FR-SCHEMA-06).
 */
export function SchemaForm(props: SchemaFormProps): JSX.Element {
  const { module, value, onChange } = props;
  const translate = props.t ?? ((key: string) => key);
  const controls = { ...DEFAULT_CONTROLS, ...props.controls };

  const plan: FormPlan = buildFormPlan(module, value, {
    mode: props.mode ?? 'basic',
    ...(props.platform !== undefined ? { platform: props.platform } : {}),
  });

  return (
    <form data-module={plan.moduleId} noValidate>
      {plan.groups.map((group) => {
        const visible = group.fields.filter((field) => field.visible);
        if (visible.length === 0) return null;
        return (
          <fieldset key={group.id} data-group={group.id}>
            <legend>{translate(group.label)}</legend>
            {visible.map((field) => (
              <FieldRow
                key={toPointer(field.path)}
                field={field}
                controls={controls}
                onChange={onChange}
                translate={translate}
              />
            ))}
          </fieldset>
        );
      })}
    </form>
  );
}

/**
 * `<label for>` only associates with a labelable element. These controls render
 * a container instead, so they get a labelled group rather than a dangling
 * label (NFR-A11Y / WCAG 2.2 AA).
 */
const CONTAINER_CONTROLS = new Set(['object', 'key-value']);

interface FieldRowProps {
  field: PlannedField;
  controls: Record<string, ControlComponent>;
  onChange: (path: ConfigPath, value: unknown) => void;
  translate: (key: string) => string;
}

function FieldRow({ field, controls, onChange, translate }: FieldRowProps): JSX.Element {
  const Control = controls[field.control] ?? controls.unknown;
  // The JSON Pointer is the field's stable identity: unique across nesting,
  // and safe to use as a DOM id and attribute selector.
  const pointer = toPointer(field.path);
  const isContainer = CONTAINER_CONTROLS.has(field.control);
  const labelId = `${pointer}::label`;
  const labelContent = (
    <>
      {translate(field.ui.label ?? field.schema.title ?? field.key)}
      {field.required ? <abbr title="required">*</abbr> : null}
      {field.deprecated ? <span data-badge="deprecated">badge.deprecated</span> : null}
      {field.ui.experimental ? <span data-badge="experimental">badge.experimental</span> : null}
      {field.ui.safety === 'dangerous' ? <span data-badge="danger">badge.danger</span> : null}
    </>
  );

  return (
    <div
      data-field={pointer}
      data-control={field.control}
      data-sensitive={field.sensitive ? 'true' : undefined}
      data-unknown={field.unknown ? 'true' : undefined}
      data-deprecated={field.deprecated ? 'true' : undefined}
    >
      {/* Errors and status must never be conveyed by colour alone (NFR-A11Y). */}
      {isContainer ? (
        <span id={labelId}>{labelContent}</span>
      ) : (
        <label htmlFor={pointer}>{labelContent}</label>
      )}

      {Control ? (
        isContainer ? (
          <div role="group" aria-labelledby={labelId}>
            <Control field={field} id={pointer} onChange={onChange} />
          </div>
        ) : (
          <Control field={field} id={pointer} onChange={onChange} />
        )
      ) : null}

      {field.ui.help ? <p data-help="true">{translate(field.ui.help)}</p> : null}
      {field.ui.docs ? (
        <a href={field.ui.docs} rel="noreferrer noopener" target="_blank">
          link.officialDocs
        </a>
      ) : null}

      {field.children?.filter((child) => child.visible).length ? (
        <fieldset data-nested={pointer}>
          {field.children
            .filter((child) => child.visible)
            .map((child) => (
              <FieldRow
                key={toPointer(child.path)}
                field={child}
                controls={controls}
                onChange={onChange}
                translate={translate}
              />
            ))}
        </fieldset>
      ) : null}
    </div>
  );
}
