import { buildRulePlan } from '@mcs/schema-core';
import type { RuleTypeSpec } from '@mcs/schema-core';
import { useState, type FormEvent, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import './RuleEditor.css';

const TARGETS_DATALIST_ID = 'rule-editor-targets';
const RULE_PROVIDERS_DATALIST_ID = 'rule-editor-rule-providers';
const SUB_RULES_DATALIST_ID = 'rule-editor-sub-rules';

export interface RuleEditorProps {
  /** Drives every control: no branch in this file ever reads `spec.type` (ADR-021's `payloadKind` dispatch, applied to editing). */
  readonly catalog: readonly RuleTypeSpec[];
  /** Omit to create a new rule; a string (even `''`) edits an existing one. */
  readonly initialText?: string;
  /** Autocomplete only (see `entity-names.ts`) — free text is always still accepted. */
  readonly proxyTargetNames: readonly string[];
  readonly ruleProviderNames: readonly string[];
  readonly subRuleGroupNames: readonly string[];
  readonly onSubmit: (text: string) => void;
  readonly onCancel: () => void;
}

interface StructuredState {
  readonly type: string;
  readonly payload: string;
  readonly target: string;
  readonly params: ReadonlySet<string>;
}

/**
 * Same shape `buildRulePlan` returns, plus one more fallback: a structured
 * plan whose params include a token the catalog does not declare for that
 * type edits as raw text instead of silently dropping the unknown token on
 * save — the same fidelity promise `{kind:'raw'}` already gives unrecognised
 * *types*, extended to unrecognised *param combinations* of a recognised
 * type. A `null` payload/target on a type that structurally needs one (a
 * malformed existing line) falls back the same way rather than editing a
 * hole.
 */
function planForEditing(
  catalog: readonly RuleTypeSpec[],
  text: string,
): { kind: 'raw'; text: string } | { kind: 'structured'; state: StructuredState } {
  const plan = buildRulePlan(catalog, text);
  if (plan.kind === 'raw') return plan;
  if (plan.spec.needsPayload && plan.payload === null) return { kind: 'raw', text };
  if (plan.target === null) return { kind: 'raw', text };
  const paramValues = plan.params.map((p) => p.value);
  if (paramValues.some((value) => !plan.spec.params.includes(value))) return { kind: 'raw', text };
  return {
    kind: 'structured',
    state: {
      type: plan.spec.type,
      payload: plan.payload?.value ?? '',
      target: plan.target.value,
      params: new Set(paramValues),
    },
  };
}

/**
 * Structured create/edit for one `rules[]` line (FR-RULE-01), falling back
 * to whole-line raw text for anything the catalog does not recognise
 * (FR-RULE-05) — never disabling editing or discarding content just because
 * this app cannot parse it into fields.
 */
export function RuleEditor({
  catalog,
  initialText,
  proxyTargetNames,
  ruleProviderNames,
  subRuleGroupNames,
  onSubmit,
  onCancel,
}: RuleEditorProps): ReactNode {
  const isEditing = initialText !== undefined;
  const initialPlan = isEditing ? planForEditing(catalog, initialText) : null;

  // Fixed for the component's lifetime (no in-dialog toggle, see the plan
  // note above `planForEditing`) — derived directly from props/initial plan
  // rather than `useState`, since nothing ever changes it after mount.
  const mode: 'structured' | 'raw' = initialPlan?.kind === 'raw' ? 'raw' : 'structured';
  const [rawText, setRawText] = useState(
    initialPlan?.kind === 'raw' ? initialPlan.text : (initialText ?? ''),
  );
  const [selectedType, setSelectedType] = useState(
    initialPlan?.kind === 'structured' ? initialPlan.state.type : (catalog[0]?.type ?? ''),
  );
  const [payloadText, setPayloadText] = useState(
    initialPlan?.kind === 'structured' ? initialPlan.state.payload : '',
  );
  const [targetText, setTargetText] = useState(
    initialPlan?.kind === 'structured' ? initialPlan.state.target : '',
  );
  const [selectedParams, setSelectedParams] = useState<ReadonlySet<string>>(
    initialPlan?.kind === 'structured' ? initialPlan.state.params : new Set(),
  );

  const spec = catalog.find((entry) => entry.type === selectedType) ?? null;

  function handleTypeChange(newType: string): void {
    setSelectedType(newType);
    setPayloadText('');
    setTargetText('');
    setSelectedParams(new Set());
  }

  function toggleParam(param: string): void {
    setSelectedParams((previous) => {
      const next = new Set(previous);
      if (next.has(param)) next.delete(param);
      else next.add(param);
      return next;
    });
  }

  function buildStructuredText(): string {
    if (!spec) return '';
    const segments = [spec.type];
    if (spec.needsPayload) segments.push(payloadText.trim());
    segments.push(targetText.trim());
    for (const param of spec.params) {
      if (selectedParams.has(param)) segments.push(param);
    }
    return segments.join(',');
  }

  const canSubmit =
    mode === 'raw'
      ? rawText.trim() !== ''
      : spec !== null &&
        targetText.trim() !== '' &&
        (!spec.needsPayload || payloadText.trim() !== '');

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(mode === 'raw' ? rawText.trim() : buildStructuredText());
  }

  const title = t(isEditing ? 'ruleEditor.editTitle' : 'ruleEditor.createTitle');

  return (
    <form
      className="rule-editor"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onSubmit={handleSubmit}
    >
      <h2 className="rule-editor__title">{title}</h2>

      {mode === 'raw' ? (
        <div className="rule-editor__field">
          <label htmlFor="rule-editor-raw">{t('ruleEditor.rawTextLabel')}</label>
          <p className="rule-editor__hint">{t('ruleEditor.rawTextHint')}</p>
          <input
            id="rule-editor-raw"
            type="text"
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
          />
        </div>
      ) : (
        <>
          <div className="rule-editor__field">
            <label htmlFor="rule-editor-type">{t('ruleEditor.typeLabel')}</label>
            <select
              id="rule-editor-type"
              value={selectedType}
              onChange={(event) => handleTypeChange(event.target.value)}
            >
              {catalog.map((entry) => (
                <option key={entry.type} value={entry.type}>
                  {entry.type}
                </option>
              ))}
            </select>
            {spec?.safety === 'dangerous' && <span data-badge="danger">{t('badge.danger')}</span>}
            {spec?.docsUrl && (
              <a href={spec.docsUrl} target="_blank" rel="noreferrer noopener">
                {t('link.officialDocs')}
              </a>
            )}
          </div>

          {spec?.needsPayload && (
            <div className="rule-editor__field">
              <label htmlFor="rule-editor-payload">{t('ruleEditor.payloadLabel')}</label>
              <input
                id="rule-editor-payload"
                type="text"
                value={payloadText}
                onChange={(event) => setPayloadText(event.target.value)}
                list={spec.payloadKind === 'rule-set' ? RULE_PROVIDERS_DATALIST_ID : undefined}
              />
            </div>
          )}

          <div className="rule-editor__field">
            <label htmlFor="rule-editor-target">{t('ruleEditor.targetLabel')}</label>
            <input
              id="rule-editor-target"
              type="text"
              value={targetText}
              onChange={(event) => setTargetText(event.target.value)}
              list={spec?.payloadKind === 'sub-rule' ? SUB_RULES_DATALIST_ID : TARGETS_DATALIST_ID}
            />
          </div>

          {spec && spec.params.length > 0 && (
            <fieldset className="rule-editor__params">
              <legend>{t('ruleEditor.paramsLabel')}</legend>
              {spec.params.map((param) => (
                <label key={param} className="rule-editor__param">
                  <input
                    type="checkbox"
                    checked={selectedParams.has(param)}
                    onChange={() => toggleParam(param)}
                  />
                  {param}
                </label>
              ))}
            </fieldset>
          )}

          <datalist id={TARGETS_DATALIST_ID}>
            {proxyTargetNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <datalist id={RULE_PROVIDERS_DATALIST_ID}>
            {ruleProviderNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <datalist id={SUB_RULES_DATALIST_ID}>
            {subRuleGroupNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </>
      )}

      <div className="rule-editor__actions">
        <button type="submit" disabled={!canSubmit}>
          {t('ruleEditor.saveButton')}
        </button>
        <button type="button" onClick={onCancel}>
          {t('ruleEditor.cancelButton')}
        </button>
      </div>
    </form>
  );
}
