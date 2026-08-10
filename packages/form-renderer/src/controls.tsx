import type { PlannedField } from '@mcs/schema-core';
import type { ConfigPath } from '@mcs/yaml-engine';
import { useId, useState, type JSX } from 'react';

export interface ControlProps {
  field: PlannedField;
  /**
   * Unique DOM id for the input. Derived from the field's JSON Pointer, not its
   * key: two nested objects can both have an `enable` field, and duplicate ids
   * silently break `<label for>` association.
   */
  id: string;
  onChange: (path: ConfigPath, value: unknown) => void;
  disabled?: boolean;
}

export type ControlComponent = (props: ControlProps) => JSX.Element;

/**
 * Every control receives the same props and reports changes by path. Nothing in
 * here knows a Mihomo field name, which is what lets a Schema Bundle add a
 * field without touching this file (FR-SCHEMA-06).
 */

function TextControl({ field, id, onChange, disabled }: ControlProps): JSX.Element {
  return (
    <input
      type="text"
      id={id}
      value={field.value == null ? '' : String(field.value)}
      placeholder={field.ui.placeholder ?? ''}
      readOnly={field.readOnly}
      disabled={disabled ?? false}
      required={field.required}
      onChange={(event) => onChange(field.path, event.target.value)}
    />
  );
}

function TextareaControl({ field, id, onChange, disabled }: ControlProps): JSX.Element {
  return (
    <textarea
      id={id}
      value={field.value == null ? '' : String(field.value)}
      readOnly={field.readOnly}
      disabled={disabled ?? false}
      onChange={(event) => onChange(field.path, event.target.value)}
    />
  );
}

function NumberControl({ field, id, onChange, disabled }: ControlProps): JSX.Element {
  return (
    <input
      type="number"
      id={id}
      value={field.value == null ? '' : String(field.value)}
      readOnly={field.readOnly}
      disabled={disabled ?? false}
      required={field.required}
      min={field.schema.minimum}
      max={field.schema.maximum}
      step={field.control === 'number' ? 'any' : 1}
      onChange={(event) => {
        const raw = event.target.value;
        onChange(field.path, raw === '' ? null : Number(raw));
      }}
    />
  );
}

function SwitchControl({ field, id, onChange, disabled }: ControlProps): JSX.Element {
  return (
    <input
      type="checkbox"
      role="switch"
      id={id}
      checked={field.value === true}
      disabled={(disabled ?? false) || field.readOnly}
      onChange={(event) => onChange(field.path, event.target.checked)}
    />
  );
}

function SelectControl({ field, id, onChange, disabled }: ControlProps): JSX.Element {
  const options = field.enumValues ?? [];
  return (
    <select
      id={id}
      value={field.value == null ? '' : String(field.value)}
      disabled={(disabled ?? false) || field.readOnly}
      required={field.required}
      onChange={(event) => onChange(field.path, event.target.value)}
    >
      {!field.required && <option value="" />}
      {options.map((option) => (
        <option key={String(option)} value={String(option)}>
          {String(option)}
        </option>
      ))}
    </select>
  );
}

/**
 * Values are hidden until the user asks for them, and the reveal is a discrete
 * action rather than a hover (NFR-SEC-02).
 */
function SecretControl({ field, id, onChange, disabled }: ControlProps): JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const describedBy = useId();
  return (
    <span>
      <input
        type={revealed ? 'text' : 'password'}
        id={id}
        value={field.value == null ? '' : String(field.value)}
        readOnly={field.readOnly}
        disabled={disabled ?? false}
        required={field.required}
        aria-describedby={describedBy}
        onChange={(event) => onChange(field.path, event.target.value)}
      />
      <button type="button" onClick={() => setRevealed((current) => !current)}>
        {revealed ? 'field.hide' : 'field.reveal'}
      </button>
      <span id={describedBy} data-sensitive="true">
        field.sensitiveHint
      </span>
    </span>
  );
}

/** Newline-separated editing keeps list order visible and keyboard-reachable. */
function TagsControl({ field, id, onChange, disabled }: ControlProps): JSX.Element {
  const items = Array.isArray(field.value) ? field.value : [];
  return (
    <textarea
      id={id}
      data-control="tags"
      value={items.map((item) => String(item)).join('\n')}
      readOnly={field.readOnly}
      disabled={disabled ?? false}
      onChange={(event) => {
        const lines = event.target.value.split('\n').filter((line) => line.trim() !== '');
        onChange(field.path, lines);
      }}
    />
  );
}

function MultiSelectControl({ field, id, onChange, disabled }: ControlProps): JSX.Element {
  const options = field.schema.items?.enum ?? [];
  const selected = new Set((Array.isArray(field.value) ? field.value : []).map(String));
  return (
    <select
      id={id}
      multiple
      disabled={(disabled ?? false) || field.readOnly}
      value={[...selected]}
      onChange={(event) => {
        const next = [...event.target.selectedOptions].map((option) => option.value);
        onChange(field.path, next);
      }}
    >
      {options.map((option) => (
        <option key={String(option)} value={String(option)}>
          {String(option)}
        </option>
      ))}
    </select>
  );
}

function KeyValueControl({ field, id, onChange, disabled }: ControlProps): JSX.Element {
  const entries = Object.entries(
    field.value && typeof field.value === 'object' && !Array.isArray(field.value)
      ? (field.value as Record<string, unknown>)
      : {},
  );
  return (
    <table id={id} data-control="key-value">
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key}>
            <th scope="row">{key}</th>
            <td>
              <input
                type="text"
                aria-label={key}
                value={value == null ? '' : String(value)}
                disabled={disabled ?? false}
                readOnly={field.readOnly}
                onChange={(event) => onChange([...field.path, key], event.target.value)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A value the current schema does not describe. It is shown read-only with a
 * pointer to the raw YAML editor rather than being silently carried along
 * (FR-YAML-02, FR-VAL-05).
 */
function UnknownControl({ field, id }: ControlProps): JSX.Element {
  return (
    <output id={id} data-control="unknown" data-unknown="true">
      {typeof field.value === 'object' ? 'field.unknownObject' : String(field.value)}
    </output>
  );
}

/** Structural containers are rendered by the form itself, not by a control. */
function ContainerControl(): JSX.Element {
  return <span data-control="container" />;
}

export const DEFAULT_CONTROLS: Record<string, ControlComponent> = {
  text: TextControl,
  textarea: TextareaControl,
  number: NumberControl,
  integer: NumberControl,
  port: NumberControl,
  switch: SwitchControl,
  select: SelectControl,
  'multi-select': MultiSelectControl,
  tags: TagsControl,
  secret: SecretControl,
  'key-value': KeyValueControl,
  object: ContainerControl,
  list: TagsControl,
  unknown: UnknownControl,
};
