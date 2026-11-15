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


class LLMProvider(ABC):
    name: str = "base"

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


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, api_key: str | None = None, model: str | None = None, timeout: float = 90.0):
        self.api_key = (api_key or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
        self.model = model or os.environ.get("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)
        self.timeout = timeout

    def available(self) -> bool:
        return bool(self.api_key)

    def complete(self, system, messages, tools, max_tokens=1500) -> Turn:
        if not self.api_key:
            raise LLMError("no Anthropic key")
        body = {"model": self.model, "max_tokens": max_tokens, "messages": messages,
                "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]}
        if tools:
            body["tools"] = tools
        try:
            r = httpx.post(ANTHROPIC_URL, json=body, timeout=self.timeout,
                           headers={"x-api-key": self.api_key, "anthropic-version": "2023-06-01"})
        except httpx.HTTPError as e:
            raise LLMError(f"Anthropic unreachable: {type(e).__name__}") from e
        if r.status_code != 200:
            # never echo the key; the API error message does not contain it
            msg = r.json().get("error", {}).get("message", "") if r.headers.get("content-type", "").startswith("application/json") else ""
            raise LLMError(f"Anthropic HTTP {r.status_code}: {msg[:200]}")
        turn = Turn(provider=self.name)
        for b in r.json().get("content", []):
            if b["type"] == "text":
                turn.text += b["text"]
            elif b["type"] == "tool_use":
                turn.tool_calls.append(ToolCall(b["id"], b["name"], b.get("input") or {}))
        return turn

    def stream(self, system, messages, tools, max_tokens=1500) -> Iterator[dict]:
        if not self.api_key:
            raise LLMError("no Anthropic key")
        body = {"model": self.model, "max_tokens": max_tokens, "messages": messages, "stream": True,
                "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]}
        if tools:
            body["tools"] = tools
        turn, blocks = Turn(provider=self.name), {}
        try:
            with httpx.stream("POST", ANTHROPIC_URL, json=body, timeout=httpx.Timeout(self.timeout, connect=10.0),
                              headers={"x-api-key": self.api_key, "anthropic-version": "2023-06-01"}) as r:
                if r.status_code != 200:
                    r.read()
                    try:
                        msg = r.json().get("error", {}).get("message", "")
                    except ValueError:
                        msg = ""
                    raise LLMError(f"Anthropic HTTP {r.status_code}: {msg[:200]}")
                for line in r.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    ev = json.loads(line[5:])
                    kind = ev.get("type")
                    if kind == "content_block_start" and ev["content_block"]["type"] == "tool_use":
                        cb = ev["content_block"]
                        blocks[ev["index"]] = {"id": cb["id"], "name": cb["name"], "json": ""}
                    elif kind == "content_block_delta":
                        d = ev["delta"]
                        if d["type"] == "text_delta":
                            turn.text += d["text"]
                            yield {"type": "text", "text": d["text"]}
                        elif d["type"] == "input_json_delta" and ev["index"] in blocks:
                            blocks[ev["index"]]["json"] += d["partial_json"]
                    elif kind == "error":
                        raise LLMError("Anthropic: " + ev.get("error", {}).get("message", "stream error")[:200])
        except httpx.HTTPError as e:
            raise LLMError(f"Anthropic unreachable: {type(e).__name__}") from e
        for _, b in sorted(blocks.items()):
            try:
                args = json.loads(b["json"] or "{}")
            except json.JSONDecodeError:
                args = {}
            turn.tool_calls.append(ToolCall(b["id"], b["name"], args))
        yield {"type": "turn", "turn": turn}


class LocalProvider(LLMProvider):
    """Any OpenAI-compatible server (Ollama by default). Model is auto-picked from the server when not set."""
    name = "local"

    def __init__(self, base_url: str | None = None, model: str | None = None, timeout: float = 180.0):
        self.base_url = (base_url or os.environ.get("LOCAL_LLM_URL") or DEFAULT_LOCAL_URL).rstrip("/")
        self.model = model or os.environ.get("LOCAL_LLM_MODEL") or None
        self.timeout = timeout

    def _models(self) -> list[str]:
        r = httpx.get(f"{self.base_url}/models", timeout=2.0)
        r.raise_for_status()
        return [m["id"] for m in r.json().get("data", [])]

    def available(self) -> bool:
        try:
            models = self._models()
        except Exception:
            return False
        if self.model is None and models:
            self.model = models[0]
        return bool(models)

    def complete(self, system, messages, tools, max_tokens=1500) -> Turn:
        if not self.available():
            raise LLMError("local model server not reachable")
        body = {"model": self.model, "max_tokens": max_tokens, "messages": self._convert(system, messages), "stream": False}
        if tools:
            body["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t["description"],
                                                                "parameters": t["input_schema"]}} for t in tools]
        try:
            r = httpx.post(f"{self.base_url}/chat/completions", json=body, timeout=self.timeout)
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise LLMError(f"local model failed: {type(e).__name__}") from e
        msg = r.json()["choices"][0]["message"]
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
        body = {"model": self.model, "max_tokens": max_tokens, "messages": self._convert(system, messages), "stream": True}
        if tools:
            body["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t["description"],
                                                                "parameters": t["input_schema"]}} for t in tools]
        turn, calls = Turn(provider=f"{self.name}:{self.model}"), {}
        try:
            with httpx.stream("POST", f"{self.base_url}/chat/completions", json=body, timeout=httpx.Timeout(self.timeout, connect=5.0)) as r:
                if r.status_code != 200:
                    raise LLMError(f"local model HTTP {r.status_code}")
                for line in r.iter_lines():
                    if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                        continue
                    choices = json.loads(line[5:]).get("choices") or []
                    delta = choices[0].get("delta", {}) if choices else {}
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
    def from_request(cls, anthropic_key: str | None = None) -> "LLMRouter":
        """Key entered by the farmer (header) wins over the server env key; the local model is the last resort."""
        return cls([AnthropicProvider(api_key=anthropic_key), LocalProvider()])

    def status(self) -> list[dict]:
        return [p.describe() for p in self.providers]

    def stream(self, system, messages, tools, max_tokens=1500) -> Iterator[dict]:
        """Like complete(), as events. A provider that fails before any text was sent is skipped; after that the error is raised."""
        self.errors = []
        for p in self.providers:
            if not p.available():
                continue
            sent = False
            try:
                for ev in p.stream(system, messages, tools, max_tokens):
                    sent = sent or ev["type"] == "text"
                    yield ev
                return
            except LLMError as e:
                if sent:
                    raise
                self.errors.append(f"{p.name}: {e}")
        raise LLMError("; ".join(self.errors) or "no model available: enter an Anthropic key or start a local model (Ollama)")

    def complete(self, system, messages, tools, max_tokens=1500) -> Turn:
        self.errors = []
        for p in self.providers:
            if not p.available():
                continue
            try:
                return p.complete(system, messages, tools, max_tokens)
            except LLMError as e:
                self.errors.append(f"{p.name}: {e}")
        raise LLMError("; ".join(self.errors) or "no model available: enter an Anthropic key or start a local model (Ollama)")
