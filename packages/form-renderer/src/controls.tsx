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

/**
 * `TagsControl`'s newline-per-entry editing with `SecretControl`'s
 * reveal-gate, for array-of-string fields holding literal credentials (e.g.
 * `general`'s `authentication`, `"username:password"` entries — NFR-SEC-02,
 * v0.9.0 #13). HTML has no password-typed `<textarea>`, and a CSS masking
 * trick (`-webkit-text-security`) has no Firefox equivalent, so masking here
 * means the real value simply never enters the DOM until revealed, rather
 * than a browser-dependent visual effect: `readOnly` while hidden, and a
 * fixed-width placeholder per entry that (unlike `SecretControl`'s dot-per-
 * character masking) does not even reveal each entry's real length.
 */
function SecretTagsControl({ field, id, onChange, disabled }: ControlProps): JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const describedBy = useId();
  const items = Array.isArray(field.value) ? field.value : [];
  const shownValue = revealed
    ? items.map((item) => String(item)).join('\n')
    : items.map(() => '••••••••').join('\n');
  return (
    <span>
      <textarea
        id={id}
        data-control="secret-tags"
        value={shownValue}
        readOnly={field.readOnly || !revealed}
        disabled={disabled ?? false}
        aria-describedby={describedBy}
        onChange={(event) => {
          const lines = event.target.value.split('\n').filter((line) => line.trim() !== '');
          onChange(field.path, lines);
        }}
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

/**
 * A discriminated union's branch picker. Options come entirely from
 * `field.variant.options`, which the planner derived from the schema's own
 * `const`/`enum` branches — nothing here reads a protocol name, so the same
 * component renders a synthetic two-branch union and `proxies` alike
 * (FR-SCHEMA-06). Picking a branch reports one `(discriminatorPath, value)`
 * change; the matched branch's own fields render separately, through the
 * same nested-children mechanism `object` uses (E4: this control never
 * issues a delete).
 */
function VariantControl({ field, id, onChange, disabled }: ControlProps): JSX.Element {
  const variant = field.variant;
  const options = variant?.options ?? [];
  const selected = variant?.selected;
  const selectedValue = selected === undefined ? '' : String(selected);
  const matched = variant?.matched ?? true;

  return (
    <span>
      <select
        id={id}
        data-control="variant"
        value={selectedValue}
        disabled={(disabled ?? false) || field.readOnly}
        onChange={(event) => {
          if (variant) onChange(variant.discriminatorPath, event.target.value);
        }}
      >
        {selected === undefined ? <option value="" /> : null}
        {/* The current value may not be one of the known branches (e.g. a
            protocol outside the schema's coverage) — keep it selectable and
            visible instead of letting the browser silently pick another
            option to display. */}
        {!matched && selected !== undefined ? (
          <option value={selectedValue}>{selectedValue}</option>
        ) : null}
        {options.map((option) => {
          const optionValue = String(option.value);
          return (
            <option key={optionValue} value={optionValue}>
              {option.label ?? optionValue}
            </option>
          );
        })}
      </select>
      {/* Never colour-only (NFR-A11Y): an unrecognised value gets a text marker. */}
      {!matched && selected !== undefined ? (
        <span data-variant-unmatched="true">field.variant.unmatched</span>
      ) : null}
    </span>
  );
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
  'secret-tags': SecretTagsControl,
  'key-value': KeyValueControl,
  object: ContainerControl,
  list: TagsControl,
  variant: VariantControl,
  unknown: UnknownControl,
};
