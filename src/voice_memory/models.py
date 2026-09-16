from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class Segment:
    id: str
    start: float
    end: float
    speaker: str
    text: str
    confidence: float | None = None
    overlap: bool = False
    source: str = "transcript"

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
