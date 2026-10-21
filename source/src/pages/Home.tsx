import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { ipc } from "../lib/ipc";
import { useNotesStore } from "../lib/store";
import { ReleaseNotes } from "../components/ReleaseNotes";
import humlaIcon from "../../src-tauri/icons/icon.png";
import { useLocale, useT } from "../lib/locale";

export function Home() {
  const locale = useLocale();
  const t = useT();
  const navigate = useNavigate();
  const notes = useNotesStore((s) => s.notes);
  const upsert = useNotesStore((s) => s.upsertLocal);

  const { total, summarized } = useMemo(() => {
    let summarized = 0;
    for (const n of notes) if (n.summary.trim()) summarized += 1;
    return { total: notes.length, summarized };
  }, [notes]);

  const notesLabel = locale === "zh-CN" ? `${total} 篇笔记` : total === 1 ? "1 note" : `${total} notes`;

  async function newNote() {
    const note = await ipc.createNote();
    upsert(note);
    navigate(`/note/${note.id}`);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="home-content">
        <div className="home-welcome">
          <div className="flex flex-col items-center gap-3">
            <img
              src={humlaIcon}
              alt="HoneyVoice"
              width={72}
              height={72}
              style={{ filter: "drop-shadow(0 6px 20px rgba(0, 0, 0, 0.16))" }}
            />
            <h1 className="text-4xl font-semibold tracking-tight leading-none">HoneyVoice</h1>
          </div>
          <p className="text-sm text-[var(--color-text-muted)] tabular-nums">
            {locale === "zh-CN" ? `${notesLabel}，${summarized} 篇已生成摘要` : `${notesLabel}, ${summarized} summarized`}
          </p>
          <button onClick={newNote} className="nd-btn nd-btn-primary no-drag mt-1">
            <Plus size={15} strokeWidth={1.8} />
            {t("New note")}
          </button>
        </div>
        <ReleaseNotes />
      </div>
    </div>
  );
}
