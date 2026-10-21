import { useSyncExternalStore } from "react";

// Only invalidation counters live here. Never keys, drafts, URLs or responses.
// Increment after the native write commits so every mounted consumer sees
// the same credential/endpoint generation, including a pinned Note view.
const revisions = new Map<string, number>();
const listeners = new Set<() => void>();
export const providerRevision = (provider: string) => revisions.get(provider) ?? 0;
export function providerConfigurationChanged(provider: string) {
  revisions.set(provider, providerRevision(provider) + 1);
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useProviderRevision(provider: string) {
  return useSyncExternalStore(subscribe, () => providerRevision(provider));
}
