#!/usr/bin/env python3
"""Convert canonical Activity blueprint JSON into the CL2 draft text form.

This is a migration/export tool only. It does not change canonical JSON or act
as a CL2 parser/runtime. Unsupported or lossy cases are reported explicitly.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


FLOW_PORTS = {"flowIn", "flowOut", "true", "false", "default"}
RESERVED_IDS = {"default", "option", "reusablevalue", "end"}
VALUE_ONLY_TYPES = {
    "arithmetic", "conditionalValue", "getVariable", "getGlobal", "getProperty",
    "getStructureDefinition", "getDatabaseDefinition", "findRecordsValue", "getRecordValue",
    "getRuntimeCollection", "getRuntimeRecord", "mergeRecords", "arrayAppend",
    "getPublicVariable", "getLanguage", "publicVariableCondition",
    "arrayGet", "arrayAppend", "getPublicVariable", "getLanguage",
    "publicVariableCondition", "getGameTime", "getActivityInstanceCount",
    "getQueueEntryCount", "getScheduleInstanceCount", "prerequisite", "activityExpiry",
}


@dataclass
class ConversionResult:
    text: str
    diagnostics: list[str] = field(default_factory=list)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _safe_id(value: str) -> str:
    result = re.sub(r"[^A-Za-z0-9_.-]", "_", value)
    if not result or not re.match(r"[A-Za-z_]", result):
        result = "n_" + result
    return result


def _value_name(node_id: str, port: str) -> str:
    return _safe_id(f"{node_id}__{port}")


def _input_items(node: dict[str, Any]) -> list[tuple[str, Any]]:
    """Return inputs in the stable port order where the draft defines one.

    Connection normalization can append a wired input after existing literal
    inputs.  Arithmetic is the important current case: its canonical order is
    operator, left, right, not JSON insertion order.
    """
    inputs = node.get("inputs") or {}
    preferred = {
        "arithmetic": ["operator", "left", "right"],
        "conditionalValue": ["condition", "whenTrue", "whenFalse"],
        "branch": ["condition"],
    }.get(node.get("type"), [])
    ordered = [key for key in preferred if key in inputs]
    ordered.extend(key for key in inputs if key not in ordered)
    return [(key, inputs[key]) for key in ordered]


def _is_flow_edge(connection: dict[str, Any]) -> bool:
    return connection.get("fromPort") in FLOW_PORTS or connection.get("toPort") == "flowIn" or str(connection.get("fromPort", "")).startswith("option")


def _normalize(blueprint: dict[str, Any], diagnostics: list[str]) -> tuple[dict[str, dict[str, Any]], str | None]:
    nodes = {}
    for raw_id, raw_node in (blueprint.get("nodes") or {}).items():
        node = dict(raw_node or {})
        node["id"] = node.get("id") or raw_id
        node["inputs"] = dict(node.get("inputs") or {})
        node["next"] = dict(node.get("next") or {})
        nodes[raw_id] = node

    for connection in blueprint.get("connections") or []:
        source_id = connection.get("fromNodeId")
        target_id = connection.get("toNodeId")
        source = nodes.get(source_id)
        target = nodes.get(target_id)
        if not source or not target:
            diagnostics.append(f"connection references missing node: {source_id!r} -> {target_id!r}")
            continue
        from_port = connection.get("fromPort")
        to_port = connection.get("toPort")
        if _is_flow_edge(connection):
            source["next"][from_port] = {"nodeId": target_id, "port": to_port}
        else:
            target["inputs"][to_port] = {"nodeId": source_id, "port": from_port}

    # Legacy choice options are already a flow contract in the blueprint, but
    # normalize them so the exporter does not lose their branches.
    for node in nodes.values():
        if node.get("type") == "choice":
            for index, option in enumerate(node["inputs"].get("options") or []):
                target = option.get("next") if isinstance(option, dict) else None
                if target and f"option{index}" not in node["next"]:
                    node["next"][f"option{index}"] = {"nodeId": target, "port": "flowIn"}

    start = blueprint.get("startNodeId")
    if not start:
        start = next((node["id"] for node in nodes.values() if node.get("type") == "flowStart"), None)
    return nodes, start


def _declared_pins(node: dict[str, Any], key: str) -> list[Any] | None:
    """Return an explicitly declared pin list, if the node carries one."""
    if key not in node:
        return None
    value = node.get(key)
    return value if isinstance(value, list) else []


def _classify_nodes(nodes: dict[str, dict[str, Any]], diagnostics: list[str]) -> dict[str, str]:
    """Classify nodes using the four legal blueprint pin combinations.

    Activity JSON normally stores connections rather than a full node-port
    declaration, so missing declarations are inferred from normalized incoming
    flow edges, outgoing flow edges, value inputs, and the registry's known
    value-only node types. Explicit pin arrays, when present on a custom node,
    take precedence over those fallbacks.
    """
    incoming_flow: set[str] = set()
    for node in nodes.values():
        for target in (node.get("next") or {}).values():
            if isinstance(target, dict) and target.get("nodeId") in nodes:
                incoming_flow.add(target["nodeId"])

    categories: dict[str, str] = {}
    for node_id, node in nodes.items():
        node_type = node.get("type", "unknown")
        flow_inputs = _declared_pins(node, "flowInputs")
        flow_outputs = _declared_pins(node, "flowOutputs")
        value_inputs = _declared_pins(node, "valueInputs")
        value_outputs = _declared_pins(node, "valueOutputs")

        has_flow_input = bool(flow_inputs) if flow_inputs is not None else node_id in incoming_flow
        has_flow_output = bool(flow_outputs) if flow_outputs is not None else bool(node.get("next"))
        has_value_input = bool(value_inputs) if value_inputs is not None else bool(node.get("inputs"))
        has_value_output = bool(value_outputs) if value_outputs is not None else node_type in VALUE_ONLY_TYPES

        if node_type == "flowStart":
            has_flow_input = False
            has_flow_output = True
            has_value_output = False

        if has_flow_input and has_value_output:
            diagnostics.append(f"{node_id}: flow input and value output cannot coexist")
            categories[node_id] = "invalid"
        elif has_flow_input:
            categories[node_id] = "flow"
        elif has_value_output:
            categories[node_id] = "value"
        elif has_flow_output:
            categories[node_id] = "start"
        elif has_value_input:
            categories[node_id] = "receiver"
        else:
            diagnostics.append(f"{node_id}: node has no recognizable blueprint pin combination")
            categories[node_id] = "invalid"
    return categories


def _flow_label(port: str, node: dict[str, Any], diagnostics: list[str]) -> str:
    if port in {"flowOut", "default"}:
        return "default"
    if node.get("type") == "framework:diceCheck":
        dice_check_ports = {
            "largeSuccess": "option<1>",
            "success": "option<2>",
            "failure": "option<3>",
            "largeFailure": "default",
        }
        if port in dice_check_ports:
            return dice_check_ports[port]
    if port == "true":
        return "option<1>"
    if port == "false":
        return "default"
    match = re.fullmatch(r"option<?(\d+)>?", str(port))
    if match:
        number = int(match.group(1))
        # Existing choice nodes use option0; CL2 numbering starts at 1.
        return f"option<{number + 1 if str(port) == 'option' + match.group(1) else number}>"
    match = re.fullmatch(r"flowOut(\d+)", str(port))
    if match:
        return f"option<{int(match.group(1)) + 1}>"
    outputs = list((node.get("next") or {}).keys())
    if port in outputs:
        number = outputs.index(port) + 1
        diagnostics.append(f"{node['id']}: flow port {port!r} mapped heuristically to option<{number}>")
        return f"option<{number}>"
    diagnostics.append(f"{node['id']}: cannot map flow port {port!r}")
    return "default"


def convert_activity(activity: dict[str, Any]) -> ConversionResult:
    diagnostics: list[str] = []
    blueprint = activity.get("blueprint") or {}
    nodes, start = _normalize(blueprint, diagnostics)
    if not nodes:
        diagnostics.append("blueprint has no nodes")
    if not start or start not in nodes:
        diagnostics.append(f"start node is missing: {start!r}")

    categories = _classify_nodes(nodes, diagnostics)
    value_sources: dict[tuple[str, str], None] = {}
    for node in nodes.values():
        for raw_input in (node.get("inputs") or {}).values():
            if isinstance(raw_input, dict) and "nodeId" in raw_input:
                source_id = raw_input["nodeId"]
                source_port = raw_input.get("port", "value")
                if source_id in nodes:
                    if categories.get(source_id) == "value":
                        value_sources[(source_id, source_port)] = None
                else:
                    diagnostics.append(f"{node['id']}: value input references missing node {source_id!r}")
        if categories.get(node["id"]) == "value":
            value_sources.setdefault((node["id"], "value"), None)

    def value_expr(value: Any) -> str:
        if isinstance(value, dict) and "nodeId" in value:
            return f"{_value_name(value['nodeId'], value.get('port', 'value'))}[]"
        return _json(value)

    def node_args(node: dict[str, Any], bracket: bool = False) -> str:
        values = [value_expr(value) for _, value in _input_items(node)]
        return ("[" if bracket else "(") + ", ".join(values) + ("]" if bracket else ")")

    lines: list[str] = []
    lines.append(f"// CL2 export for activity {activity.get('id', '<unnamed>')}")
    lines.append("// Generated from canonical NGL blueprint JSON; CL2 remains a design draft.")
    lines.append("")

    for source_id, source_port in sorted(value_sources):
        source = nodes[source_id]
        source_type = source.get("type", "unknown")
        if source_type in {"flowStart", "activityEnd"}:
            diagnostics.append(f"{source_id}: flow node cannot be used as a value source")
        lines.append(f"reusablevalue {_value_name(source_id, source_port)}: {source_type}{node_args(source, bracket=True)};")
    if value_sources:
        lines.append("")

    receiver_ids = [node_id for node_id, category in categories.items() if category == "receiver"]
    for node_id in receiver_ids:
        node = nodes[node_id]
        node_type = node.get("type", "unknown")
        lines.append(f"inputvalue {_safe_id(node_id)}: {node_type}{node_args(node, bracket=True)};")
    if receiver_ids:
        lines.append("")

    flow_node_ids = [node_id for node_id, category in categories.items() if category in {"flow", "start"}]
    for index, (node_id, node) in enumerate(nodes.items()):
        node_type = node.get("type", "unknown")
        if categories.get(node_id) not in {"flow", "start"}:
            continue
        if node_type == "activityEnd":
            function = "end"
        else:
            function = str(node_type)
        if node_type == "flowStart":
            function = "flowStart"
        if node_type == "unknown":
            diagnostics.append(f"{node_id}: missing node type")

        line = f"{_safe_id(node_id)}: {function}{node_args(node)}"
        edges: list[str] = []
        for port, target in (node.get("next") or {}).items():
            target_id = target.get("nodeId") if isinstance(target, dict) else None
            if not target_id or target_id not in nodes:
                diagnostics.append(f"{node_id}: flow edge {port!r} has missing target {target_id!r}")
                continue
            label = _flow_label(port, node, diagnostics)
            next_flow_id = flow_node_ids[flow_node_ids.index(node_id) + 1] if node_id in flow_node_ids and flow_node_ids.index(node_id) + 1 < len(flow_node_ids) else None
            if label == "default" and target_id == next_flow_id:
                continue
            edges.append(f"    {label} {_safe_id(target_id)};")
        if edges:
            line += " {\n" + "\n".join(edges) + "\n}"
        line += ";"
        if "x" in node or "y" in node:
            line += f" // @cl2.pos {node.get('x', 0)},{node.get('y', 0)}"
        lines.append(line)
        lines.append("")

    return ConversionResult("\n".join(lines).rstrip() + "\n", diagnostics)


def convert_directory(source_dir: Path, output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {"source": str(source_dir), "output": str(output_dir), "converted": 0, "diagnostics": {}, "files": []}
    for source_path in sorted(source_dir.glob("*.json")):
        try:
            activity = json.loads(source_path.read_text(encoding="utf-8"))
            result = convert_activity(activity)
            output_path = output_dir / f"{activity.get('id', source_path.stem)}.CL2.txt"
            output_path.write_text(result.text, encoding="utf-8", newline="\n")
            report["converted"] += 1
            report["files"].append(output_path.name)
            if result.diagnostics:
                report["diagnostics"][source_path.name] = result.diagnostics
        except (OSError, json.JSONDecodeError, TypeError, ValueError) as error:
            report.setdefault("errors", {})[source_path.name] = str(error)
    report["diagnosticCount"] = sum(len(items) for items in report["diagnostics"].values())
    report["errorCount"] = len(report.get("errors", {}))
    (output_dir / "conversion-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Activity JSON file or directory")
    parser.add_argument("output", type=Path, help="CL2 file or output directory")
    args = parser.parse_args()
    if args.input.is_dir():
        report = convert_directory(args.input, args.output)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1 if report.get("errorCount") else 0
    activity = json.loads(args.input.read_text(encoding="utf-8"))
    result = convert_activity(activity)
    args.output.write_text(result.text, encoding="utf-8", newline="\n")
    for diagnostic in result.diagnostics:
        print(f"warning: {diagnostic}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
