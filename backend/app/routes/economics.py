from fastapi import APIRouter, HTTPException

from app.schemas import Defaults, DefaultRow, EconomicsRequest, EconomicsResponse, Money
from app.store import store
from core.economics import rotation_margins, summary

router = APIRouter(prefix="/api")
FALLOW = "black_fallow"


def _num(v: str):
    return float(v) if v != "" else None


@router.get("/defaults", response_model=Defaults)
def defaults():
    price = [DefaultRow(crop=r.crop, parameter=r.parameter, value=_num(r.value), unit=r.unit, source=r.source, status=r.status)
             for r in store.prices.itertuples()]
    k = [DefaultRow(crop=r.crop, parameter=f"k after {r.predecessor}", value=_num(r.value), unit=r.unit, source=r.source, status=r.status)
         for r in store.k.itertuples()]
    return Defaults(prices_costs=price, k=k)


def _inputs(req: EconomicsRequest):
    """Prices and costs: request overrides first, then defaults. Raises 422 naming whatever is still todo."""
    t = {(r.crop, r.parameter): r for r in store.prices.itertuples()}
    price, cost, missing = {}, {}, []
    for c in set(req.rotation) | {x for a in store.alternatives for x in a["crops"]}:
        if c != FALLOW:
            v = req.price.get(c) if req.price.get(c) is not None else _num(t[(c, "price_uah_per_t")].value)
            if v is None:
                missing.append(f"price of {c}")
            price[c] = v
        v = req.cost.get(c) if req.cost.get(c) is not None else _num(t[(c, "cost_uah_per_ha")].value)
        if v is None:
            missing.append(f"cost of {c}")
        cost[c] = v
    if missing:
        raise HTTPException(422, "Missing inputs (status todo, supply them in the request): " + ", ".join(sorted(missing)))
    return price, cost


def _money(rotation, yhat, kt, price, cost, use_k) -> Money:
    m = rotation_margins(rotation, yhat, kt, price, cost, use_k)
    return Money(rotation=rotation, margins={str(y): v for y, v in m.items()}, summary=summary(m))


@router.post("/economics", response_model=EconomicsResponse)
def economics(req: EconomicsRequest):
    if req.region not in store.regions:
        raise HTTPException(404, f"unknown region {req.region}")
    if store.yields is None:
        raise HTTPException(503, "No yield data loaded yet (data/raw/yields is todo)")
    price, cost = _inputs(req)
    crops = {c for a in store.alternatives for c in a["crops"]} | set(req.rotation)
    yhat = {c: store.yhat(req.region, c) for c in crops if c != FALLOW}
    empty = [c for c, v in yhat.items() if not v]
    if empty:
        raise HTTPException(503, "No yield data for: " + ", ".join(sorted(empty)))
    kt = {(r.crop, r.predecessor): float(r.value) for r in store.k.itertuples() if r.value != ""}
    rots = [("you", "Your rotation", list(req.rotation))] + [(a["id"], a["name"], a["crops"]) for a in store.alternatives]
    with_k = {i: _money(r, yhat, kt, price, cost, True) for i, _, r in rots}
    no_k = {i: _money(r, yhat, kt, price, cost, False) for i, _, r in rots}
    use = with_k if req.use_k else no_k
    win = lambda d: max((i for i in d if i != "you"), key=lambda i: d[i].summary["median"])
    return EconomicsResponse(region=req.region, use_k=req.use_k, farmer=use["you"],
                             alternatives={i: use[i] for i, _, _ in rots if i != "you"},
                             best_alternative_with_k=win(with_k), best_alternative_without_k=win(no_k),
                             note="Margins per hectare per year in UAH; k is the predecessor effect, shown on and off.")
