import { useEffect, useRef, useState } from "react";
import { useT } from "../../lib/locale";
import { Row } from "../../pages/settings/components/Section";
import { Btn } from "../../pages/settings/components/Btn";

export function normalizeMimoEndpoint(value: string): string {
  const message = "Use an HTTPS URL without credentials, query parameters, or fragments.";
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(message); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash)
    throw new Error(message);
  return url.toString().replace(/\/+$/, "");
}

// Editing must not persist partial hostnames or send a stored credential to
// them. Summary and Chat share this explicit, validated commit boundary.
export function MimoEndpointField({ value, onSave }: { value: string; onSave: (value: string) => Promise<void> }) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ kind: "validation" } | { kind: "save"; message: string } | null>(null);
  const busy = useRef(false);
  useEffect(() => { setDraft(value); }, [value]);
  async function save() {
    if (busy.current) return;
    let normalized: string;
    try { normalized = normalizeMimoEndpoint(draft); }
    catch { setError({ kind: "validation" }); return; }
    busy.current = true;
    setSaving(true);
    setError(null);
    try { await onSave(normalized); setDraft(normalized); }
    catch (reason) { setError({ kind: "save", message: String(reason) }); }
    finally { busy.current = false; setSaving(false); }
  }
  return <Row label="MiMo API endpoint"
    description="Only the saved endpoint is used. Your MiMo key is sent to that endpoint; editing alone does not connect."
    control={<div className="w-72 max-w-full space-y-2">
      <form noValidate className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <input type="url" value={draft} disabled={saving}
          onChange={(event) => { setDraft(event.target.value); setError(null); }}
          placeholder="https://api.xiaomimimo.com/v1" aria-label={t("MiMo API base URL")}
          className="min-w-0 flex-1 text-sm px-3 py-1.5 rounded-md border border-[var(--color-line-visible)] bg-[var(--color-surface)] focus:border-[var(--color-text-muted)] transition-colors" />
        <Btn type="submit" disabled={saving || draft === value}>{t(saving ? "Saving…" : "Save endpoint")}</Btn>
      </form>
      {error && <p role="alert" className="text-xs text-[var(--color-danger)] break-words">{error.kind === "validation"
        ? t("Use an HTTPS URL without credentials, query parameters, or fragments.") : error.message}</p>}
    </div>} />;
}
