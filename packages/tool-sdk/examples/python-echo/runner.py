from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))

from spark_tool_sdk import ToolContext, serve_tools


def echo(input_value: dict, context: ToolContext) -> dict:
    context.log("info", "echo started")
    context.progress(0.5, "halfway")
    context.raise_if_cancelled()
    return {"text": str(input_value.get("text", ""))}


if __name__ == "__main__":
    serve_tools({"echo": echo})

