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


class CropStress(BaseModel):
    years: list[int]
    mean_ks_mid: list[float | None]
    water_stress_days: list[float | None]
    heat_days_1: list[float | None]
    heat_days_2: list[float | None]
    heat_threshold_1_c: float | None
    heat_threshold_2_c: float | None
    heat_status: Status
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
    stress: dict[str, CropStress]
    frost_status: Status
    frost_note: str


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
    crops: list[str] | None = None


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


class BreakEven(BaseModel):
    crop: str
    k: float
    yield_t_ha: float
    price_uah_t: float


class Money(BaseModel):
    rotation: list[str]
    margins: dict[str, float]
    summary: dict[str, float]
    break_even: list[BreakEven] = []


class EconomicsResponse(BaseModel):
    region: str
    use_k: bool
    farmer: Money
    alternatives: dict[str, Money]
    best_alternative_with_k: str
    best_alternative_without_k: str
    note: str


class SoilRequest(BaseModel):
    """Soil analysis of one field. ECe in dS/m (saturated paste), pH in water, yields in c/ha (normal yield of the crop)."""
    rotation: list[str] = Field(min_length=1, max_length=8, description="One crop per year, repeated cyclically")
    ece: float | None = Field(None, ge=0, le=60)
    ph: float | None = Field(None, ge=2, le=12)
    humus_pct: float | None = Field(None, ge=0, le=15)
    gypsum: bool = False
    yields_c_ha: dict[str, float] = {}
    manure_t_ha_rotation: float = Field(0, ge=0, le=500, description="Manure per rotation; the model uses it per year (divided by the rotation length)")
    green_t_ha: float = Field(0, ge=0, le=100, description="Green mass ploughed in after each crop listed in green_after")
    green_after: list[str] = []


class CropSoil(BaseModel):
    crop: str
    f_salt: float | None
    f_ph: float | None
    factor: float
    excluded: bool
    ph_warning: bool
    low_confidence: bool
    notes: list[str]
    salt_source: str | None = None
    salt_status: Status | None = None
    ph_source: str | None = None
    ph_status: Status | None = None


class HumusYear(BaseModel):
    year: int
    crop: str
    p1: float
    p2: float
    p3: float
    p: float
    balance: float
    status: Status
    source: str


class HumusResult(BaseModel):
    years: list[HumusYear]
    missing: list[str]
    mean_balance: float | None
    per_rotation: float | None
    manure_norm: float | None
    humus_pct_after_10y: float | None


class SoilResponse(BaseModel):
    crops: list[CropSoil]
    humus: HumusResult
    source: str
    status: Status
    notes: list[str]
