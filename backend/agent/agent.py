"""The agent loop: model call -> run requested tools -> feed results back -> repeat until the model answers in text."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator

from agent.llm import LLMError, LLMRouter
from agent.tools import AgentContext, ToolRegistry

SYSTEM = (Path(__file__).parent / "system.md").read_text()
SYSTEM_COMPACT = (Path(__file__).parent / "system_compact.md").read_text()  # for small local models with a short context
MAX_STEPS = 6
MAX_TOOL_CHARS = 9000  # keeps small local models inside their context window


class Agent:
    def __init__(self, router: LLMRouter, registry: ToolRegistry | None = None, system: str = SYSTEM, system_compact: str | None = SYSTEM_COMPACT):
        self.router = router
        self.registry = registry or ToolRegistry.default()
        self.system = system
        self.system_compact = system_compact

    def run(self, history: list[dict], ctx: AgentContext) -> Iterator[dict]:
        """Yields UI events: text_delta (streamed answer text), text_break, provider, tool_start, tool_end, chart, done / error. `history` is plain user/assistant text turns."""
        messages: list[dict] = [dict(m) for m in history]
        sources: list[dict] = []
        tools = self.registry.specs()
        streamed = False
        found: dict[str, str] = {}   # web results of this answer: url -> title
        cited: dict[str, str] = {}   # the ones the model actually cited
        for _ in range(MAX_STEPS):
            turn = None
            try:
                for ev in self.router.stream(self.system, messages, tools, system_compact=self.system_compact):
                    kind = ev["type"]
                    if kind == "text":
                        yield {"type": "text_delta", "text": ev["text"]}
                        streamed = True
                    elif kind == "web_search":
                        yield {"type": "tool_start", "name": "web_search", "input": {"query": ev["query"]}}
                    elif kind == "web_results":
                        for r in ev.get("results", []):
                            found.setdefault(r["url"], r["title"])
                        yield {"type": "tool_end", "name": "web_search", "ok": ev["ok"], "error": ev.get("error"), "status": "web"}
                    elif kind == "citations":
                        cited.update({c["url"]: c["title"] for c in ev["items"]})
                    elif kind == "turn":
                        turn = ev["turn"]
            except LLMError as e:
                yield {"type": "error", "message": str(e)}
                return
            if turn is None:
                yield {"type": "error", "message": "the model returned nothing"}
                return
            yield {"type": "provider", "name": turn.provider}
            if not turn.tool_calls:
                if not streamed:
                    yield {"type": "text_delta", "text": "(empty answer)"}
                web = cited or dict(list(found.items())[:3])
                yield {"type": "done", "sources": sources + [{"tool": "web_search", "source": t or u, "url": u, "status": "web"} for u, t in web.items()]}
                return
            if turn.text:
                yield {"type": "text_break"}  # the next text (after the tools) starts a new paragraph
            blocks = turn.blocks or (([{"type": "text", "text": turn.text}] if turn.text else []) + [
                {"type": "tool_use", "id": c.id, "name": c.name, "input": c.args} for c in turn.tool_calls])
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
