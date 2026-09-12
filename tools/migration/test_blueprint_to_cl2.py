import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blueprint_to_cl2 import convert_activity, convert_directory


class BlueprintToCl2Tests(unittest.TestCase):
    def test_converts_flow_edges_value_wires_and_positions(self):
        activity = {
            "id": "sample",
            "blueprint": {
                "startNodeId": "start",
                "nodes": {
                    "start": {"id": "start", "type": "flowStart", "inputs": {}, "x": 1, "y": 2},
                    "read": {"id": "read", "type": "getPublicVariable", "inputs": {"id": 7}},
                    "branch": {"id": "branch", "type": "branch", "inputs": {}},
                    "end": {"id": "end", "type": "activityEnd", "inputs": {}},
                },
                "connections": [
                    {"fromNodeId": "start", "fromPort": "flowOut", "toNodeId": "branch", "toPort": "flowIn"},
                    {"fromNodeId": "read", "fromPort": "value", "toNodeId": "branch", "toPort": "condition"},
                    {"fromNodeId": "branch", "fromPort": "false", "toNodeId": "end", "toPort": "flowIn"},
                ],
            },
        }
        result = convert_activity(activity)
        self.assertEqual(result.diagnostics, [])
        self.assertIn("reusablevalue read__value: getPublicVariable[7];", result.text)
        self.assertIn("start: flowStart()", result.text)
        self.assertIn("branch(read__value[])", result.text)
        self.assertNotIn("default end;", result.text)
        self.assertIn("// @cl2.pos 1,2", result.text)

    def test_converts_value_receiver_to_inputvalue(self):
        activity = {
            "id": "receiver",
            "blueprint": {
                "startNodeId": "start",
                "nodes": {
                    "start": {
                        "id": "start",
                        "type": "flowStart",
                        "inputs": {},
                        "next": {"flowOut": {"nodeId": "consume", "port": "flowIn"}},
                    },
                    "consume": {
                        "id": "consume",
                        "type": "consumeValue",
                        "inputs": {
                            "value": {
                                "nodeId": "compare",
                                "port": "value",
                            }
                        },
                        "next": {"flowOut": {"nodeId": "end", "port": "flowIn"}},
                    },
                    "compare": {
                        "id": "compare",
                        "type": "math",
                        "inputs": {"operator": "gte", "left": 4, "right": 2},
                    },
                    "end": {"id": "end", "type": "activityEnd", "inputs": {}},
                },
            },
        }
        result = convert_activity(activity)
        self.assertEqual(result.diagnostics, [])
        self.assertIn('inputvalue compare: math["gte", 4, 2];', result.text)
        self.assertNotIn("compare: math(", result.text)

    def test_directory_conversion_writes_cl2_files_and_report(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            output = root / "output"
            source.mkdir()
            (source / "one.json").write_text(json.dumps({"id": "one", "blueprint": {"nodes": {"end": {"id": "end", "type": "activityEnd", "inputs": {}}}}}), encoding="utf-8")
            report = convert_directory(source, output)
            self.assertEqual(report["converted"], 1)
            self.assertTrue((output / "one.CL2.txt").is_file())
            self.assertTrue((output / "conversion-report.json").is_file())

    def test_wired_arithmetic_keeps_operator_left_right_order(self):
        activity = {
            "id": "arithmetic",
            "blueprint": {
                "nodes": {
                    "read": {"id": "read", "type": "getPublicVariable", "inputs": {"id": 1}},
                    "compare": {"id": "compare", "type": "arithmetic", "inputs": {"operator": "gte", "right": 50}},
                },
                "connections": [{"fromNodeId": "read", "fromPort": "value", "toNodeId": "compare", "toPort": "left"}],
            },
        }
        result = convert_activity(activity)
        self.assertIn('arithmetic["gte", read__value[], 50]', result.text)

    def test_dice_check_uses_declared_cl2_branch_contract(self):
        activity = {
            "id": "dice",
            "blueprint": {
                "startNodeId": "start",
                "nodes": {
                    "start": {"id": "start", "type": "flowStart", "inputs": {}},
                    "check": {"id": "check", "type": "framework:diceCheck", "inputs": {}},
                    "a": {"id": "a", "type": "activityEnd", "inputs": {}},
                    "b": {"id": "b", "type": "activityEnd", "inputs": {}},
                    "c": {"id": "c", "type": "activityEnd", "inputs": {}},
                    "d": {"id": "d", "type": "activityEnd", "inputs": {}},
                },
                "connections": [
                    {"fromNodeId": "start", "fromPort": "flowOut", "toNodeId": "check", "toPort": "flowIn"},
                    {"fromNodeId": "check", "fromPort": "largeSuccess", "toNodeId": "a", "toPort": "flowIn"},
                    {"fromNodeId": "check", "fromPort": "success", "toNodeId": "b", "toPort": "flowIn"},
                    {"fromNodeId": "check", "fromPort": "failure", "toNodeId": "c", "toPort": "flowIn"},
                    {"fromNodeId": "check", "fromPort": "largeFailure", "toNodeId": "d", "toPort": "flowIn"},
                ],
            },
        }
        result = convert_activity(activity)
        self.assertIn("option<1> a;", result.text)
        self.assertIn("option<2> b;", result.text)
        self.assertIn("option<3> c;", result.text)
        self.assertIn("default d;", result.text)
        self.assertEqual(result.diagnostics, [])


if __name__ == "__main__":
    unittest.main()
