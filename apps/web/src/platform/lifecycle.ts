import { isNativePlatform, onAppStateChange } from './capacitor.js';

/**
 * NFR-REL-02 (v0.6.0 #8): flushes on every signal that a background-kill
 * might follow, not just one. `visibilitychange`/`beforeunload` alone
 * carried this before this file existed, and stay wired unconditionally —
 * `visibilitychange` genuinely does fire on Android WebView when the app
 * moves to the background. But `beforeunload` in particular is not a safe
 * *sole* dependency there: when Android's OS kills the process outright
 * (the low-memory-reclaim scenario this whole slice exists for), there is
 * no unload to fire it. `App.addListener('appStateChange')` (Capacitor,
 * native only) is the second, independent signal that covers exactly that
 * gap. Both can fire for the same backgrounding event — `flush` must be
 * idempotent, which is `AutoSaver.flush()`'s own existing guarantee, not
 * something this file adds.
 */
export function registerBackgroundFlush(flush: () => void): () => void {
  function handleVisibilityChange(): void {
    if (document.visibilityState !== 'hidden') return;
    flush();
  }
  function handleBeforeUnload(): void {
    flush();
  }
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('beforeunload', handleBeforeUnload);

  const unsubscribeAppStateChange = isNativePlatform()
    ? onAppStateChange((isActive) => {
        if (!isActive) flush();
      })
    : undefined;

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('beforeunload', handleBeforeUnload);
    unsubscribeAppStateChange?.();
  };
}
