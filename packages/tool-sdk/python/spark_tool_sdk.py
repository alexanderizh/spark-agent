"""Dependency-free Python client for the spark-tool-process-v1 protocol."""

from __future__ import annotations

import json
import sys
import threading
from dataclasses import dataclass
from typing import Any, Callable, Dict, IO, Mapping, Optional

PROTOCOL_VERSION = "spark-tool-process-v1"
ToolHandler = Callable[[Mapping[str, Any], "ToolContext"], Any]


class ToolCancelledError(RuntimeError):
    pass


@dataclass
class _PendingCapability:
    event: threading.Event
    result: Any = None
    error: Optional[BaseException] = None


class ToolContext:
    def __init__(self, server: "ToolServer", request_id: str, invocation_id: str) -> None:
        self._server = server
        self._request_id = request_id
        self.invocation_id = invocation_id
        self.cancelled = threading.Event()

    def raise_if_cancelled(self) -> None:
        if self.cancelled.is_set():
            raise ToolCancelledError("Tool invocation was cancelled")

    def log(self, level: str, message: str) -> None:
        if level not in {"debug", "info", "warn", "error"}:
            raise ValueError(f"Unsupported log level: {level}")
        self._server._send(
            {
                "type": "log",
                "requestId": self._request_id,
                "invocationId": self.invocation_id,
                "level": level,
                "message": str(message)[:32_000],
            }
        )

    def progress(self, value: Optional[float] = None, message: Optional[str] = None) -> None:
        frame: Dict[str, Any] = {
            "type": "progress",
            "requestId": self._request_id,
            "invocationId": self.invocation_id,
        }
        if value is not None:
            frame["progress"] = max(0.0, min(1.0, float(value)))
        if message is not None:
            frame["message"] = str(message)[:4_000]
        self._server._send(frame)

    def capability(self, name: str, input_value: Any) -> Any:
        self.raise_if_cancelled()
        return self._server._request_capability(self, name, input_value)


class ToolServer:
    def __init__(
        self,
        tools: Mapping[str, ToolHandler],
        stdin: IO[str] = sys.stdin,
        stdout: IO[str] = sys.stdout,
    ) -> None:
        self._tools = dict(tools)
        self._stdin = stdin
        self._stdout = stdout
        self._write_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._sequence = 0
        self._capability_sequence = 0
        self._active: Dict[str, ToolContext] = {}
        self._pending: Dict[str, _PendingCapability] = {}
        self._threads: set[threading.Thread] = set()
        self._closed = threading.Event()

    def serve_forever(self) -> None:
        for raw_line in self._stdin:
            if self._closed.is_set():
                break
            try:
                frame = json.loads(raw_line)
                self._handle(frame)
            except Exception as error:  # protocol boundary must always answer
                request_id = "invalid-frame"
                try:
                    parsed = json.loads(raw_line)
                    request_id = str(parsed.get("requestId", request_id))
                except Exception:
                    pass
                self._send_error(request_id, None, "INVALID_FRAME", error)
        if not self._closed.is_set():
            with self._state_lock:
                threads = list(self._threads)
            for thread in threads:
                thread.join()
            self.close()

    def close(self) -> None:
        if self._closed.is_set():
            return
        self._closed.set()
        with self._state_lock:
            for context in self._active.values():
                context.cancelled.set()
            for pending in self._pending.values():
                pending.error = ToolCancelledError("Tool server closed")
                pending.event.set()
            self._active.clear()
            self._pending.clear()

    def _handle(self, frame: Mapping[str, Any]) -> None:
        if frame.get("protocolVersion") != PROTOCOL_VERSION:
            raise ValueError("Unsupported Spark Tool Process protocol version")
        frame_type = frame.get("type")
        request_id = str(frame.get("requestId", "invalid-frame"))
        if frame_type == "initialize":
            self._send({"type": "ready", "requestId": request_id})
            return
        if frame_type == "shutdown":
            self.close()
            return
        if frame_type == "cancel":
            invocation_id = str(frame.get("invocationId", ""))
            with self._state_lock:
                context = self._active.get(invocation_id)
            if context is not None:
                context.cancelled.set()
            return
        if frame_type in {"capability.result", "capability.error"}:
            with self._state_lock:
                pending = self._pending.pop(request_id, None)
            if pending is None:
                return
            if frame_type == "capability.error":
                pending.error = RuntimeError(
                    f"{frame.get('code', 'CAPABILITY_FAILED')}: {frame.get('message', '')}"
                )
            else:
                pending.result = frame.get("result")
            pending.event.set()
            return
        if frame_type != "invoke":
            raise ValueError(f"Unsupported host frame type: {frame_type}")
        invocation_id = str(frame.get("invocationId", ""))
        context = ToolContext(self, request_id, invocation_id)
        with self._state_lock:
            self._active[invocation_id] = context
        thread = threading.Thread(
            target=self._run_tool,
            args=(frame, context),
            name=f"spark-tool-{invocation_id[:8]}",
            daemon=True,
        )
        with self._state_lock:
            self._threads.add(thread)
        thread.start()

    def _run_tool(self, frame: Mapping[str, Any], context: ToolContext) -> None:
        request_id = str(frame.get("requestId"))
        invocation_id = context.invocation_id
        try:
            tool_name = str(frame.get("toolName", ""))
            handler = self._tools.get(tool_name)
            if handler is None:
                raise KeyError(f"Tool not found: {tool_name}")
            input_value = frame.get("input")
            if not isinstance(input_value, dict):
                raise ValueError("Tool input must be a JSON object")
            result = handler(input_value, context)
            context.raise_if_cancelled()
            self._send(
                {
                    "type": "result",
                    "requestId": request_id,
                    "invocationId": invocation_id,
                    "result": result,
                }
            )
        except Exception as error:
            code = "CANCELLED" if isinstance(error, ToolCancelledError) else "TOOL_FAILED"
            self._send_error(request_id, invocation_id, code, error)
        finally:
            with self._state_lock:
                self._active.pop(invocation_id, None)
                self._threads.discard(threading.current_thread())

    def _request_capability(self, context: ToolContext, name: str, input_value: Any) -> Any:
        with self._state_lock:
            self._capability_sequence += 1
            request_id = f"{context.invocation_id}:capability:{self._capability_sequence}"
            pending = _PendingCapability(threading.Event())
            self._pending[request_id] = pending
        self._send(
            {
                "type": "capability.request",
                "requestId": request_id,
                "invocationId": context.invocation_id,
                "capability": name,
                "input": input_value,
            }
        )
        try:
            while not pending.event.wait(0.1):
                context.raise_if_cancelled()
            if pending.error is not None:
                raise pending.error
            return pending.result
        finally:
            with self._state_lock:
                self._pending.pop(request_id, None)

    def _send_error(
        self,
        request_id: str,
        invocation_id: Optional[str],
        code: str,
        error: BaseException,
    ) -> None:
        message = str(error).strip() or error.__class__.__name__
        frame: Dict[str, Any] = {
            "type": "error",
            "requestId": request_id,
            "code": code,
            "message": message[:4_000],
        }
        if invocation_id:
            frame["invocationId"] = invocation_id
        self._send(frame)

    def _send(self, frame: Mapping[str, Any]) -> None:
        with self._write_lock:
            payload = {
                "protocolVersion": PROTOCOL_VERSION,
                "sequence": self._sequence,
                **frame,
            }
            self._sequence += 1
            self._stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
            self._stdout.flush()


def serve_tools(tools: Mapping[str, ToolHandler]) -> None:
    ToolServer(tools).serve_forever()
