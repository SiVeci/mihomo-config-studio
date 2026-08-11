import type { Entity } from '@mcs/config-model';
import type { ConfigPath, MihomoYamlDocument } from '@mcs/yaml-engine';

import { GraphError, type Reference, type ReferenceIndex } from './reference-index.js';

export interface ImpactResult {
  readonly replaceable: readonly Reference[];
  readonly cascading: readonly Entity[];
}

/**
 * Lists everyone who references `entityId` before it is deleted, split into
 * references that can be fixed in place (change a rule's target, drop one
 * item from a `proxies`/`use` list) and entities that must be deleted too
 * because removing this reference would leave their `proxies` and `use`
 * both empty. A cascading entity is analyzed recursively, so a chain of
 * now-empty groups is fully expanded rather than stopping one level deep.
 */
export function analyzeImpact(
  document: MihomoYamlDocument,
  index: ReferenceIndex,
  entityId: string,
): ImpactResult {
  const root = index.entity(entityId);
  if (!root) {
    throw new GraphError('GRAPH_ENTITY_NOT_FOUND', 'No entity exists with this id.', entityId);
  }

  const replaceable: Reference[] = [];
  const cascading: Entity[] = [];
  const cascadingIds = new Set<string>();

  function visit(id: string, name: string): void {
    const seqRefsByOwner = new Map<string, Reference[]>();
    for (const ref of index.referencesTo(id)) {
      if (ref.referenceType !== 'seq-item') {
        replaceable.push(ref);
        continue;
      }
      const owned = seqRefsByOwner.get(ref.fromId);
      if (owned) owned.push(ref);
      else seqRefsByOwner.set(ref.fromId, [ref]);
    }

    for (const [ownerId, refs] of seqRefsByOwner) {
      const owner = index.entity(ownerId);
      if (!owner) continue;
      if (wouldEmptyOwner(document, owner.sourcePath.slice(0, 2), name)) {
        if (!cascadingIds.has(owner.id)) {
          cascadingIds.add(owner.id);
          cascading.push(owner);
          visit(owner.id, owner.serializedName);
        }
      } else {
        replaceable.push(...refs);
      }
    }
  }

  visit(root.id, root.serializedName);
  return { replaceable, cascading };
}

/** True when removing every occurrence of `name` leaves both lists empty. */
function wouldEmptyOwner(
  document: MihomoYamlDocument,
  groupPath: ConfigPath,
  name: string,
): boolean {
  const proxies = document.getIn([...groupPath, 'proxies']);
  const use = document.getIn([...groupPath, 'use']);
  const remaining = [
    ...(Array.isArray(proxies) ? proxies : []),
    ...(Array.isArray(use) ? use : []),
  ].filter((item) => item !== name);
  return remaining.length === 0;
}
