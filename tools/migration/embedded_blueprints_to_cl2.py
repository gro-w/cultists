#!/usr/bin/env python3
"""Replace embedded JSON blueprint graphs with self-contained CL2 payloads."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from blueprint_to_cl2 import convert_activity  # noqa: E402


def is_blueprint(value: object) -> bool:
    return isinstance(value, dict) and isinstance(value.get("nodes"), dict) and (
        isinstance(value.get("startNodeId"), str) or isinstance(value.get("connections"), list)
    )


def compact_cl2(source: str) -> str:
    """Collapse CL2 layout without changing quoted literal contents."""
    output: list[str] = []
    quote: str | None = None
    escaped = False
    in_comment = False
    pending_space = False
    index = 0
    while index < len(source):
        if in_comment:
            if source.startswith("*/", index):
                output.append(" */")
                in_comment = False
                index += 2
            elif source[index].isspace():
                pending_space = True
                index += 1
            else:
                if pending_space and output and not output[-1].endswith((" ", "(")):
                    output.append(" ")
                pending_space = False
                output.append(source[index])
                index += 1
            continue
        if quote:
            output.append(source[index])
            if escaped:
                escaped = False
            elif source[index] == "\\":
                escaped = True
            elif source[index] == quote:
                quote = None
            index += 1
            continue
        if source.startswith("/*", index):
            if pending_space and output and not output[-1].endswith(" "):
                output.append(" ")
            pending_space = False
            output.append("/*")
            in_comment = True
            index += 2
            continue
        if source[index] in ('"', "'"):
            if pending_space and output and not output[-1].endswith((" ", "(", "[")):
                output.append(" ")
            pending_space = False
            quote = source[index]
            output.append(source[index])
            index += 1
            continue
        if source[index].isspace():
            pending_space = True
            index += 1
            continue
        if pending_space and output and not output[-1].endswith((" ", "(", "[")):
            output.append(" ")
        pending_space = False
        output.append(source[index])
        index += 1
    return "".join(output).strip()


def walk(value: object, path: str, report: list[dict]) -> tuple[object, int]:
    if is_blueprint(value):
        result = convert_activity({"id": path, "blueprint": value})
        report.extend({"path": path, "message": item} if isinstance(item, str) else {"path": path, **item} for item in result.diagnostics)
        return {"cl2": compact_cl2(result.text)}, 1
    if isinstance(value, dict):
        total = 0
        converted = {}
        for key, item in value.items():
            replacement, count = walk(item, f"{path}.{key}", report)
            converted[key] = replacement
            total += count
        return converted, total
    if isinstance(value, list):
        converted = []
        total = 0
        for index, item in enumerate(value):
            replacement, count = walk(item, f"{path}[{index}]", report)
            converted.append(replacement)
            total += count
        return converted, total
    return value, 0


def convert_file(path: Path) -> tuple[int, list[dict]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    report: list[dict] = []
    converted, count = walk(value, path.as_posix(), report)
    if count:
        path.write_text(json.dumps(converted, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return count, report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args()
    files = [path for root in args.paths for path in (sorted(root.rglob("*.json")) if root.is_dir() else [root])]
    total = 0
    diagnostics: list[dict] = []
    for path in files:
        count, report = convert_file(path)
        total += count
        diagnostics.extend(report)
    print(json.dumps({"files": len(files), "embeddedBlueprints": total, "warningCount": len(diagnostics), "warnings": diagnostics}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
