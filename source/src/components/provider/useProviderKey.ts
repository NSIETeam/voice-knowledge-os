import { useEffect, useRef, useState } from "react";
import { ipc } from "../../lib/ipc";
import { providerRevision, useProviderRevision } from "../../lib/providerConfig";
import type { KeyProvider } from "../../lib/providers";

export type { KeyProvider };

// Shared per-provider API-key mechanics: stored-sentinel load, save, test.
// Presentation and commit semantics stay with the consumer — settings'
// ProviderKeyCard renders rows; the onboarding steps wrap `test()` to write
// their provider config when it passes (their "commit point"). The backend
// only ever reports a sentinel, never the key, so drafts are write-only.
export function useProviderKey(
  provider: KeyProvider,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const [hasKey, setHasKey] = useState(false);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const revision = useProviderRevision(provider);
  const scope = `${provider}:${enabled}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(true);
  const saveOperation = useRef<symbol | null>(null);
  const testOperation = useRef<{ id: symbol; revision: number } | null>(null);
  const verdictRevision = useRef(-1);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [result, setResult] = useState<
    null | { ok: true } | { ok: false; message: string }
  >(null);

  // Provider change = a different Keychain slot: reset the surface and
  // re-read the sentinel.
  // Disabled means the caller isn't showing this provider: don't open its
  // Keychain slot at all, since a read is a prompt on a fresh machine.
  useEffect(() => {
    setDraft("");
    setResult(null);
    setHasKey(false);
    setLoadedScope(null);
    setSaving(false);
    setTesting(false);
    saveOperation.current = null;
    testOperation.current = null;
  }, [provider, enabled]);

  useEffect(() => {
    let cancelled = false;
    if (verdictRevision.current !== revision) setResult(null);
    if (testOperation.current?.revision !== revision) {
      setTesting(false);
      testOperation.current = null;
    }
    if (!enabled) return;
    ipc
      .getProviderKey(provider)
      .then((v) => {
        if (!cancelled && providerRevision(provider) === revision) {
          setHasKey(v !== null);
          setLoadedScope(scope);
        }
      })
      .catch(() => {
        if (!cancelled && providerRevision(provider) === revision) setLoadedScope(scope);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, enabled, revision, scope]);

  async function save() {
    const key = draft.trim();
    if (!enabled || !key || saveOperation.current || testOperation.current) return;
    const operation = Symbol();
    saveOperation.current = operation;
    setSaving(true);
    const current = () => mounted.current && currentScope.current === scope && saveOperation.current === operation;
    try {
      await ipc.setProviderKey(provider, key);
      if (!current()) return;
      setDraft("");
      setHasKey(true);
      setResult(null);
    } catch (e) {
      if (current()) setResult({ ok: false, message: String(e) });
    } finally {
      if (current()) { saveOperation.current = null; setSaving(false); }
    }
  }

  // Resolves with the verdict so consumers can hang commit logic on a pass.
  async function test(): Promise<boolean> {
    if (!enabled || currentScope.current !== scope || saveOperation.current || testOperation.current) return false;
    // A caller can first await an endpoint write and then use this callback
    // from its original render (onboarding). Bind to the committed generation
    // at invocation, not to that render's now-stale revision.
    const operation = { id: Symbol(), revision: providerRevision(provider) };
    testOperation.current = operation;
    const current = () => mounted.current && currentScope.current === scope
      && testOperation.current === operation && providerRevision(provider) === operation.revision;
    setTesting(true);
    setResult(null);
    try {
      const r = await ipc.testProviderKey(provider);
      if (!current()) return false;
      verdictRevision.current = operation.revision;
      if (r.ok) {
        setResult({ ok: true });
        return true;
      }
      setResult({
        ok: false,
        message: `${r.status}: ${r.error ?? "unknown error"}`,
      });
      return false;
    } catch (e) {
      if (current()) {
        verdictRevision.current = operation.revision;
        setResult({ ok: false, message: String(e) });
      }
      return false;
    } finally {
      if (mounted.current && currentScope.current === scope && testOperation.current === operation) {
        testOperation.current = null;
        setTesting(false);
      }
    }
  }

  return { hasKey, loading: enabled && loadedScope !== scope, draft, setDraft, testing, saving, result, save, test };
}
