/** `[start, end)` UTF-16 code unit indices into the original rule line, ready for `String.prototype.slice`. */
export interface RuleFragment {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

/**
 * A rule line decomposed the way `rules/common/base.go#ParseRulePayload`
 * (MetaCubeX/mihomo v1.19.29) decomposes it, so a caller can replace
 * `target` or `payload` at its offset without touching the rest of the
 * line. `type` is normalised to upper case; the other fields are `null`
 * when upstream would leave them at their zero value (fewer than the
 * expected number of comma-separated segments).
 */
export interface ParsedRuleLine {
  readonly type: string;
  readonly payload: RuleFragment | null;
  readonly target: RuleFragment | null;
  readonly params: readonly RuleFragment[];
}

/**
 * These take their target from the *last* comma-separated segment instead
 * of the third, and have no params (`ParseRulePayload`'s second switch
 * case). `SUB-RULE`'s target is a sub-rule name, not a proxy/proxy-group —
 * callers resolving references must not conflate the two.
 */
const LAST_SEGMENT_IS_TARGET = new Set([
  'NOT',
  'OR',
  'AND',
  'SUB-RULE',
  'DOMAIN-REGEX',
  'PROCESS-NAME-REGEX',
  'PROCESS-PATH-REGEX',
]);

/**
 * Mirrors `ParseRulePayload` field-for-field, always as `needTarget: true`:
 * the only lines this app edits are `rules[]` / `sub-rules.<key>[]`
 * entries, which upstream always parses with a target. `needTarget: false`
 * only applies to rule-provider file bodies, which this app never parses
 * or rewrites.
 */
export function parseRuleLine(raw: string): ParsedRuleLine {
  const fields = splitFields(raw);
  const type = fields[0].value.toUpperCase();

  if (fields.length <= 1) {
    return { type, payload: null, target: null, params: [] };
  }

  if (type === 'MATCH') {
    return { type, payload: null, target: at(fields, 1), params: [] };
  }

  if (LAST_SEGMENT_IS_TARGET.has(type)) {
    const target = at(fields, fields.length - 1);
    // The rejoined value reproduces the original text only when there is no
    // whitespace around an internal comma; the span always covers the
    // original middle segments regardless, so replacing it still works.
    const payload = joinFields(fields.slice(1, fields.length - 1));
    return { type, payload, target, params: [] };
  }

  // default: TYPE,payload,target,params... — target is the fixed third
  // segment, never the last one (e.g. `IP-CIDR,198.18.0.0/16,REJECT,no-resolve`
  // must not take `no-resolve` as the target).
  return {
    type,
    payload: at(fields, 1),
    target: at(fields, 2),
    params: fields.slice(3),
  };
}

function at(fields: readonly RuleFragment[], index: number): RuleFragment | null {
  return fields[index] ?? null;
}

function joinFields(fields: readonly RuleFragment[]): RuleFragment | null {
  let joined: RuleFragment | null = null;
  for (const field of fields) {
    joined = joined
      ? { value: `${joined.value},${field.value}`, start: joined.start, end: field.end }
      : field;
  }
  return joined;
}

function splitFields(raw: string): [RuleFragment, ...RuleFragment[]] {
  const fields: RuleFragment[] = [];
  let segmentStart = 0;
  for (let i = 0; i <= raw.length; i += 1) {
    if (i === raw.length || raw[i] === ',') {
      fields.push(trimSegment(raw, segmentStart, i));
      segmentStart = i + 1;
    }
  }
  return fields as [RuleFragment, ...RuleFragment[]];
}

/** `trimArr`: trims each comma-split segment so offsets land on the entity text itself, not surrounding padding (`DOMAIN , example.com , PROXY` is valid input). */
function trimSegment(raw: string, start: number, end: number): RuleFragment {
  let s = start;
  let e = end;
  while (s < e && isSpace(raw[s])) s += 1;
  while (e > s && isSpace(raw[e - 1])) e -= 1;
  return { value: raw.slice(s, e), start: s, end: e };
}

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}
