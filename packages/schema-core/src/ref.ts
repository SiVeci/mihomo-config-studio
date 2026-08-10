import type { JsonSchema } from './types.js';

export class SchemaRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaRefError';
  }
}

const MAX_REF_HOPS = 16;

/**
 * Resolve `$ref`, restricted to local `#/$defs/<name>` pointers.
 *
 * Remote references are refused outright: following one would turn a schema
 * bundle into a network fetch, and a schema that can fetch is a schema that can
 * be swapped after signature verification (NFR-SEC-04, NFR-SEC-05).
 */
export function resolveRef(schema: JsonSchema, root: JsonSchema): JsonSchema {
  let current = schema;
  for (let hop = 0; hop < MAX_REF_HOPS; hop += 1) {
    const ref = current.$ref;
    if (ref === undefined) return current;

    if (!ref.startsWith('#/$defs/')) {
      throw new SchemaRefError(
        `Only local "#/$defs/..." references are allowed; refused: ${ref.slice(0, 64)}`,
      );
    }
    const name = ref.slice('#/$defs/'.length);
    if (name === '' || name.includes('/')) {
      throw new SchemaRefError(`Malformed local reference: ${ref.slice(0, 64)}`);
    }
    const target = root.$defs?.[name];
    if (!target) {
      throw new SchemaRefError(`Unresolved reference: ${ref.slice(0, 64)}`);
    }
    // Sibling keywords alongside $ref stay in effect (2020-12 semantics).
    const { $ref: _dropped, ...rest } = current;
    current = { ...target, ...rest };
  }
  throw new SchemaRefError(`Reference chain exceeds ${MAX_REF_HOPS} hops (possible cycle).`);
}
