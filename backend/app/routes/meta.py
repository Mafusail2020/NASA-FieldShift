from typing import Any

from fastapi import APIRouter

from app.store import store

router = APIRouter(prefix="/api")


@router.get("/meta")
def meta() -> dict[str, Any]:
    """Everything the Method page shows: datasets, formulas, crops and params with source/status, validation."""
    return store.meta
