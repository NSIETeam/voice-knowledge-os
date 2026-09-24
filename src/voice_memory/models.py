from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any


_SAFE_RECORD_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
_WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
    "COM¹", "COM²", "COM³", "LPT¹", "LPT²", "LPT³",
}


def validate_record_id(record_id: str) -> str:
    if not isinstance(record_id, str) or not _SAFE_RECORD_ID.fullmatch(record_id):
        raise ValueError("record ID must be a safe filename component")
    if record_id.endswith(".") or record_id.split(".", 1)[0].upper() in _WINDOWS_RESERVED_NAMES:
        raise ValueError("record ID is not a valid cross-platform filename")
    return record_id


def validate_record_title(title: str) -> str:
    forbidden = '<>:"/\\|?*\0'
    if (
        not isinstance(title, str)
        or not title
        or title != title.strip()
        or title in {".", ".."}
        or any(char in forbidden or ord(char) < 32 for char in title)
        or title.endswith((".", " "))
        or title.split(".", 1)[0].upper() in _WINDOWS_RESERVED_NAMES
        or len(title.encode("utf-16-le")) // 2 > 180
    ):
        raise ValueError("title must be a valid cross-platform filename, not a path")
    return title


@dataclass
class Segment:
    id: str
    start: float
    end: float
    speaker: str
    text: str
    confidence: float | None = None
    overlap: bool = False
    unclear: bool = False
    speaker_status: str = "unknown"
    source: str = "transcript"
    speaker_ids: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        # Keep records written before multi-speaker support readable and explicit.
        if not self.speaker_ids and self.speaker and self.speaker.casefold() != "unknown":
            self.speaker_ids = [self.speaker]

    def evidence(self, recording_title: str) -> str:
        stamp = f"{int(self.start // 60):02d}:{int(self.start % 60):02d}"
        return f"[[{recording_title}#^{self.id}|原文 {stamp}]]"


@dataclass
class ConversationRecord:
    id: str
    title: str
    created_at: str
    audio_path: str
    primary_mode: str
    audio_asset_id: str | None = None
    context: str = "未指定"
    people: list[str] = field(default_factory=list)
    company: str | None = None
    project: str | None = None
    sensitivity: str = "private"
    transcript_provider: str | None = None
    transcript_model: str | None = None
    transcript_language: str | None = None
    segments: list[Segment] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


PROFILES: dict[str, dict[str, Any]] = {
    "knowledge": {
        "name": "知识学习",
        "extract": ["concepts", "claims", "evidence", "questions", "links"],
        "create_tasks": False,
    },
    "decision": {
        "name": "方案与决策",
        "extract": ["problem", "assumptions", "options", "decision", "actions", "metrics"],
        "create_tasks": True,
    },
    "interview": {
        "name": "访谈与调研",
        "extract": ["background", "qa", "needs", "quotes", "contradictions", "insights"],
        "create_tasks": False,
    },
    "negotiation": {
        "name": "商务谈判",
        "extract": ["positions", "interests", "offers", "concessions", "commitments", "open_terms"],
        "create_tasks": True,
    },
    "relationship": {
        "name": "关系与日常对话",
        "extract": ["people", "preferences", "events", "agreements", "followups"],
        "create_tasks": False,
    },
    "evidence": {
        "name": "记录与证据",
        "extract": ["facts", "timeline", "participants", "quotes", "provenance"],
        "create_tasks": False,
    },
    "operations": {
        "name": "会议与运营",
        "extract": ["agenda", "progress", "risks", "owners", "deadlines", "next_steps"],
        "create_tasks": True,
    },
}
