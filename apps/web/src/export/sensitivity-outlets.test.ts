import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * NFR-SEC-08, v0.9.0 #13. This module's own doc comment names three real
 * exits of "the same judgement": project bundle export, clipboard copy, and
 * Android share. In this codebase those are, respectively, `ExportDialog.tsx`
 * (also the `.yaml`/`.mcsproj`/invalid-draft file exports), `ShareDialog.tsx`
 * (the only other place `describeSensitivity`'s findings are rendered), and
 * `SubscriptionField.tsx` (`apps/web/src/form/`, the only file under
 * `apps/web/src` that touches the Clipboard API at all — confirmed by a
 * repo-wide grep before writing this, not assumed).
 *
 * `SubscriptionField` is deliberately **not** checked for importing
 * `sensitivity.ts` below, unlike the other two: it copies one field's own
 * value the user is already looking at directly (always the `proxy-
 * providers` subscription URL it is exclusively wired to via `ui.schema.json`
 * `control: 'subscription-url'`), never a whole document that could contain
 * unrelated sensitive fields the user is not currently looking at — that is
 * NFR-SEC-02's per-field masking story, a different judgement with nothing
 * to classify (there is exactly one possible `kind`, decided once upstream by
 * the schema, not per-render here). Requiring it to import a document-wide
 * classifier it has no use for would be a manufactured dependency, not a real
 * shared-judgement guarantee.
 */
const EXPORT_DIR = dirname(fileURLToPath(import.meta.url));
const FORM_DIR = join(EXPORT_DIR, '../form');

const EXPORT_DIALOG = readFileSync(join(EXPORT_DIR, 'ExportDialog.tsx'), 'utf8');
const SHARE_DIALOG = readFileSync(join(EXPORT_DIR, 'ShareDialog.tsx'), 'utf8');
const SUBSCRIPTION_FIELD = readFileSync(join(FORM_DIR, 'SubscriptionField.tsx'), 'utf8');

describe('ExportDialog and ShareDialog share one sensitivity judgement, not two (NFR-SEC-08)', () => {
  it.each([
    ['ExportDialog.tsx', EXPORT_DIALOG],
    ['ShareDialog.tsx', SHARE_DIALOG],
  ])(
    '%s imports its findings from ./sensitivity.js rather than deriving its own',
    (_name, source) => {
      expect(source).toMatch(/from ['"]\.\/sensitivity\.js['"]/);
    },
  );

  it('neither dialog calls @mcs/project-format’s describeSensitivity directly — only sensitivity.ts’s own wrapper does', () => {
    // A direct call would still work today (findSensitivity is a thin pass-
    // through), but it would mean a future change to the wrapper (e.g. an
    // extra argument, a caching layer) silently stops applying to whichever
    // dialog bypassed it — the two callers must go through the one seam.
    for (const source of [EXPORT_DIALOG, SHARE_DIALOG]) {
      expect(source).not.toContain('describeSensitivity');
    }
  });
});

/**
 * These four patterns (`packages/project-format/src/mcsproj.ts`) are the
 * *entire* classification logic `describeSensitivity` runs — this is a
 * literal-text duplication check, not a semantic one: a rewritten regex that
 * classifies the same things differently would not be caught here, only a
 * copy-pasted (or near-identical) second copy of these exact patterns living
 * somewhere it would silently drift from the original.
 */
const CLASSIFIER_FRAGMENTS = [
  'password|passwd|secret|token|psk|auth-?str|private-?key|client-?secret|credential|ca-?str',
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
  'BEGIN [A-Z ]*PRIVATE KEY',
  'url\\s*:\\s*["\']?https?:\\/\\/',
];

describe('none of the three outlets re-implements a second copy of the classifier (NFR-SEC-08)', () => {
  it.each([
    ['ExportDialog.tsx', EXPORT_DIALOG],
    ['ShareDialog.tsx', SHARE_DIALOG],
    ['SubscriptionField.tsx', SUBSCRIPTION_FIELD],
  ])('%s contains none of describeSensitivity’s own regex fragments', (_name, source) => {
    for (const fragment of CLASSIFIER_FRAGMENTS) {
      expect(source).not.toContain(fragment);
    }
  });
});
