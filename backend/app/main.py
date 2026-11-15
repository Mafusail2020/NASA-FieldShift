from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import economics, meta, regions, soil, twin

app = FastAPI(title="Field Shift")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["*"])
app.include_router(regions.router)
app.include_router(economics.router)
app.include_router(meta.router)
app.include_router(soil.router)
app.include_router(twin.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
