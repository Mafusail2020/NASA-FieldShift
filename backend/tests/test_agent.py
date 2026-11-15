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


def test_tool_errors_are_data_not_exceptions():
    assert "outside the grid" in REG.run("get_field", CTX, {"field_id": "f2"})["error"]
    assert "unknown field" in REG.run("get_field", CTX, {"field_id": "zzz"})["error"]
    assert "unknown crop" in REG.run("get_crop", CTX, {"crop": "banana"})["error"]
    assert "several fields" in REG.run("get_field", CTX, {})["error"]
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
