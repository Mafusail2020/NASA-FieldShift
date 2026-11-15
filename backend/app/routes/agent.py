import json
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent.agent import Agent
from agent.llm import LLMRouter
from agent.tools import AgentContext

router = APIRouter(prefix="/api/agent")
RATE = (20, 60.0)  # requests per window (seconds) per client
_hits: dict[str, deque] = defaultdict(deque)


class Msg(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    messages: list[Msg] = Field(min_length=1, max_length=30)
    fields: list[dict] = Field(default_factory=list, max_length=40)
    web_search: bool = True  # let Claude use Anthropic's web search (ignored by the local model)


def _limit(ip: str) -> None:
    q, now = _hits[ip], time.monotonic()
    while q and now - q[0] > RATE[1]:
        q.popleft()
    if len(q) >= RATE[0]:
        raise HTTPException(429, "too many questions, wait a minute")
    q.append(now)


@router.get("/status")
def status(x_anthropic_key: str | None = Header(default=None)):
    """Which models can answer right now. Never returns the key."""
    return {"providers": LLMRouter.from_request(x_anthropic_key).status()}


@router.post("/chat")
def chat(req: ChatRequest, request: Request, x_anthropic_key: str | None = Header(default=None)):
    _limit(request.client.host if request.client else "?")
    if req.messages[-1].role != "user":
        raise HTTPException(422, "last message must be from the user")
    agent = Agent(LLMRouter.from_request(x_anthropic_key, req.web_search))
    history = [m.model_dump() for m in req.messages]

    def stream():
        for ev in agent.run(history, AgentContext(fields=req.fields)):
            yield f"data: {json.dumps(ev, default=str)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
