"""The local LLM behind one interface. The agent only talks to `LLMProvider`; `LLMRouter` picks the first provider that works.
Only a local model (any OpenAI-compatible server, Ollama by default) is used: no request leaves the machine.

Conversation format is provider-neutral (content blocks):
  {"role": "user", "content": "text"}
  {"role": "assistant", "content": [{"type": "text", "text": ...}, {"type": "tool_use", "id", "name", "input"}]}
  {"role": "user", "content": [{"type": "tool_result", "tool_use_id", "content": "json text"}]}
Each provider converts that to its own wire format.
"""
from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Iterator

import httpx

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
    def from_request(cls) -> "LLMRouter":
        return cls([LocalProvider()])

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
        raise LLMError("; ".join(self.errors) or "no model available: start a local model (Ollama)")

    def complete(self, system, messages, tools, max_tokens=1500, system_compact: str | None = None) -> Turn:
        self.errors = []
        for p in self.providers:
            if not p.available():
                continue
            try:
                return p.complete(system_compact if (system_compact and p.prefers_compact) else system, messages, tools, max_tokens)
            except LLMError as e:
                self.errors.append(f"{p.name}: {e}")
        raise LLMError("; ".join(self.errors) or "no model available: start a local model (Ollama)")
