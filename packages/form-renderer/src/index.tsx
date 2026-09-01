import {
  buildArrayFormPlan,
  buildFormPlan,
  type FormMode,
  type FormPlan,
  type PlannedField,
  type Platform,
  type SchemaModule,
} from '@mcs/schema-core';
import { computeVariableVirtualWindow } from '@mcs/ui';
import { toPointer, type ConfigPath } from '@mcs/yaml-engine';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type RefCallback,
} from 'react';

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
  /**
   * Paths this module's own plan must not flag `unknown` — a sibling module
   * sharing this module's document root (v0.3.0 #14). Typically the whole
   * registry's `computeKnownPaths` result; see that function's doc comment
   * for why passing the full set is always safe.
   */
  additionalKnownPaths?: ReadonlySet<string>;
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
    ...(props.additionalKnownPaths !== undefined
      ? { additionalKnownPaths: props.additionalKnownPaths }
      : {}),
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

export interface SchemaArrayFormProps {
  /** A module whose root addresses an array of discriminated-union elements (`isArrayEntryModule`) — `proxies`/`proxy-providers`. */
  module: SchemaModule;
  /** The whole Mihomo document; the module reads its own subtree. */
  value: unknown;
  mode?: FormMode;
  platform?: Platform;
  onChange: (path: ConfigPath, value: unknown) => void;
  controls?: Record<string, ControlComponent>;
  t?: (key: string) => string;
  /**
   * Renders a delete button per entry when provided, reporting that entry's
   * own path — deleting is the caller's decision, not this renderer's
   * (v0.4.0 #11): every entry here is a graph entity (`proxies`/
   * `proxy-groups`/`proxy-providers`/`rule-providers` are the only
   * array-entry modules), so the caller needs the chance to run impact
   * analysis first rather than this component deleting unconditionally.
   */
  onDeleteEntry?: (path: ConfigPath) => void;
  /**
   * Overrides real-DOM measurement — same reasoning as `RuleListPage`'s
   * identical prop: jsdom has no layout engine (`getBoundingClientRect`/
   * `ResizeObserver` never report a real size), so tests pass this
   * explicitly instead of asserting against a measurement that can never
   * happen in that environment.
   */
  containerHeight?: number;
}

const ARRAY_FORM_DEFAULT_CONTAINER_HEIGHT = 480;
/**
 * Starting guess for an entry's rendered height, corrected once it has
 * actually been measured (see the `useLayoutEffect` below) — entries are
 * full sub-forms (v0.9.0 #11: a `ss` proxy and a `vmess` proxy render a
 * different field count in "basic" mode alone), never row-height uniform
 * the way `RuleListPage`'s rules are, so unlike that component this one
 * cannot just pick one fixed height and be done.
 */
const ARRAY_FORM_ESTIMATED_ITEM_HEIGHT = 220;
const ARRAY_FORM_OVERSCAN = 3;

/**
 * `SchemaForm`'s counterpart for a module whose root is an array of
 * discriminated-union elements rather than a single object (v0.3.0 #9-#11,
 * #14) — `buildFormPlan` cannot plan that shape end-to-end, so this renders
 * `buildArrayFormPlan`'s one-`PlannedField`-per-element result instead, each
 * in its own `<fieldset>`. No `additionalKnownPaths`: an array-entry
 * module's root is never shared with another module.
 *
 * Virtualized (v0.9.0 #11, ADR-022): a real 1 MB import can carry
 * thousands of `proxies` entries (measured: 3,182, in the corpus
 * `e2e/long-task.spec.ts` uses) — rendering every one synchronously was
 * confirmed, via the real Long Tasks API in a real browser, to block the
 * main thread for 1.5+ seconds. `computeVariableVirtualWindow` (unlike
 * `RuleListPage`'s fixed-height `computeVirtualWindow`) accepts a per-item
 * height that starts as an estimate and gets corrected as entries are
 * actually rendered and measured — ADR-022 itself anticipated this exact
 * case ("如果规则列表需要变高行...需要扩展 `computeVirtualWindow` 或换用
 * 支持变高的方案").
 */
export function SchemaArrayForm(props: SchemaArrayFormProps): JSX.Element {
  const { module, value, onChange, onDeleteEntry, containerHeight: containerHeightProp } = props;
  const translate = props.t ?? ((key: string) => key);
  const controls = { ...DEFAULT_CONTROLS, ...props.controls };

  const items = buildArrayFormPlan(module, value, {
    mode: props.mode ?? 'basic',
    ...(props.platform !== undefined ? { platform: props.platform } : {}),
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const itemElements = useRef<Map<number, HTMLElement>>(new Map());
  const [measuredContainerHeight, setMeasuredContainerHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [itemHeights, setItemHeights] = useState<number[]>([]);

  // Resizes the height cache when the entry count changes (add/delete) —
  // indices beyond a previous, shorter list have no prior measurement yet,
  // and a previous, longer list's trailing measurements no longer apply to
  // anything. Existing entries keep whatever was already measured for them.
  useEffect(() => {
    setItemHeights((previous) => {
      if (previous.length === items.length) return previous;
      const next = new Array<number>(items.length).fill(ARRAY_FORM_ESTIMATED_ITEM_HEIGHT);
      for (let i = 0; i < Math.min(previous.length, items.length); i++) {
        next[i] = previous[i]!;
      }
      return next;
    });
  }, [items.length]);

  useEffect(() => {
    if (containerHeightProp !== undefined) return;
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setMeasuredContainerHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerHeightProp]);

  const containerHeight =
    containerHeightProp ??
    (measuredContainerHeight > 0 ? measuredContainerHeight : ARRAY_FORM_DEFAULT_CONTAINER_HEIGHT);

  // `itemHeights` briefly disagrees with `items.length` between an
  // add/delete and the resize effect above committing — falling back to a
  // fresh, fully-estimated array for that one render avoids indexing past
  // the end of a stale, shorter cache.
  const effectiveItemHeights =
    itemHeights.length === items.length
      ? itemHeights
      : new Array<number>(items.length).fill(ARRAY_FORM_ESTIMATED_ITEM_HEIGHT);

  const window_ = useMemo(
    () =>
      computeVariableVirtualWindow({
        itemHeights: effectiveItemHeights,
        containerHeight,
        scrollTop,
        overscan: ARRAY_FORM_OVERSCAN,
      }),
    [effectiveItemHeights, containerHeight, scrollTop],
  );

  // Corrects the height cache from what the currently-rendered entries
  // actually measure — runs after every commit (cheap: bounded by however
  // many entries the window currently renders, never the full list) rather
  // than depending on a specific set of inputs, since a mode toggle
  // (basic/advanced) can change an already-visible entry's height without
  // moving the window's start/end index at all.
  useLayoutEffect(() => {
    let changed = false;
    const next = [...effectiveItemHeights];
    for (const [index, element] of itemElements.current) {
      const measured = element.getBoundingClientRect().height;
      // jsdom (no layout engine) always reports 0 — never overwrites a real
      // or estimated height with that, which would otherwise permanently
      // collapse every entry to zero the first time this runs in a test.
      if (
        measured > 0 &&
        Math.abs((next[index] ?? ARRAY_FORM_ESTIMATED_ITEM_HEIGHT) - measured) > 1
      ) {
        next[index] = measured;
        changed = true;
      }
    }
    if (changed) setItemHeights(next);
  });

  const visibleItems = items.slice(window_.startIndex, window_.endIndex);

  function itemRef(index: number): RefCallback<HTMLElement> {
    return (element) => {
      if (element) itemElements.current.set(index, element);
      else itemElements.current.delete(index);
    };
  }

  return (
    <div
      ref={containerRef}
      data-module={module.manifest.id}
      data-array-form="true"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{
        overflowY: 'auto',
        ...(containerHeightProp !== undefined ? { height: containerHeightProp } : {}),
      }}
    >
      <div style={{ height: window_.topPadding }} aria-hidden="true" />
      {visibleItems.map((field, offset) => {
        const index = window_.startIndex + offset;
        return (
          <fieldset key={toPointer(field.path)} data-array-index={index} ref={itemRef(index)}>
            <FieldRow field={field} controls={controls} onChange={onChange} translate={translate} />
            {onDeleteEntry && (
              <button type="button" onClick={() => onDeleteEntry(field.path)}>
                {translate('arrayForm.deleteEntryButton')}
              </button>
            )}
          </fieldset>
        );
      })}
      <div style={{ height: window_.bottomPadding }} aria-hidden="true" />
    </div>
  );
}

/**
 * `<label for>` only associates with a labelable element. These controls render
 * a container instead, so they get a labelled group rather than a dangling
 * label (NFR-A11Y / WCAG 2.2 AA).
 */
const CONTAINER_CONTROLS = new Set(['object', 'key-value', 'variant']);

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
      {field.deprecated ? (
        <span data-badge="deprecated">{translate('badge.deprecated')}</span>
      ) : null}
      {field.ui.experimental ? (
        <span data-badge="experimental">{translate('badge.experimental')}</span>
      ) : null}
      {field.ui.safety === 'dangerous' ? (
        <span data-badge="danger">{translate('badge.danger')}</span>
      ) : null}
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
          {translate('link.officialDocs')}
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
