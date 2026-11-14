from fastapi import FastAPI

app = FastAPI(title="Field Shift")


@app.get("/api/health")
def health():
    return {"status": "ok"}
