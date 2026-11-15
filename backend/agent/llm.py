"""LLM providers behind one interface. The agent only talks to `LLMProvider`; `LLMRouter` picks the first one that works.

Conversation format is provider-neutral (Anthropic-style content blocks):
  {"role": "user", "content": "text"}
  {"role": "assistant", "content": [{"type": "text", "text": ...}, {"type": "tool_use", "id", "name", "input"}]}
  {"role": "user", "content": [{"type": "tool_result", "tool_use_id", "content": "json text"}]}
Each provider converts that to its own wire format, so a chat can move from Claude to the local model mid-way.
"""
from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Iterator

import httpx

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5"
DEFAULT_LOCAL_URL = "http://localhost:11434/v1"  # Ollama's OpenAI-compatible endpoint (LM Studio, llama.cpp server also fit)


class LLMError(RuntimeError):
    """A provider could not answer (no key, unreachable, HTTP error). The router tries the next provider."""


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict


@dataclass
class Turn:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    provider: str = ""
    blocks: list[dict] | None = None  # the full assistant content (incl. web search blocks), replayed as is in the next request


class LLMProvider(ABC):
    name: str = "base"
    prefers_compact: bool = False  # small models with short context get the compact system prompt

    @abstractmethod
    def available(self) -> bool:
        """Cheap check: configured (key present) or reachable. Must not raise."""

    @abstractmethod
    def complete(self, system: str, messages: list[dict], tools: list[dict], max_tokens: int = 1500) -> Turn:
        """One model call. Raises LLMError on any failure."""

    def stream(self, system: str, messages: list[dict], tools: list[dict], max_tokens: int = 1500) -> Iterator[dict]:
        """One model call as events: {"type": "text", "text": delta} ... then {"type": "turn", "turn": Turn}.
        Default: no real streaming, the whole text arrives as one delta. Providers override this."""
        turn = self.complete(system, messages, tools, max_tokens)
        if turn.text:
            yield {"type": "text", "text": turn.text}
        yield {"type": "turn", "turn": turn}

    def describe(self) -> dict:
        ok = self.available()  # the local provider learns its model name here
        return {"name": self.name, "available": ok, "model": getattr(self, "model", None) if ok else None}


WEB_SEARCH_TYPE = os.environ.get("ANTHROPIC_WEB_SEARCH_TYPE", "web_search_20250305")  # basic variant: works on every model, no code-execution side effects
WEB_SEARCH_MAX_USES = 3
MAX_PAUSE_ROUNDS = 3  # a long server-side search turn may stop with pause_turn; we resume it a few times


class AnthropicProvider(LLMProvider):
    """Claude via the Messages API (raw HTTP, streaming). With web_search on, Anthropic's server-side web search tool is added:
    the model searches, Anthropic runs it, and the answer carries citations. Search blocks must be replayed unchanged in later
    requests of the same turn, so the full block list is kept in Turn.blocks."""
    name = "anthropic"

    def __init__(self, api_key: str | None = None, model: str | None = None, timeout: float = 120.0, web_search: bool = True):
        self.api_key = (api_key or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
        self.model = model or os.environ.get("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)
        self.timeout = timeout
        self.web_search = web_search

    def available(self) -> bool:
        return bool(self.api_key)

    def _tools(self, tools: list[dict]) -> list[dict]:
        if not self.web_search:
            return tools
        web = {"type": WEB_SEARCH_TYPE, "name": "web_search", "max_uses": WEB_SEARCH_MAX_USES,
               "user_location": {"type": "approximate", "country": "UA", "timezone": "Europe/Kyiv"}}
        return [*tools, web]

    @staticmethod
    def _clean(blocks: list[dict]) -> list[dict]:
        """Blocks as the API wants them back: no empty text, no empty citations, no scratch fields."""
        out = []
        for b in blocks:
            b = {k: v for k, v in b.items() if not k.startswith("_")}
            if b["type"] == "text":
                if not b.get("text"):
                    continue
                if not b.get("citations"):
                    b.pop("citations", None)
            out.append(b)
        return out

    def complete(self, system, messages, tools, max_tokens=1500) -> Turn:
        turn = None
        for ev in self.stream(system, messages, tools, max_tokens):
            if ev["type"] == "turn":
                turn = ev["turn"]
        if turn is None:
            raise LLMError("Anthropic returned nothing")
        return turn

    def stream(self, system, messages, tools, max_tokens=1500) -> Iterator[dict]:
        if not self.api_key:
            raise LLMError("no Anthropic key")
        all_tools = self._tools(tools)
        sys_blocks = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
        done: list[dict] = []
        msgs = list(messages)
        for _ in range(MAX_PAUSE_ROUNDS + 1):
            body = {"model": self.model, "max_tokens": max_tokens, "messages": msgs, "system": sys_blocks, "stream": True}
            if all_tools:
                body["tools"] = all_tools
            blocks: dict[int, dict] = {}
            stop = None
            try:
                with httpx.stream("POST", ANTHROPIC_URL, json=body, timeout=httpx.Timeout(self.timeout, connect=10.0),
                                  headers={"x-api-key": self.api_key, "anthropic-version": "2023-06-01"}) as r:
                    if r.status_code != 200:
                        r.read()
                        try:
                            msg = r.json().get("error", {}).get("message", "")  # never echoes the key
                        except ValueError:
                            msg = ""
                        raise LLMError(f"Anthropic HTTP {r.status_code}: {msg[:200]}")
                    for line in r.iter_lines():
                        if not line.startswith("data:"):
                            continue
                        ev = json.loads(line[5:])
                        kind, idx = ev.get("type"), ev.get("index")
                        if kind == "content_block_start":
                            cb = ev["content_block"]
                            t = cb["type"]
                            if t == "text":
                                blocks[idx] = {"type": "text", "text": "", "citations": []}
                            elif t in ("tool_use", "server_tool_use"):
                                blocks[idx] = {"type": t, "id": cb["id"], "name": cb["name"], "_json": ""}
                            elif t == "web_search_tool_result":
                                blocks[idx] = {"type": t, "tool_use_id": cb["tool_use_id"], "content": cb["content"]}
                                c = cb["content"]
                                if isinstance(c, list):
                                    yield {"type": "web_results", "ok": True, "results": [{"title": x.get("title", ""), "url": x.get("url", "")} for x in c]}
                                else:  # an error object: {"type": "web_search_tool_result_error", "error_code": ...}
                                    yield {"type": "web_results", "ok": False, "error": (c or {}).get("error_code", "error")}
                            else:
                                blocks[idx] = dict(cb)
                        elif kind == "content_block_delta" and idx in blocks:
                            d, b = ev["delta"], blocks[idx]
                            if d["type"] == "text_delta":
                                b["text"] += d["text"]
                                yield {"type": "text", "text": d["text"]}
                            elif d["type"] == "input_json_delta":
                                b["_json"] += d["partial_json"]
                            elif d["type"] == "citations_delta":
                                b["citations"].append(d["citation"])
                        elif kind == "content_block_stop" and idx in blocks:
                            b = blocks[idx]
                            if b["type"] in ("tool_use", "server_tool_use"):
                                try:
                                    b["input"] = json.loads(b.pop("_json") or "{}")
                                except json.JSONDecodeError:
                                    b["input"] = {}
                                if b["type"] == "server_tool_use":
                                    yield {"type": "web_search", "query": str(b["input"].get("query", ""))}
                        elif kind == "message_delta":
                            stop = ev.get("delta", {}).get("stop_reason") or stop
                        elif kind == "error":
                            raise LLMError("Anthropic: " + ev.get("error", {}).get("message", "stream error")[:200])
            except httpx.HTTPError as e:
                raise LLMError(f"Anthropic unreachable: {type(e).__name__}") from e
            done += [blocks[i] for i in sorted(blocks)]
            if stop == "pause_turn":  # the server paused a long turn: send the turn so far back to continue it
                msgs = [*messages, {"role": "assistant", "content": self._clean(done)}]
                continue
            break
        clean = self._clean(done)
        turn = Turn(provider=self.name, blocks=clean)
        turn.text = "".join(b["text"] for b in clean if b["type"] == "text")
        turn.tool_calls = [ToolCall(b["id"], b["name"], b.get("input") or {}) for b in clean if b["type"] == "tool_use"]
        cited = {}
        for b in clean:
            for c in b.get("citations", []) if b["type"] == "text" else []:
                if c.get("url"):
                    cited.setdefault(c["url"], c.get("title", ""))
        if cited:
            yield {"type": "citations", "items": [{"url": u, "title": t} for u, t in cited.items()]}
        yield {"type": "turn", "turn": turn}


class LocalProvider(LLMProvider):
    """Any OpenAI-compatible server (Ollama by default). Model is auto-picked from the server when not set."""
    name = "local"
    prefers_compact = True

    def __init__(self, base_url: str | None = None, model: str | None = None, timeout: float = 300.0, max_tokens: int | None = None):
        self.base_url = (base_url or os.environ.get("LOCAL_LLM_URL") or DEFAULT_LOCAL_URL).rstrip("/")
        # "thinking" models (Qwen3 and others) spend most of the budget on hidden reasoning, so the local budget is larger than the cloud one
        self.max_tokens = max_tokens or int(os.environ.get("LOCAL_LLM_MAX_TOKENS", "8000"))
        self.model = model or os.environ.get("LOCAL_LLM_MODEL") or None
        self.timeout = timeout

    def _models(self) -> list[str]:
        r = httpx.get(f"{self.base_url}/models", timeout=2.0)
        r.raise_for_status()
        return [m["id"] for m in r.json().get("data", [])]

    # Auto-pick order when LOCAL_LLM_MODEL is not set: chat models that call tools well and do not "think" for thousands of tokens.
    PREFERRED = ("llama3.1", "qwen2.5", "mistral", "llama3.2", "qwen3-instruct", "gemma")
    AVOID = ("embed", "vision", "-vl", "qwen3:", "deepseek-r1", "qwq", "gpt-oss")

    @classmethod
    def pick(cls, models: list[str]) -> str | None:
        usable = [m for m in models if not any(a in m.lower() for a in ("embed",))]
        plain = [m for m in usable if not any(a in m.lower() for a in cls.AVOID)]
        for pref in cls.PREFERRED:
            for m in plain:
                if m.lower().startswith(pref):
                    return m
        return (plain or usable or [None])[0]

    def available(self) -> bool:
        try:
            models = self._models()
        except Exception:
            return False
        if self.model is None and models:
            self.model = self.pick(models)
        return bool(models) and self.model is not None

    def complete(self, system, messages, tools, max_tokens=1500) -> Turn:
        if not self.available():
            raise LLMError("local model server not reachable")
        body = {"model": self.model, "max_tokens": max(max_tokens, self.max_tokens), "messages": self._convert(system, messages), "stream": False}
        if tools:
            body["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t["description"],
                                                                "parameters": t["input_schema"]}} for t in tools]
        try:
            r = httpx.post(f"{self.base_url}/chat/completions", json=body, timeout=self.timeout)
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise LLMError(f"local model failed: {type(e).__name__}") from e
        choice = r.json()["choices"][0]
        msg = choice["message"]
        turn = Turn(text=(msg.get("content") or "").strip(), provider=f"{self.name}:{self.model}")
        for i, c in enumerate(msg.get("tool_calls") or []):
            raw = c["function"].get("arguments") or "{}"
            try:
                args = json.loads(raw) if isinstance(raw, str) else dict(raw)
            except json.JSONDecodeError:
                args = {}
            turn.tool_calls.append(ToolCall(c.get("id") or f"call_{i}", c["function"]["name"], args))
        return turn

    def stream(self, system, messages, tools, max_tokens=1500) -> Iterator[dict]:
        if not self.available():
            raise LLMError("local model server not reachable")
        body = {"model": self.model, "max_tokens": max(max_tokens, self.max_tokens), "messages": self._convert(system, messages), "stream": True}
        if tools:
            body["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t["description"],
                                                                "parameters": t["input_schema"]}} for t in tools]
        turn, calls, finish = Turn(provider=f"{self.name}:{self.model}"), {}, None
        try:
            with httpx.stream("POST", f"{self.base_url}/chat/completions", json=body, timeout=httpx.Timeout(self.timeout, connect=5.0)) as r:
                if r.status_code != 200:
                    raise LLMError(f"local model HTTP {r.status_code}")
                for line in r.iter_lines():
                    if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                        continue
                    choices = json.loads(line[5:]).get("choices") or []
                    delta = choices[0].get("delta", {}) if choices else {}
                    finish = (choices[0].get("finish_reason") if choices else None) or finish
                    if delta.get("content"):
                        turn.text += delta["content"]
                        yield {"type": "text", "text": delta["content"]}
                    for c in delta.get("tool_calls") or []:
                        slot = calls.setdefault(c.get("index", len(calls)), {"id": None, "name": "", "args": ""})
                        slot["id"] = c.get("id") or slot["id"]
                        f = c.get("function", {})
                        slot["name"] += f.get("name") or ""
                        a = f.get("arguments")
                        slot["args"] += a if isinstance(a, str) else json.dumps(a) if a else ""
        except httpx.HTTPError as e:
            raise LLMError(f"local model failed: {type(e).__name__}") from e
        for i, c in sorted(calls.items()):
            try:
                args = json.loads(c["args"] or "{}")
            except json.JSONDecodeError:
                args = {}
            turn.tool_calls.append(ToolCall(c["id"] or f"call_{i}", c["name"], args))
        turn.text = turn.text.strip()
        if finish == "length" and not turn.text and not turn.tool_calls:
            raise LLMError("the local model ran out of tokens while thinking; ask a shorter question or raise LOCAL_LLM_MAX_TOKENS")
        yield {"type": "turn", "turn": turn}

    @staticmethod
    def _convert(system: str, messages: list[dict]) -> list[dict]:
        out = [{"role": "system", "content": system}]
        for m in messages:
            c = m["content"]
            if isinstance(c, str):
                out.append({"role": m["role"], "content": c})
            elif m["role"] == "assistant":
                calls = [{"id": b["id"], "type": "function", "function": {"name": b["name"], "arguments": json.dumps(b["input"])}}
                         for b in c if b["type"] == "tool_use"]
                msg = {"role": "assistant", "content": "".join(b["text"] for b in c if b["type"] == "text")}
                if calls:
                    msg["tool_calls"] = calls
                out.append(msg)
            else:
                for b in c:
                    if b["type"] == "tool_result":
                        out.append({"role": "tool", "tool_call_id": b["tool_use_id"], "content": b["content"]})
                    elif b["type"] == "text":
                        out.append({"role": "user", "content": b["text"]})
        return out


class LLMRouter:
    """Ordered fallback chain: first available provider that answers wins; errors move on to the next."""

    def __init__(self, providers: list[LLMProvider]):
        self.providers = providers
        self.errors: list[str] = []

    @classmethod
    def from_request(cls, anthropic_key: str | None = None, web_search: bool = True) -> "LLMRouter":
        """Key entered by the farmer (header) wins over the server env key; the local model is the last resort."""
        return cls([AnthropicProvider(api_key=anthropic_key, web_search=web_search), LocalProvider()])

    def status(self) -> list[dict]:
        return [p.describe() for p in self.providers]

    def stream(self, system, messages, tools, max_tokens=1500, system_compact: str | None = None) -> Iterator[dict]:
        """Like complete(), as events. A provider that fails before any text was sent is skipped; after that the error is raised."""
        self.errors = []
        for p in self.providers:
            if not p.available():
                continue
            sent = False
            try:
                for ev in p.stream(system_compact if (system_compact and p.prefers_compact) else system, messages, tools, max_tokens):
                    sent = sent or ev["type"] == "text"
                    yield ev
                return
            except LLMError as e:
                if sent:
                    raise
                self.errors.append(f"{p.name}: {e}")
        raise LLMError("; ".join(self.errors) or "no model available: enter an Anthropic key or start a local model (Ollama)")

    def complete(self, system, messages, tools, max_tokens=1500, system_compact: str | None = None) -> Turn:
        self.errors = []
        for p in self.providers:
            if not p.available():
                continue
            try:
                return p.complete(system_compact if (system_compact and p.prefers_compact) else system, messages, tools, max_tokens)
            except LLMError as e:
                self.errors.append(f"{p.name}: {e}")
        raise LLMError("; ".join(self.errors) or "no model available: enter an Anthropic key or start a local model (Ollama)")
