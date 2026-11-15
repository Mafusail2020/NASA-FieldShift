"""The agent loop: model call -> run requested tools -> feed results back -> repeat until the model answers in text."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator

from agent.llm import LLMError, LLMRouter
from agent.tools import AgentContext, ToolRegistry

SYSTEM = (Path(__file__).parent / "system.md").read_text()
MAX_STEPS = 6
MAX_TOOL_CHARS = 9000  # keeps small local models inside their context window


class Agent:
    def __init__(self, router: LLMRouter, registry: ToolRegistry | None = None, system: str = SYSTEM):
        self.router = router
        self.registry = registry or ToolRegistry.default()
        self.system = system

    def run(self, history: list[dict], ctx: AgentContext) -> Iterator[dict]:
        """Yields UI events: provider, tool_start, tool_end, chart, text, done / error. `history` is plain user/assistant text turns."""
        messages: list[dict] = [dict(m) for m in history]
        sources: list[dict] = []
        tools = self.registry.specs()
        for _ in range(MAX_STEPS):
            try:
                turn = self.router.complete(self.system, messages, tools)
            except LLMError as e:
                yield {"type": "error", "message": str(e)}
                return
            yield {"type": "provider", "name": turn.provider}
            if not turn.tool_calls:
                yield {"type": "text", "text": turn.text or "(empty answer)"}
                yield {"type": "done", "sources": sources}
                return
            blocks = ([{"type": "text", "text": turn.text}] if turn.text else []) + [
                {"type": "tool_use", "id": c.id, "name": c.name, "input": c.args} for c in turn.tool_calls]
            messages.append({"role": "assistant", "content": blocks})
            results = []
            for c in turn.tool_calls:
                yield {"type": "tool_start", "name": c.name, "input": c.args}
                res = self.registry.run(c.name, ctx, c.args)
                chart = res.pop("chart", None)
                ok = "error" not in res
                if ok:
                    sources.append({"tool": c.name, "source": res.get("source", ""), "status": res.get("status", "")})
                yield {"type": "tool_end", "name": c.name, "ok": ok, "error": res.get("error"), "status": res.get("status")}
                if chart:
                    yield {"type": "chart", **chart}
                results.append({"type": "tool_result", "tool_use_id": c.id, "content": json.dumps(res, default=str)[:MAX_TOOL_CHARS]})
            messages.append({"role": "user", "content": results})
        yield {"type": "error", "message": "too many tool steps; ask a narrower question"}
