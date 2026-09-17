from __future__ import annotations

import argparse
import json
from pathlib import Path

from .compiler import write_compiled
from .api import serve
from .models import ConversationRecord, Segment, PROFILES


def demo_record() -> ConversationRecord:
    return ConversationRecord(
        id="demo-2026-09-16-001",
        title="2026-09-16 产品讨论",
        created_at="2026-09-16T10:00:00+08:00",
        audio_path="Attachments/2026-09-16-product-discussion.m4a",
        primary_mode="decision",
        context="产品讨论",
        people=["[[张三]]", "[[李四]]"],
        project="[[Voice Memory]]",
        sensitivity="confidential",
        segments=[
            Segment("seg-0001", 0, 18.4, "Speaker 1", "第一阶段先做桌面端本地处理，手机端作为录音入口。", 0.96),
            Segment("seg-0002", 18.4, 31.2, "Speaker 2", "每一个决策都要能回到原始音频和转写证据。", 0.91),
        ],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Compile conversation records into an Obsidian vault")
    sub = parser.add_subparsers(dest="command", required=True)
    profiles = sub.add_parser("profiles", help="list processing profiles")
    demo = sub.add_parser("demo", help="write a runnable demo record")
    demo.add_argument("vault", type=Path)
    compile_cmd = sub.add_parser("compile", help="compile a JSON conversation record")
    compile_cmd.add_argument("record", type=Path)
    compile_cmd.add_argument("vault", type=Path)
    server = sub.add_parser("serve", help="start the local API")
    server.add_argument("root", type=Path, nargs="?", default=Path.home() / ".voice-memory")
    server.add_argument("--host", default="127.0.0.1")
    server.add_argument("--port", type=int, default=8765)
    server.add_argument("--parent-pid", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.command == "profiles":
        print(json.dumps(PROFILES, ensure_ascii=False, indent=2))
    elif args.command == "demo":
        path = write_compiled(demo_record(), args.vault)
        print(path)
    elif args.command == "serve":
        serve(str(args.root), args.host, args.port, args.parent_pid)
    else:
        record = ConversationRecord(**json.loads(args.record.read_text(encoding="utf-8")))
        record.segments = [Segment(**segment) for segment in record.segments]
        print(write_compiled(record, args.vault))


if __name__ == "__main__":
    main()
