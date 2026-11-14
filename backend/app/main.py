from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import regions

app = FastAPI(title="Field Shift")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["*"])
app.include_router(regions.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
