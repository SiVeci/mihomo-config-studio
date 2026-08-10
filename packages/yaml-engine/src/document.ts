import {
  Composer,
  CST,
  LineCounter,
  Parser,
  isAlias,
  isCollection,
  isDocument,
  isMap,
  isPair,
  isScalar,
  isSeq,
  type Document,
  type Node,
  type Scalar,
  type ParsedNode,
} from 'yaml';

import { YamlEngineError, pathNotFound, pathNotScalar } from './errors.js';
import type { TextRange, YamlIssue } from './issues.js';
import { resolveLimits, utf8ByteLength, type YamlLimits } from './limits.js';
import { formatPath, type ConfigPath, type PathSegment } from './path.js';

/**
 * Writeback strategy currently in force.
 *
 * - `cst` — every edit so far was a scalar replacement applied directly to the
 *   concrete syntax tree, so serialising reproduces the source byte for byte
 *   outside the edited spans.
 * - `ast` — a structural edit happened; serialisation now goes through the
 *   `Document`, which still preserves comments, anchors, key order and unknown
 *   fields but may normalise incidental whitespace.
 */
export type WritebackMode = 'cst' | 'ast';

export interface ParseOptions {
  limits?: Partial<YamlLimits>;
}

export interface ParseResult {
  /** `null` only when the source could not be composed into a document at all. */
  document: MihomoYamlDocument | null;
  issues: YamlIssue[];
}

export interface SerializeOptions {
  /** 0 disables line folding; long proxy URLs must not be wrapped. */
  lineWidth?: number;
  indent?: number;
}

const DEFAULT_SERIALIZE: Required<SerializeOptions> = { lineWidth: 0, indent: 2 };

/**
 * Plain scalars that YAML 1.2 core would resolve to a non-string type. When the
 * caller sets a *string* to one of these we must force quoting, otherwise the
 * round-trip silently changes `"1"` into `1`.
 */
const AMBIGUOUS_PLAIN =
  /^(|~|null|Null|NULL|true|True|TRUE|false|False|FALSE|[-+]?[0-9]+|[-+]?[0-9]*\.[0-9]+([eE][-+]?[0-9]+)?|0o[0-7]+|0x[0-9a-fA-F]+|[-+]?\.(inf|Inf|INF)|\.(nan|NaN|NAN))$/;

export class MihomoYamlDocument {
  readonly #source: string;
  readonly #limits: YamlLimits;
  #tokens: CST.Token[];
  #doc: Document.Parsed;
  #mode: WritebackMode = 'cst';
  /** Cached parse of the *current* text, used to resolve line/column positions. */
  #positions: { text: string; doc: Document.Parsed; lineCounter: LineCounter } | null;

  private constructor(
    source: string,
    tokens: CST.Token[],
    doc: Document.Parsed,
    lineCounter: LineCounter,
    limits: YamlLimits,
  ) {
    this.#source = source;
    this.#tokens = tokens;
    this.#doc = doc;
    this.#limits = limits;
    this.#positions = { text: source, doc, lineCounter };
  }

  static parse(source: string, options: ParseOptions = {}): ParseResult {
    const limits = resolveLimits(options.limits);
    const issues: YamlIssue[] = [];

    const bytes = utf8ByteLength(source);
    if (bytes > limits.maxBytes) {
      return {
        document: null,
        issues: [
          {
            severity: 'error',
            code: 'yaml.limit.size',
            message: `YAML input is ${bytes} bytes, above the ${limits.maxBytes} byte limit.`,
          },
        ],
      };
    }

    const lineCounter = new LineCounter();
    let tokens: CST.Token[];
    let docs: Document.Parsed[];
    try {
      tokens = Array.from(new Parser(lineCounter.addNewLine).parse(source));
      docs = Array.from(
        new Composer({
          keepSourceTokens: true,
          // Mihomo parses with gopkg.in/yaml.v3, which honours `<<` merge keys.
          merge: true,
        }).compose(tokens),
      );
    } catch (cause) {
      return {
        document: null,
        issues: [
          {
            severity: 'error',
            code: 'yaml.parse.failed',
            message: cause instanceof Error ? cause.message : 'YAML could not be parsed.',
          },
        ],
      };
    }

    if (docs.length === 0) {
      return {
        document: null,
        issues: [
          { severity: 'error', code: 'yaml.parse.empty', message: 'No YAML document found.' },
        ],
      };
    }
    if (docs.length > limits.maxDocuments) {
      return {
        document: null,
        issues: [
          {
            severity: 'error',
            code: 'yaml.limit.documents',
            message: `Stream contains ${docs.length} documents, above the ${limits.maxDocuments} document limit.`,
          },
        ],
      };
    }

    const doc = docs[0] as Document.Parsed;
    for (const error of doc.errors) {
      issues.push({
        severity: 'error',
        code: `yaml.syntax.${error.code}`,
        message: error.message,
        range: offsetsToRange(lineCounter, error.pos[0], error.pos[1]),
      });
    }
    for (const warning of doc.warnings) {
      issues.push({
        severity: 'warning',
        code: `yaml.syntax.${warning.code}`,
        message: warning.message,
        range: offsetsToRange(lineCounter, warning.pos[0], warning.pos[1]),
      });
    }

    const depth = measureDepth(doc.contents);
    if (depth > limits.maxDepth) {
      issues.push({
        severity: 'error',
        code: 'yaml.limit.depth',
        message: `YAML nesting depth ${depth} exceeds the ${limits.maxDepth} level limit.`,
      });
      return { document: null, issues };
    }

    if (doc.errors.length > 0) {
      // Keep the document so callers can still show the source and locate the
      // failure, but the structured view is not trustworthy (FR-YAML-05).
      return {
        document: new MihomoYamlDocument(source, tokens, doc, lineCounter, limits),
        issues,
      };
    }

    return { document: new MihomoYamlDocument(source, tokens, doc, lineCounter, limits), issues };
  }

  /** Original text as imported; never mutated. */
  get source(): string {
    return this.#source;
  }

  get mode(): WritebackMode {
    return this.#mode;
  }

  get limits(): YamlLimits {
    return this.#limits;
  }

  /** True when the source has syntax errors and the structured view is frozen. */
  get hasSyntaxErrors(): boolean {
    return this.#doc.errors.length > 0;
  }

  /**
   * Materialised plain-JS projection. Alias expansion is bounded by
   * `limits.maxAliasCount`, so a billion-laughs payload throws rather than
   * hanging the caller (NFR-SEC-06).
   */
  toJS(): unknown {
    return this.#doc.toJS({ maxAliasCount: this.#limits.maxAliasCount });
  }

  getIn(path: ConfigPath): unknown {
    if (path.length === 0) return this.toJS();
    const node = this.#doc.getIn(path as PathSegment[], true);
    if (node === undefined) return undefined;
    if (isScalar(node)) return node.value;
    if (isCollection(node)) {
      // The document must be passed through: merge keys and aliases can only be
      // resolved against it, and it carries the alias budget.
      return node.toJS(this.#doc, { maxAliasCount: this.#limits.maxAliasCount });
    }
    return node;
  }

  hasIn(path: ConfigPath): boolean {
    if (path.length === 0) return true;
    return this.#doc.hasIn(path as PathSegment[]);
  }

  /**
   * Replace the value of an existing scalar.
   *
   * This is the hot path for form editing. While no structural edit has
   * happened it rewrites the concrete syntax tree in place, so quoting style,
   * comments, anchors and every untouched byte survive verbatim (FR-YAML-03).
   */
  setScalarIn(path: ConfigPath, value: string | number | boolean | null): void {
    if (path.length === 0) {
      throw new YamlEngineError(
        'YAML_INVALID_OPERATION',
        'Cannot set the document root as scalar.',
      );
    }
    const node = this.#doc.getIn(path as PathSegment[], true);
    if (node === undefined) throw pathNotFound(path);
    if (!isScalar(node)) throw pathNotScalar(path);

    if (this.#mode === 'cst' && applyCstScalarEdit(node, value)) {
      node.value = value;
      this.#invalidatePositions();
      return;
    }

    this.#doc.setIn(path as PathSegment[], value);
    this.#markStructural();
  }

  /**
   * Rename a map key while keeping its position, value node, comments and
   * anchors. Used by the reference cascade for keyed collections such as
   * `hosts` and `dns.policy` (FR-REL-02).
   */
  renameKeyIn(mapPath: ConfigPath, oldKey: string, newKey: string): void {
    if (oldKey === newKey) return;
    const map =
      mapPath.length === 0 ? this.#doc.contents : this.#doc.getIn(mapPath as PathSegment[], true);
    if (!isMap(map)) throw pathNotFound([...mapPath, oldKey]);
    const pair = map.items.find((item) => isPair(item) && keyOf(item.key) === oldKey);
    if (!pair) throw pathNotFound([...mapPath, oldKey]);
    if (map.items.some((item) => isPair(item) && keyOf(item.key) === newKey)) {
      throw new YamlEngineError(
        'YAML_INVALID_OPERATION',
        `Key ${formatPath([...mapPath, newKey])} already exists.`,
        [...mapPath, newKey],
      );
    }

    const keyNode = pair.key;
    if (this.#mode === 'cst' && isScalar(keyNode) && applyCstScalarEdit(keyNode, newKey)) {
      keyNode.value = newKey;
      this.#invalidatePositions();
      return;
    }
    if (isScalar(keyNode)) {
      keyNode.value = newKey;
    } else {
      pair.key = this.#doc.createNode(newKey) as ParsedNode;
    }
    this.#markStructural();
  }

  /** Create or replace a node, including intermediate containers. */
  setIn(path: ConfigPath, value: unknown): void {
    if (path.length === 0) {
      throw new YamlEngineError('YAML_INVALID_OPERATION', 'Cannot replace the document root.');
    }
    this.#doc.setIn(path as PathSegment[], value);
    this.#markStructural();
  }

  deleteIn(path: ConfigPath): void {
    if (path.length === 0) {
      throw new YamlEngineError('YAML_INVALID_OPERATION', 'Cannot delete the document root.');
    }
    if (!this.#doc.hasIn(path as PathSegment[])) throw pathNotFound(path);
    this.#doc.deleteIn(path as PathSegment[]);
    this.#markStructural();
  }

  /** Append to the sequence at `path`. */
  appendIn(path: ConfigPath, value: unknown): void {
    const seq =
      path.length === 0 ? this.#doc.contents : this.#doc.getIn(path as PathSegment[], true);
    if (!isSeq(seq)) {
      throw new YamlEngineError(
        'YAML_INVALID_OPERATION',
        `Node at ${formatPath(path)} is not a sequence.`,
        path,
      );
    }
    seq.add(this.#doc.createNode(value));
    this.#markStructural();
  }

  /** Reorder a sequence item, preserving the moved node with its comments (FR-RULE-02). */
  moveSeqItem(path: ConfigPath, from: number, to: number): void {
    const seq =
      path.length === 0 ? this.#doc.contents : this.#doc.getIn(path as PathSegment[], true);
    if (!isSeq(seq)) {
      throw new YamlEngineError(
        'YAML_INVALID_OPERATION',
        `Node at ${formatPath(path)} is not a sequence.`,
        path,
      );
    }
    const size = seq.items.length;
    if (from < 0 || from >= size || to < 0 || to >= size) {
      throw new YamlEngineError(
        'YAML_INVALID_OPERATION',
        `Sequence index out of range for ${formatPath(path)} (size ${size}).`,
        path,
      );
    }
    if (from === to) return;
    const [moved] = seq.items.splice(from, 1);
    seq.items.splice(to, 0, moved as ParsedNode);
    this.#markStructural();
  }

  /** Serialise the current state. */
  toText(options: SerializeOptions = {}): string {
    if (this.#mode === 'cst') {
      return this.#tokens.map((token) => CST.stringify(token)).join('');
    }
    const merged = { ...DEFAULT_SERIALIZE, ...options };
    return this.#doc.toString({ lineWidth: merged.lineWidth, indent: merged.indent });
  }

  /**
   * Re-parse the serialised state so that subsequent scalar edits are byte
   * exact again. Called after a save, not after every keystroke.
   */
  commit(options: SerializeOptions = {}): MihomoYamlDocument {
    const text = this.toText(options);
    const result = MihomoYamlDocument.parse(text, { limits: this.#limits });
    if (!result.document) {
      throw new YamlEngineError(
        'YAML_PARSE_FAILED',
        'Serialised document could not be re-parsed; refusing to commit.',
      );
    }
    return result.document;
  }

  /** Line/column span of a node in the *current* text (FR-VAL-02). */
  locate(path: ConfigPath): TextRange | null {
    const { doc, lineCounter } = this.#positionState();
    const node = path.length === 0 ? doc.contents : doc.getIn(path as PathSegment[], true);
    if (!node || typeof node !== 'object' || !('range' in node) || !node.range) return null;
    const range = node.range as [number, number, number];
    return offsetsToRange(lineCounter, range[0], range[1]);
  }

  /** Every addressable leaf path, used to detect fields no schema module claims. */
  leafPaths(): ConfigPath[] {
    const out: ConfigPath[] = [];
    collectLeafPaths(this.#doc.contents, [], out);
    return out;
  }

  /** Anchors declared anywhere in the document, for round-trip assertions. */
  anchors(): string[] {
    const names = new Set<string>();
    collectAnchors(this.#doc.contents, names);
    return [...names].sort();
  }

  #markStructural(): void {
    this.#mode = 'ast';
    this.#invalidatePositions();
  }

  #invalidatePositions(): void {
    this.#positions = null;
  }

  #positionState(): { doc: Document.Parsed; lineCounter: LineCounter } {
    const text = this.toText();
    if (this.#positions && this.#positions.text === text) return this.#positions;
    const lineCounter = new LineCounter();
    const tokens = Array.from(new Parser(lineCounter.addNewLine).parse(text));
    const docs = Array.from(new Composer({ keepSourceTokens: true, merge: true }).compose(tokens));
    const doc = docs[0] as Document.Parsed;
    this.#positions = { text, doc, lineCounter };
    return this.#positions;
  }
}

function applyCstScalarEdit(node: Scalar, value: string | number | boolean | null): boolean {
  const srcToken = node.srcToken;
  if (!srcToken || !CST.isScalar(srcToken)) return false;

  const text = value === null ? 'null' : String(value);
  const forcePlain = typeof value !== 'string';
  const currentType = srcToken.type;
  const needsQuote =
    typeof value === 'string' &&
    (currentType === 'scalar' || currentType === 'block-scalar'
      ? AMBIGUOUS_PLAIN.test(value)
      : false);

  const context = forcePlain
    ? ({ type: 'PLAIN' } as const)
    : needsQuote
      ? ({ type: 'QUOTE_DOUBLE' } as const)
      : undefined;

  try {
    CST.setScalarValue(srcToken, text, context);
  } catch {
    return false;
  }

  // Verify the token now reads back as what we asked for; if the library could
  // not represent the value in the existing style we fall back to AST mode
  // rather than emitting a document that means something else.
  const resolved = CST.resolveAsScalar(srcToken);
  if (resolved.value !== text) return false;
  if (typeof value === 'string' && resolved.type === 'PLAIN' && AMBIGUOUS_PLAIN.test(value)) {
    return false;
  }
  return true;
}

function keyOf(key: unknown): unknown {
  return isScalar(key) ? key.value : key;
}

function offsetsToRange(lineCounter: LineCounter, start: number, end: number): TextRange {
  const startPos = lineCounter.linePos(start);
  const endPos = lineCounter.linePos(end);
  return {
    start: { offset: start, line: startPos.line, column: startPos.col },
    end: { offset: end, line: endPos.line, column: endPos.col },
  };
}

function measureDepth(node: unknown, depth = 1): number {
  if (isMap(node) || isSeq(node)) {
    let max = depth;
    for (const item of node.items) {
      const child = isPair(item) ? item.value : item;
      max = Math.max(max, measureDepth(child, depth + 1));
    }
    return max;
  }
  if (isDocument(node)) return measureDepth(node.contents, depth);
  return depth;
}

function collectLeafPaths(node: unknown, prefix: PathSegment[], out: ConfigPath[]): void {
  if (isMap(node)) {
    for (const item of node.items) {
      if (!isPair(item)) continue;
      const key = keyOf(item.key);
      if (typeof key !== 'string' && typeof key !== 'number') continue;
      collectLeafPaths(item.value, [...prefix, key], out);
    }
    if (node.items.length === 0) out.push(prefix);
    return;
  }
  if (isSeq(node)) {
    node.items.forEach((item, index) => collectLeafPaths(item, [...prefix, index], out));
    if (node.items.length === 0) out.push(prefix);
    return;
  }
  out.push(prefix);
}

function collectAnchors(node: unknown, out: Set<string>): void {
  if (isScalar(node) || isMap(node) || isSeq(node)) {
    const anchor = (node as Node).anchor;
    if (anchor) out.add(anchor);
  }
  if (isMap(node)) {
    for (const item of node.items) {
      if (!isPair(item)) continue;
      collectAnchors(item.key, out);
      collectAnchors(item.value, out);
    }
    return;
  }
  if (isSeq(node)) {
    for (const item of node.items) collectAnchors(item, out);
    return;
  }
  if (isAlias(node)) return;
}
