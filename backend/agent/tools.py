"""Agent tools. One class per tool (name, description, JSON schema, run). All read-only.

`run` returns {"data": ..., "source": str, "status": str} and optionally "chart": {...} (shown in the UI, not sent to the model).
A farmer-facing error is raised as ToolError and goes back to the model as {"error": ...}.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date

import numpy as np
import pandas as pd

from agent.data import data
from agent.kb import kb
from core.twin import SEASONS, cell_center, find_twins, load_daily


class ToolError(Exception):
    pass


@dataclass
class AgentContext:
    """What the request carries: the farmer's fields (they live in the browser, not on the server)."""
    fields: list[dict] = field(default_factory=list)

    def field_by(self, ref: str | None) -> dict:
        if not self.fields:
            raise ToolError("the farmer has no fields yet")
        if ref is None:
            if len(self.fields) == 1:
                return self.fields[0]
            raise ToolError("several fields exist: pass field_id (see list_fields)")
        for f in self.fields:
            if ref in (f.get("id"), f.get("name")):
                return f
        raise ToolError(f"unknown field '{ref}'")

    def cell_of(self, f: dict) -> str:
        cid = f.get("cellId")
        if not cid and f.get("lat") is not None and f.get("lon") is not None:
            la, lo = cell_center(f["lat"], f["lon"])
            cid = f"{la}_{lo}"
        if not cid:
            raise ToolError(f"field '{f.get('name')}' has no coordinates")
        if cid not in data.grid["cells"]:
            raise ToolError(f"cell {cid} is outside the grid (Ukraine grid cells only)")
        return cid


class Tool(ABC):
    name: str
    description: str
    input_schema: dict

    @abstractmethod
    def run(self, ctx: AgentContext, args: dict) -> dict: ...

    def spec(self) -> dict:
        return {"name": self.name, "description": self.description, "input_schema": self.input_schema}


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


FIELD_ID = {"type": "string", "description": "field id or name from list_fields; may be omitted when there is one field"}
GRID_SRC = "NASA POWER daily 1991-2025 (MERRA-2 reanalysis), cell centre, FAO-56 Penman-Monteith ETo"


class ListFields(Tool):
    name = "list_fields"
    description = "List all of the farmer's fields with crop, area, rotation, sowing date and grid cell. Call first for any question about 'my fields'."
    input_schema = _obj({})

    def run(self, ctx, args):
        rows = []
        for f in ctx.fields:
            try:
                cell = ctx.cell_of(f)
            except ToolError:
                cell = None
            rows.append({k: f.get(k) for k in ("id", "name", "lat", "lon", "areaHa", "crop", "sowingDate", "rotation", "soil")} | {"cell": cell})
        return {"data": {"fields": rows, "total_area_ha": round(sum(f.get("areaHa") or 0 for f in ctx.fields), 1)},
                "source": "entered by the farmer", "status": "data"}


class GetField(Tool):
    name = "get_field"
    description = "Everything known about one field: inputs, grid cell, elevation, SoilGrids texture and preset, optional soil analysis (ECe, pH, humus)."
    input_schema = _obj({"field_id": FIELD_ID})

    def run(self, ctx, args):
        f = ctx.field_by(args.get("field_id"))
        cid = ctx.cell_of(f)
        s = data.soil["cells"].get(cid, {})
        a = f.get("analysis") or {}
        return {"data": {"field": {k: f.get(k) for k in ("id", "name", "lat", "lon", "areaHa", "crop", "sowingDate", "rotation")},
                         "cell": cid, "elevation_m": data.grid["cells"][cid]["elevation_m"],
                         "soil_used": f.get("soil") or s.get("preset") or "medium (default, no SoilGrids data)",
                         "soilgrids": {k: s.get(k) for k in ("texture", "clay_pct", "sand_pct", "silt_pct", "ph", "humus_pct") if k in s},
                         "farmer_soil_analysis": {k: v for k, v in a.items() if v not in (None, [], {}, False)}},
                "source": "farmer input; " + data.soil["source"][:120], "status": "estimate"}


class GetClimate(Tool):
    name = "get_climate"
    description = ("Yearly climate series for a field's grid cell, 1991-2025, with mean, driest/wettest etc. extremes and a linear trend. "
                   "metric: precip_mm (annual rain), eto_mm (annual reference evapotranspiration), tmean_c (annual mean temp), july_tmax_c (mean July max temp).")
    input_schema = _obj({"field_id": FIELD_ID,
                         "metric": {"type": "string", "enum": ["precip_mm", "eto_mm", "tmean_c", "july_tmax_c"]},
                         "from_year": {"type": "integer"}, "to_year": {"type": "integer"}}, ["metric"])

    def run(self, ctx, args):
        f = ctx.field_by(args.get("field_id"))
        cid = ctx.cell_of(f)
        m = args["metric"]
        if m not in ("precip_mm", "eto_mm", "tmean_c", "july_tmax_c"):
            raise ToolError("unknown metric")
        years = data.grid["years"]
        vals = data.grid["cells"][cid][m]
        lo, hi = args.get("from_year") or years[0], args.get("to_year") or years[-1]
        pts = [(y, v) for y, v in zip(years, vals) if lo <= y <= hi and v is not None]
        if len(pts) < 3:
            raise ToolError("fewer than 3 years in range")
        ys, vs = np.array([p[0] for p in pts]), np.array([p[1] for p in pts])
        slope = float(np.polyfit(ys, vs, 1)[0]) * 10
        order = np.argsort(vs)
        d = {"field": f.get("name"), "cell": cid, "metric": m, "n_years": len(pts), "mean": round(float(vs.mean()), 1),
             "lowest_years": [[int(ys[i]), float(vs[i])] for i in order[:3]], "highest_years": [[int(ys[i]), float(vs[i])] for i in order[::-1][:3]],
             "linear_trend_per_decade": round(slope, 2), "last_5_mean": round(float(vs[-5:].mean()), 1),
             "note": "plain linear slope; for the significance-tested trend call get_risk_layers"}
        return {"data": d, "source": GRID_SRC, "status": "estimate",
                "chart": {"kind": "line", "title": f"{m} - {f.get('name')}", "x": [int(y) for y in ys], "series": [{"name": m, "values": [float(v) for v in vs]}]}}


class GetMonthly(Tool):
    name = "get_monthly_climate"
    description = ("Monthly rain (mm), mean Tmax and Tmin (C) for a field's cell: the 1991-2025 normal, and optionally one year to compare against it. "
                   "Use for 'was this spring dry', 'how did 2024 compare'.")
    input_schema = _obj({"field_id": FIELD_ID, "year": {"type": "integer", "description": "optional year to compare with the normal"}})

    def run(self, ctx, args):
        f = ctx.field_by(args.get("field_id"))
        cid = ctx.cell_of(f)
        df = load_daily(cid)
        if df is None:
            raise ToolError(f"no daily archive for cell {cid}")
        df = df.dropna(subset=["PRECTOTCORR"])
        mon = df.groupby([df.index.year, df.index.month]).agg(rain=("PRECTOTCORR", "sum"), tmax=("T2M_MAX", "mean"), tmin=("T2M_MIN", "mean"))
        mon.index.names = ["y", "m"]
        base = mon[mon.index.get_level_values("y") <= 2025].groupby("m").mean().round(1)
        out = {"cell": cid, "normal_1991_2025": {int(m): r.to_dict() for m, r in base.iterrows()}}
        series = [{"name": "normal rain mm", "values": base["rain"].tolist()}]
        y = args.get("year")
        if y:
            if y not in mon.index.get_level_values("y"):
                raise ToolError(f"no data for {y}")
            sel = mon.xs(y, level="y").round(1)
            out["year"] = {"year": y, "months": {int(m): r.to_dict() for m, r in sel.iterrows()}}
            series.append({"name": f"{y} rain mm", "values": [float(sel["rain"].get(m, 0)) for m in range(1, 13)]})
        return {"data": out, "source": GRID_SRC, "status": "estimate",
                "chart": {"kind": "bar", "title": f"Monthly rain - {f.get('name')}", "x": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], "series": series}}


class GetRiskLayers(Tool):
    name = "get_risk_layers"
    description = ("Significance-tested trends and risk statistics for the field's cell: warming, rain trends, heavy-rain share, water balance, "
                   "days above 32/35 C, last spring / first autumn frost. Answers 'is my climate shifting'.")
    input_schema = _obj({"field_id": FIELD_ID})

    def run(self, ctx, args):
        f = ctx.field_by(args.get("field_id"))
        cid = ctx.cell_of(f)
        cell = data.layers["cells"].get(cid)
        if not cell:
            raise ToolError("no layer statistics for this cell")
        out = {}
        for k, v in cell.items():
            if k.endswith("_y") or not isinstance(v, dict):
                continue
            meta = data.layers["layers"].get(k, {})
            if "value" in v:
                out[k] = {"label": meta.get("label", k), "unit": meta.get("unit"), "value": v["value"], "trend": v.get("trend"),
                          "trend_unit": meta.get("trend_unit"), "significant": (v.get("p_value") is not None and v["p_value"] < data.layers["alpha"])}
            else:
                out[k] = {"label": meta.get("label", k), "unit": meta.get("unit"), "days_of_year": {t: {x: y for x, y in r.items() if x != "n_years"} for t, r in v.items()}}
        return {"data": {"cell": cid, "layers": out, "alpha": data.layers["alpha"]}, "source": data.layers["layers"]["temp_trend"]["source"],
                "status": "estimate"}


class SeasonTwin(Tool):
    name = "season_twin"
    description = "The 3 past years whose weather since sowing is closest to this season, and how they ended. Needs crop (winter wheat or maize) and sowing date on the field."
    input_schema = _obj({"field_id": FIELD_ID})

    def run(self, ctx, args):
        f = ctx.field_by(args.get("field_id"))
        cid = ctx.cell_of(f)
        crop, sowing = f.get("crop"), f.get("sowingDate")
        if crop not in SEASONS:
            raise ToolError("season twins support only winter_wheat and maize; the field's crop is " + str(crop))
        if not sowing:
            raise ToolError("the field has no sowing date")
        sd = date.fromisoformat(sowing)
        df = load_daily(cid)
        if df is None:
            raise ToolError(f"no daily archive for cell {cid}")
        r = find_twins(df, crop, f"{sd.month:02d}-{sd.day:02d}", sd.year + SEASONS[crop].sow_year_offset)
        return {"data": r, "source": "dekad trajectories of cumulative rain, GDD, Tmax, radiation (core/twin.py); " + GRID_SRC,
                "status": "estimate"}


class GetCrop(Tool):
    name = "get_crop"
    description = ("Direct parameter lookup for one crop: growth stages, optimum temperature, salt tolerance, pH range, national yield history, "
                   "KMU 164 minimum return interval. crop ids: winter_wheat, maize, sunflower, pea, soybean, sugar_beet, spring_barley, winter_barley, "
                   "winter_rapeseed, millet, oats, buckwheat, black_fallow.")
    input_schema = _obj({"crop": {"type": "string"}}, ["crop"])

    def run(self, ctx, args):
        c = args["crop"]
        rows = data.crops_csv[data.crops_csv.crop == c]
        eco = data.ecocrop[data.ecocrop.crop == c]
        fao = data.faostat[data.faostat.crop == c]
        if rows.empty and eco.empty and fao.empty:
            raise ToolError(f"unknown crop '{c}'")
        d: dict = {"crop": c}
        d["params"] = {r.parameter: {"value": r.value, "unit": r.unit, "status": r.status} for r in rows.itertuples() if r.value != ""}
        d["ecocrop"] = {r.parameter: r.value for r in eco.itertuples()}
        if not fao.empty:
            y = fao.sort_values("year")
            d["national_yield_t_ha"] = {"years": f"{int(y.year.min())}-{int(y.year.max())}", "last": round(float(y.yield_t_ha.iloc[-1]), 2),
                                         "mean_last_10": round(float(y.yield_t_ha.tail(10).mean()), 2), "min": round(float(y.yield_t_ha.min()), 2), "max": round(float(y.yield_t_ha.max()), 2)}
        k = data.kmu.get(c)
        if k:
            d["kmu_164_min_return_years"] = k["min_return_years"]
        from app.store import store
        s = store.salt[store.salt.species == c] if "species" in store.salt else None
        if s is not None and len(s):
            d["salt_tolerance"] = {r.parameter: r.value for r in s.itertuples() if r.parameter in ("a", "b")} | {"meaning": "yield starts to fall above a (dS/m ECe), then b % per dS/m"}
        return {"data": d, "source": "FAO-56 Table 11, FAO EcoCrop, FAOSTAT (Ukraine national), KMU 164, FAO-61; per-parameter status inside", "status": "literature"}


class SearchKB(Tool):
    name = "search_kb"
    description = ("Search the agronomy knowledge base (crop sheets, rotation principles, stress physiology, how the app computes things, known data gaps). "
                   "Use for 'why', 'what predecessor', 'what does X mean' questions. Returns text chunks with sources.")
    input_schema = _obj({"query": {"type": "string"}, "k": {"type": "integer", "description": "chunks to return, default 4"}}, ["query"])

    def run(self, ctx, args):
        hits = kb.search(args["query"], min(int(args.get("k") or 4), 8))
        if not hits:
            return {"data": {"chunks": [], "note": "nothing relevant in the knowledge base; say so, do not guess"}, "source": "knowledge base", "status": "data"}
        return {"data": {"chunks": hits}, "source": "; ".join(sorted({h["source"] for h in hits}))[:300], "status": "estimate"}


# ---- rotations ----
METRICS = ("mean_ks_mid", "water_stress_days", "heat_days_1", "bare_months", "min_winter_tmin_no_snow")


def _soil_preset(ctx: AgentContext, f: dict, cid: str) -> str:
    return f.get("soil") or data.soil["cells"].get(cid, {}).get("preset") or "medium"


def _rotation_stats(cell: dict, soil: str, rotation: list[str]) -> dict:
    """Mean over the years of each metric, along the cyclic transitions a>b of the rotation."""
    pairs = cell["soils"][soil]
    per_year: dict[str, list[float]] = {}
    missing = []
    n = len(rotation)
    for i in range(n):
        key = f"{rotation[i]}>{rotation[(i + 1) % n]}"
        p = pairs.get(key)
        if p is None:
            missing.append(key)
            continue
        for m in METRICS:
            arr = [v for v in p[m] if v is not None]
            if arr:
                per_year.setdefault(m, []).append(float(np.mean(arr)) if m != "min_winter_tmin_no_snow" else float(np.min(arr)))
    if missing:
        return {"computable": False, "missing_transitions": missing}
    return {"computable": True, "years_used": f"{pairs[next(iter(pairs))]['year'][0]}-{pairs[next(iter(pairs))]['year'][-1]}",
            "mean_ks_mid": round(float(np.mean(per_year["mean_ks_mid"])), 3), "water_stress_days_per_year": round(float(np.mean(per_year["water_stress_days"])), 1),
            "heat_days_per_year": round(float(np.mean(per_year["heat_days_1"])), 1), "bare_soil_months_per_year": round(float(np.mean(per_year["bare_months"])), 1),
            "coldest_winter_tmin_no_snow_c": round(float(np.min(per_year["min_winter_tmin_no_snow"])), 1)}


def _kmu_check(rotation: list[str]) -> list[str]:
    out, n = [], len(rotation)
    for c in dict.fromkeys(rotation):
        k = data.kmu.get(c)
        if not k:
            continue
        idx = [i for i, x in enumerate(rotation) if x == c]
        gaps = [(idx[(j + 1) % len(idx)] - idx[j]) % n or n for j in range(len(idx))]
        if min(gaps) < k["min_return_years"]:
            out.append(f"{c}: returns after {min(gaps)} year(s), KMU 164 asks at least {k['min_return_years']}")
    return out


class EvaluateRotation(Tool):
    name = "evaluate_rotation"
    description = ("Weather-risk numbers for one rotation (list of crop ids in order, cyclic) on a field's cell and soil, averaged over 1993-2025: "
                   "water stress days, heat days, bare-soil months, mean water-stress factor Ks (1 = no stress), plus the KMU 164 check. "
                   "Without 'rotation' uses the field's own rotation.")
    input_schema = _obj({"field_id": FIELD_ID, "rotation": {"type": "array", "items": {"type": "string"}}})

    def run(self, ctx, args):
        f = ctx.field_by(args.get("field_id"))
        cid = ctx.cell_of(f)
        rot = args.get("rotation") or f.get("rotation")
        if not rot:
            raise ToolError("no rotation given and the field has none")
        cell = data.rotation_cell(cid)
        if cell is None:
            raise ToolError(f"no rotation analysis for cell {cid}")
        soil = _soil_preset(ctx, f, cid)
        return {"data": {"field": f.get("name"), "cell": cid, "soil": soil, "rotation": rot, **_rotation_stats(cell, soil, rot), "kmu_164_issues": _kmu_check(rot)},
                "source": "FAO-56 single-bucket water balance on NASA POWER daily weather (core/); KMU 164", "status": "estimate"}


class CompareRotations(Tool):
    name = "compare_rotations"
    description = "Compare the field's current rotation with the draft alternatives A-E and any extra rotations you pass, ranked by water stress days."
    input_schema = _obj({"field_id": FIELD_ID, "extra": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}}})

    def run(self, ctx, args):
        f = ctx.field_by(args.get("field_id"))
        cid = ctx.cell_of(f)
        cell = data.rotation_cell(cid)
        if cell is None:
            raise ToolError(f"no rotation analysis for cell {cid}")
        soil = _soil_preset(ctx, f, cid)
        cands = [("current", f.get("rotation"))] if f.get("rotation") else []
        cands += [(f"{c['id']} {c['name']}", c["crops"]) for c in data.rotations_grid["candidates"]]
        cands += [(f"extra {i + 1}", r) for i, r in enumerate(args.get("extra") or [])]
        rows = []
        for name, rot in cands:
            st = _rotation_stats(cell, soil, rot)
            rows.append({"name": name, "rotation": rot, **st, "kmu_164_issues": _kmu_check(rot)})
        ok = sorted([r for r in rows if r["computable"]], key=lambda r: r["water_stress_days_per_year"])
        ok += [r for r in rows if not r["computable"]]
        chart = {"kind": "bar", "title": "Water stress days per year", "x": [r["name"] for r in ok if r["computable"]],
                 "series": [{"name": "days", "values": [r["water_stress_days_per_year"] for r in ok if r["computable"]]}]}
        return {"data": {"field": f.get("name"), "cell": cid, "soil": soil, "ranked": ok,
                         "note": "alternatives A-E are drafts, not agronomist-approved; weather risk only, no yields or prices"},
                "source": "FAO-56 water balance on NASA POWER; alternatives: draft by the team", "status": "estimate", "chart": chart}


class SoilCheck(Tool):
    name = "soil_check"
    description = "Salt (ECe) and pH check of crops for a field using the farmer's soil analysis. Says 'not entered' when the farmer gave no ECe or pH."
    input_schema = _obj({"field_id": FIELD_ID, "crops": {"type": "array", "items": {"type": "string"}}})

    def run(self, ctx, args):
        from app.store import store
        from core.soil import crop_factors
        f = ctx.field_by(args.get("field_id"))
        a = f.get("analysis") or {}
        crops = args.get("crops") or list(dict.fromkeys([*(f.get("rotation") or []), *([f["crop"]] if f.get("crop") else [])]))
        if not crops:
            raise ToolError("no crops given and the field has none")
        m = store.soil_model
        res = [crop_factors(c, a.get("ece"), a.get("ph"), store.salt, store.ph, bool(a.get("gypsum")), m["gypsum_shift"], m["exclude_below"])
               for c in crops if c != "black_fallow"]
        return {"data": {"ece": a.get("ece"), "ph": a.get("ph"), "crops": res, "note": "f_salt = share of normal yield left; excluded = below 0.5; pH only warns"},
                "source": "FAO-61 Annex 1 (salt), ECOCROP (pH)", "status": "literature"}


class ToolRegistry:
    def __init__(self, tools: list[Tool]):
        self._tools = {t.name: t for t in tools}

    @classmethod
    def default(cls) -> "ToolRegistry":
        return cls([ListFields(), GetField(), GetClimate(), GetMonthly(), GetRiskLayers(), SeasonTwin(), GetCrop(), SearchKB(),
                    EvaluateRotation(), CompareRotations(), SoilCheck()])

    def specs(self) -> list[dict]:
        return [t.spec() for t in self._tools.values()]

    def run(self, name: str, ctx: AgentContext, args: dict) -> dict:
        t = self._tools.get(name)
        if t is None:
            return {"error": f"unknown tool {name}"}
        try:
            return t.run(ctx, args or {})
        except ToolError as e:
            return {"error": str(e)}
        except Exception as e:  # a bad tool must not kill the chat
            return {"error": f"{name} failed: {type(e).__name__}"}
