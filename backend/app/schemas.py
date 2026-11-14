from typing import Literal

from pydantic import BaseModel, Field

Status = Literal["data", "literature", "estimate", "todo"]
Crop = Literal["winter_wheat", "maize", "black_fallow"]


class Region(BaseModel):
    id: str
    name_en: str
    name_uk: str
    n_points: int
    source: str
    status: Status


class Climate(BaseModel):
    region: str
    years: list[int]
    precip_mm: list[float]
    eto_mm: list[float]
    july_tmax_c: list[float]
    source: str
    status: Status


class RotationRequest(BaseModel):
    rotation: list[Crop] = Field(min_length=1, max_length=6, description="One crop per year, repeated cyclically")
    soil: Literal["light", "medium", "heavy"] = "medium"


class Criterion(BaseModel):
    id: str
    label: str
    value: float | None
    unit: str
    text: str
    source: str
    status: Status
    crop: str | None = None
    norm: int | None = None
    p10: float | None = None
    by_crop: dict[str, float] | None = None


class StripMonth(BaseModel):
    month: int
    label: str | None
    frac: float | None


class StripSlot(BaseModel):
    slot: int
    crop: str
    months: list[StripMonth]


class PerCrop(BaseModel):
    slot: int
    crop: str
    n_years: int
    mean_ks_mid: float | None = None
    mean_ks_mid_p10: float | None = None
    water_stress_days: float | None = None
    heat_days_1: float | None = None
    heat_days_2: float | None = None
    soil_water_at_sowing_frac: float
    bare_months: float
    min_winter_tmin_no_snow: float | None = None


class Evaluation(BaseModel):
    rotation: list[str]
    years: list[int]
    criteria: list[Criterion]
    per_crop: list[PerCrop]
    strip: list[StripSlot]
    note: str


class Alternative(BaseModel):
    id: str
    name: str
    source: str
    status: Status
    evaluation: Evaluation


class EvaluateResponse(BaseModel):
    region: str
    soil: str
    farmer: Evaluation
    alternatives: list[Alternative]


class DefaultRow(BaseModel):
    crop: str
    parameter: str
    value: float | None
    unit: str
    source: str
    status: Status


class Defaults(BaseModel):
    prices_costs: list[DefaultRow]
    k: list[DefaultRow]


class EconomicsRequest(BaseModel):
    region: str
    rotation: list[Crop] = Field(min_length=1, max_length=6)
    use_k: bool = True
    price: dict[str, float] = {}
    cost: dict[str, float] = {}


class Money(BaseModel):
    rotation: list[str]
    margins: dict[str, float]
    summary: dict[str, float]


class EconomicsResponse(BaseModel):
    region: str
    use_k: bool
    farmer: Money
    alternatives: dict[str, Money]
    best_alternative_with_k: str
    best_alternative_without_k: str
    note: str
