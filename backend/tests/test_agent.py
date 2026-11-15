import json

from fastapi.testclient import TestClient

from agent.agent import Agent
from agent.llm import LLMError, LLMProvider, LLMRouter, LocalProvider, ToolCall, Turn
from agent.tools import AgentContext, ToolRegistry
from app.main import app

FIELDS = [{"id": "f1", "name": "North", "lat": 46.4, "lon": 30.7, "areaHa": 120, "crop": "winter_wheat", "sowingDate": "2025-10-05",
           "rotation": ["winter_wheat", "maize", "black_fallow"], "analysis": {"ece": 3.1, "ph": 7.8}},
          {"id": "f2", "name": "Nowhere", "lat": 10.0, "lon": 10.0, "rotation": []}]
CTX = AgentContext(FIELDS)
REG = ToolRegistry.default()


class Scripted(LLMProvider):
    name = "scripted"

    def __init__(self, turns, ok=True):
        self.turns, self.ok, self.seen = list(turns), ok, []

    def available(self):
        return self.ok

    def complete(self, system, messages, tools, max_tokens=1500):
        self.seen.append(messages)
        if not self.turns:
            raise LLMError("script over")
        return self.turns.pop(0)


def test_tools_return_source_and_status():
    for name, args in [("list_fields", {}), ("get_field", {"field_id": "f1"}), ("get_climate", {"field_id": "f1", "metric": "precip_mm"}),
                       ("get_monthly_climate", {"field_id": "f1", "year": 2024}), ("get_risk_layers", {"field_id": "f1"}),
                       ("get_crop", {"crop": "sunflower"}), ("search_kb", {"query": "sunflower predecessor"}),
                       ("evaluate_rotation", {"field_id": "f1"}), ("compare_rotations", {"field_id": "f1"}), ("soil_check", {"field_id": "f1"})]:
        r = REG.run(name, CTX, args)
        assert "error" not in r, (name, r)
        assert r["source"] and r["status"], name


def test_fields_are_found_by_name():
    two = AgentContext([{"id": "a1", "name": "North Hill", "lat": 46.4, "lon": 30.7}, {"id": "b2", "name": "North Valley", "lat": 48.0, "lon": 30.0},
                        {"id": "c3", "name": "River", "lat": 48.0, "lon": 30.0}])
    name = lambda ref: REG.run("get_field", two, {"field_id": ref})
    assert name("river")["data"]["field"]["id"] == "c3"            # case-insensitive
    assert name("hill")["data"]["field"]["id"] == "a1"             # unique part of the name
    assert name("b2")["data"]["field"]["name"] == "North Valley"   # id still works
    assert "matches several" in name("north")["error"]
    assert "'North Hill'" in name("zzz")["error"] and "'River'" in name("zzz")["error"]  # errors list the names
    assert "Fields:" in REG.run("get_field", two, {})["error"]


def test_tool_errors_are_data_not_exceptions():
    assert "outside the grid" in REG.run("get_field", CTX, {"field_id": "f2"})["error"]
    assert "no field called" in REG.run("get_field", CTX, {"field_id": "zzz"})["error"]
    assert "unknown crop" in REG.run("get_crop", CTX, {"crop": "banana"})["error"]
    assert "name the field" in REG.run("get_field", CTX, {})["error"]
    assert "unknown tool" in REG.run("nope", CTX, {})["error"]


def test_rotation_kmu_flag_and_missing_pair():
    r = REG.run("evaluate_rotation", CTX, {"field_id": "f1", "rotation": ["winter_wheat", "winter_wheat"]})
    assert r["data"]["kmu_164_issues"]
    r = REG.run("evaluate_rotation", CTX, {"field_id": "f1", "rotation": ["winter_wheat", "buckwheat"]})
    assert r["data"]["computable"] is False


def test_kb_finds_and_declines():
    assert REG.run("search_kb", CTX, {"query": "why is sunflower a bad predecessor for wheat"})["data"]["chunks"]
    assert REG.run("search_kb", CTX, {"query": "zzzqqq"})["data"]["chunks"] == []


def test_agent_loop_runs_tool_then_answers():
    p = Scripted([Turn(tool_calls=[ToolCall("t1", "get_climate", {"field_id": "f1", "metric": "precip_mm"})], provider="scripted"),
                  Turn(text="1994 was driest.", provider="scripted")])
    ev = list(Agent(LLMRouter([p]), REG).run([{"role": "user", "content": "driest year?"}], CTX))
    kinds = [e["type"] for e in ev]
    assert kinds.count("tool_start") == 1 and "chart" in kinds and ev[-1]["type"] == "done"
    assert ev[-1]["sources"][0]["tool"] == "get_climate"
    # the chart is for the UI only: the model sees the result without it
    result = p.seen[1][-1]["content"][0]["content"]
    assert "chart" not in json.loads(result)


class Streamer(Scripted):
    """Streams its text in pieces, like a real provider."""
    def __init__(self, pieces, fail_first=False):
        super().__init__([])
        self.pieces, self.fail_first = pieces, fail_first

    def stream(self, system, messages, tools, max_tokens=1500):
        if self.fail_first:
            raise LLMError("down")
        for x in self.pieces:
            yield {"type": "text", "text": x}
        yield {"type": "turn", "turn": Turn(text="".join(self.pieces), provider="streamer")}


def test_answer_text_is_streamed_in_pieces():
    ev = list(Agent(LLMRouter([Streamer(["Hel", "lo ", "farmer"])]), REG).run([{"role": "user", "content": "hi"}], CTX))
    assert [e["text"] for e in ev if e["type"] == "text_delta"] == ["Hel", "lo ", "farmer"]
    assert ev[-1]["type"] == "done"


def test_non_streaming_provider_still_gives_one_delta():
    p = Scripted([Turn(text="whole answer", provider="s")])
    ev = list(Agent(LLMRouter([p]), REG).run([{"role": "user", "content": "hi"}], CTX))
    assert [e["text"] for e in ev if e["type"] == "text_delta"] == ["whole answer"]


def test_stream_falls_back_before_text_but_not_after():
    ev = list(Agent(LLMRouter([Streamer([], fail_first=True), Streamer(["ok"])]), REG).run([{"role": "user", "content": "hi"}], CTX))
    assert [e["text"] for e in ev if e["type"] == "text_delta"] == ["ok"]

    class Breaks(Streamer):
        def stream(self, *a, **k):
            yield {"type": "text", "text": "part"}
            raise LLMError("cut")
    ev = list(Agent(LLMRouter([Breaks([]), Streamer(["ok"])]), REG).run([{"role": "user", "content": "hi"}], CTX))
    assert ev[-1]["type"] == "error" and [e["text"] for e in ev if e["type"] == "text_delta"] == ["part"]


def test_small_local_models_get_the_compact_prompt():
    seen = {}

    class Spy(Scripted):
        def __init__(self, name, compact):
            super().__init__([Turn(text="ok", provider=name)])
            self.name, self.prefers_compact = name, compact

        def complete(self, system, messages, tools, max_tokens=1500):
            seen[self.name] = system
            return super().complete(system, messages, tools, max_tokens)

    from agent.agent import SYSTEM, SYSTEM_COMPACT
    assert len(SYSTEM_COMPACT) < len(SYSTEM) / 4
    list(Agent(LLMRouter([Spy("big", False)]), REG).run([{"role": "user", "content": "hi"}], CTX))
    list(Agent(LLMRouter([Spy("small", True)]), REG).run([{"role": "user", "content": "hi"}], CTX))
    assert seen["big"] == SYSTEM and seen["small"] == SYSTEM_COMPACT


def test_local_model_pick_skips_embedding_vision_and_thinking_models():
    pick = LocalProvider.pick
    assert pick(["qwen3-vl:4b", "qwen3-embedding:latest", "llama3.2-vision:latest", "llama3.2:3b", "llama3.1:latest", "gemma3:12b"]) == "llama3.1:latest"
    assert pick(["qwen3-vl:4b", "mxbai-embed-large:latest", "llama3.2-vision:latest"]) == "qwen3-vl:4b"  # nothing better: first usable, never an embedding model
    assert pick(["mxbai-embed-large:latest"]) is None


def test_router_falls_back_and_reports_failure():
    bad = Scripted([], ok=True)
    good = Scripted([Turn(text="ok", provider="good")])
    assert LLMRouter([bad, good]).complete("s", [], []).text == "ok"
    ev = list(Agent(LLMRouter([Scripted([], ok=False)]), REG).run([{"role": "user", "content": "hi"}], CTX))
    assert ev[0]["type"] == "error"


def test_local_provider_converts_messages():
    msgs = [{"role": "user", "content": "q"},
            {"role": "assistant", "content": [{"type": "tool_use", "id": "a", "name": "list_fields", "input": {}}]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "a", "content": "{}"}]}]
    out = LocalProvider._convert("sys", msgs)
    assert [m["role"] for m in out] == ["system", "user", "assistant", "tool"]
    assert out[2]["tool_calls"][0]["function"]["name"] == "list_fields" and out[3]["tool_call_id"] == "a"


def test_chat_endpoint_validates_and_hides_key():
    c = TestClient(app)
    assert c.post("/api/agent/chat", json={"messages": [], "fields": []}).status_code == 422
    assert c.post("/api/agent/chat", json={"messages": [{"role": "assistant", "content": "x"}]}).status_code == 422
    s = c.get("/api/agent/status", headers={"X-Anthropic-Key": "sk-secret"})
    assert "sk-secret" not in s.text and s.json()["providers"][0]["available"] is True


# ---- Anthropic web search (server tool): fake SSE stream ----
import contextlib

from agent import llm as llm_mod


def sse(*events):
    return [f"data: {json.dumps(e)}" for e in events] + [""]


class FakeResp:
    status_code = 200

    def __init__(self, lines):
        self._lines = lines

    def iter_lines(self):
        return iter(self._lines)


def fake_stream(rounds, sent):
    """Replaces httpx.stream: each call serves the next scripted round and records the request body."""
    rounds = list(rounds)

    @contextlib.contextmanager
    def stream(method, url, json=None, **kw):
        sent.append(json)
        yield FakeResp(rounds.pop(0))
    return stream


SEARCH_ROUND = sse(
    {"type": "message_start"},
    {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
    {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Let me check. "}},
    {"type": "content_block_stop", "index": 0},
    {"type": "content_block_start", "index": 1, "content_block": {"type": "server_tool_use", "id": "srv1", "name": "web_search", "input": {}}},
    {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '{"query": "KMU 164 ro'}},
    {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": 'tation"}'}},
    {"type": "content_block_stop", "index": 1},
    {"type": "content_block_start", "index": 2, "content_block": {"type": "web_search_tool_result", "tool_use_id": "srv1",
                                                               "content": [{"type": "web_search_result", "url": "https://zakon.rada.gov.ua/x", "title": "KMU 164", "encrypted_content": "abc"}]}},
    {"type": "content_block_stop", "index": 2},
    {"type": "content_block_start", "index": 3, "content_block": {"type": "text", "text": ""}},
    {"type": "content_block_delta", "index": 3, "delta": {"type": "text_delta", "text": "Wheat returns after 2 years."}},
    {"type": "content_block_delta", "index": 3, "delta": {"type": "citations_delta", "citation": {"type": "web_search_result_location", "url": "https://zakon.rada.gov.ua/x", "title": "KMU 164", "cited_text": "..."}}},
    {"type": "content_block_stop", "index": 3},
    {"type": "message_delta", "delta": {"stop_reason": "end_turn"}},
)


def run_web(monkeypatch, rounds, web_search=True):
    sent = []
    monkeypatch.setattr(llm_mod.httpx, "stream", fake_stream(rounds, sent))
    p = llm_mod.AnthropicProvider(api_key="k", web_search=web_search)
    ev = list(Agent(LLMRouter([p]), REG).run([{"role": "user", "content": "what does KMU 164 say?"}], CTX))
    return ev, sent


def test_web_search_streams_query_results_citations_and_sources(monkeypatch):
    ev, sent = run_web(monkeypatch, [SEARCH_ROUND])
    kinds = [e["type"] for e in ev]
    assert {"type": "tool_start", "name": "web_search", "input": {"query": "KMU 164 rotation"}} in ev
    assert any(e["type"] == "tool_end" and e["name"] == "web_search" and e["ok"] and e["status"] == "web" for e in ev)
    assert "".join(e["text"] for e in ev if e["type"] == "text_delta") == "Let me check. Wheat returns after 2 years."
    done = ev[-1]
    assert done["type"] == "done" and done["sources"] == [{"tool": "web_search", "source": "KMU 164", "url": "https://zakon.rada.gov.ua/x", "status": "web"}]
    tools = sent[0]["tools"]
    assert any(t["name"] == "web_search" and t["type"].startswith("web_search_") and t["max_uses"] == 3 for t in tools)
    assert kinds.count("error") == 0


def test_web_search_can_be_switched_off(monkeypatch):
    _, sent = run_web(monkeypatch, [SEARCH_ROUND], web_search=False)
    assert not any(t["name"] == "web_search" for t in sent[0]["tools"])


def test_search_blocks_are_replayed_unchanged_after_a_custom_tool_call(monkeypatch):
    tool_round = sse(
        {"type": "content_block_start", "index": 0, "content_block": {"type": "server_tool_use", "id": "srv1", "name": "web_search", "input": {}}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": '{"query": "q"}'}},
        {"type": "content_block_stop", "index": 0},
        {"type": "content_block_start", "index": 1, "content_block": {"type": "web_search_tool_result", "tool_use_id": "srv1", "content": [{"type": "web_search_result", "url": "https://a", "title": "A", "encrypted_content": "enc"}]}},
        {"type": "content_block_stop", "index": 1},
        {"type": "content_block_start", "index": 2, "content_block": {"type": "tool_use", "id": "t1", "name": "list_fields", "input": {}}},
        {"type": "content_block_stop", "index": 2},
        {"type": "message_delta", "delta": {"stop_reason": "tool_use"}},
    )
    final = sse({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
                {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "done"}},
                {"type": "content_block_stop", "index": 0}, {"type": "message_delta", "delta": {"stop_reason": "end_turn"}})
    ev, sent = run_web(monkeypatch, [tool_round, final])
    assert ev[-1]["type"] == "done"
    replay = sent[1]["messages"][-2]
    assert replay["role"] == "assistant"
    assert [b["type"] for b in replay["content"]] == ["server_tool_use", "web_search_tool_result", "tool_use"]
    assert replay["content"][1]["content"][0]["encrypted_content"] == "enc" and replay["content"][0]["input"] == {"query": "q"}


def test_pause_turn_is_resumed_with_the_turn_so_far(monkeypatch):
    paused = sse({"type": "content_block_start", "index": 0, "content_block": {"type": "server_tool_use", "id": "s", "name": "web_search", "input": {}}},
                 {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": '{"query": "q"}'}},
                 {"type": "content_block_stop", "index": 0}, {"type": "message_delta", "delta": {"stop_reason": "pause_turn"}})
    ev, sent = run_web(monkeypatch, [paused, SEARCH_ROUND])
    assert ev[-1]["type"] == "done" and len(sent) == 2
    assert sent[1]["messages"][-1]["role"] == "assistant" and sent[1]["messages"][-1]["content"][0]["type"] == "server_tool_use"


def test_search_error_result_is_reported_not_raised(monkeypatch):
    err = sse({"type": "content_block_start", "index": 0, "content_block": {"type": "server_tool_use", "id": "s", "name": "web_search", "input": {}}},
              {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": '{"query": "q"}'}},
              {"type": "content_block_stop", "index": 0},
              {"type": "content_block_start", "index": 1, "content_block": {"type": "web_search_tool_result", "tool_use_id": "s", "content": {"type": "web_search_tool_result_error", "error_code": "max_uses_exceeded"}}},
              {"type": "content_block_stop", "index": 1},
              {"type": "content_block_start", "index": 2, "content_block": {"type": "text", "text": ""}},
              {"type": "content_block_delta", "index": 2, "delta": {"type": "text_delta", "text": "no web data"}},
              {"type": "content_block_stop", "index": 2}, {"type": "message_delta", "delta": {"stop_reason": "end_turn"}})
    ev, _ = run_web(monkeypatch, [err])
    assert any(e["type"] == "tool_end" and e["ok"] is False and e["error"] == "max_uses_exceeded" for e in ev)
    assert ev[-1]["type"] == "done" and ev[-1]["sources"] == []
