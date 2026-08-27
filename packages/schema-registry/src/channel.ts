import type { StorageAdapter } from '@mcs/storage';

import type { BundleChannel } from './manifest.js';

/**
 * Resolution-time default (FR-UPD-02): callers that don't specify a channel
 * get Stable. This is a default *argument value*, not a "write a stable
 * preference on first run" step — the latter would regress the moment
 * storage is cleared, the former holds unconditionally.
 */
export const DEFAULT_BUNDLE_CHANNEL: BundleChannel = 'stable';

const CHANNELS: readonly BundleChannel[] = ['stable', 'beta'];

const CHANNEL_PREFERENCE_KEY = 'bundle/channel';

export type BundleStoreSlot = 'active' | 'previous';

/**
 * Stable and Beta are two independent slot-pairs, not one global "most
 * recently installed" pointer: switching to Beta and back to Stable must
 * return the same Stable bundle that was there before switching, not
 * whatever was installed most recently regardless of channel. `installBundle`
 * (`store.ts`) derives the channel half of this key from the verified
 * manifest's own `channel` field, never from a caller-supplied value — a
 * Beta-channelled manifest can then never land in the Stable slot-pair.
 */
export function channelSlotKey(channel: BundleChannel, slot: BundleStoreSlot): string {
  return `${channel}/${slot}`;
}

/**
 * The user's chosen channel preference, persisted through `StorageAdapter`
 * under a fixed key. A missing or corrupted stored value falls back to
 * `DEFAULT_BUNDLE_CHANNEL` rather than throwing — a damaged preference must
 * never brick the app, same reasoning as `resolveActiveBundle`'s own
 * fallback chain.
 */
export async function readBundleChannelPreference(adapter: StorageAdapter): Promise<BundleChannel> {
  const bytes = await adapter.get(CHANNEL_PREFERENCE_KEY);
  if (!bytes) return DEFAULT_BUNDLE_CHANNEL;

  const value = new TextDecoder().decode(bytes);
  return (CHANNELS as readonly string[]).includes(value)
    ? (value as BundleChannel)
    : DEFAULT_BUNDLE_CHANNEL;
}

export async function writeBundleChannelPreference(
  adapter: StorageAdapter,
  channel: BundleChannel,
): Promise<void> {
  await adapter.put(CHANNEL_PREFERENCE_KEY, new TextEncoder().encode(channel));
}
