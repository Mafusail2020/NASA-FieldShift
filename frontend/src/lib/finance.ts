import { useCallback, useEffect, useState } from 'react'
import type { FieldItem } from './field'
import { soilFactorOf, type SoilDoc } from './soil'
// Pure helpers for the Finance page. No data is invented here: every input comes from finance_inputs.json or the user.
export type FStatus = 'data' | 'literature' | 'estimate' | 'sample' | 'todo'
export interface YearValue { year: number; value: number }
export interface CropInputs {
  label: string
  yields: YearValue[]
  yield_source: string; yield_status: FStatus
  prices: (YearValue & { usd?: number | null })[]
  price_source: string | null; price_status: FStatus
  psd: { year: number; value: number; status: FStatus; source: string }[]
  cost_uah_per_ha: number | null; cost_status: FStatus
  // Sample cost items in USD/ha (illustrative, status "sample"); the view-only fields below are filled by inCurrency in the chosen currency.
  cost_items?: CostItem[]; cost_items_source?: string | null; cost_items_status?: FStatus
  cost_default?: number | null; cost_var?: number | null
}
export interface CostItem { item: string; kind: 'variable' | 'fixed'; usd_per_ha: number }
export interface FinanceInputs {
  generated: string
  crops: Record<string, CropInputs>
  uga: { date: string; item: string; crop: string; usd_per_t: number; source: string; status: FStatus }[]
  k: { crop: string; predecessor: string; value: number; source: string; status: FStatus }[]
  fx: { uah_per_usd: number; year: number; per_year: Record<string, number>; source: string; status: FStatus }
  notes: { yields: string; prices: string; missing: string }
}

export const YIELD_DEFAULT_YEARS = 10 // default yield = median of the last 10 FAOSTAT years
export const YIELD_RANGE_YEARS = 15   // range = 10th-90th percentile of the last 15 FAOSTAT years (raw, not detrended)

export function percentile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b)
  if (!s.length) return NaN
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}
export const median = (v: number[]) => percentile(v, 0.5)
export const lastN = (series: YearValue[], n: number) => series.slice(-n)

export interface Scenario { areaHa: number; yieldTHa: number; price: number; cost: number | null; k: number }
export interface Result {
  revenuePerHa: number; revenue: number
  marginPerHa: number | null; margin: number | null
  breakEvenYield: number | null; breakEvenPrice: number | null
}

// yield is multiplied by k (predecessor effect) for money only; k = 1 when switched off.
export function compute(s: Scenario): Result {
  const revenuePerHa = s.yieldTHa * s.k * s.price
  const cost = s.cost
  return {
    revenuePerHa, revenue: revenuePerHa * s.areaHa,
    marginPerHa: cost == null ? null : revenuePerHa - cost,
    margin: cost == null ? null : (revenuePerHa - cost) * s.areaHa,
    breakEvenYield: cost == null ? null : cost / (s.price * s.k),
    breakEvenPrice: cost == null ? null : cost / (s.yieldTHa * s.k),
  }
}

export interface Range { low: number; high: number }
// Low = low yield with price reduced by spread; high = high yield with price raised by spread (corners of the box).
export function rangeOf(s: Scenario, y: Range, spread: number): { revenuePerHa: Range; marginPerHa: Range | null } {
  const lo = compute({ ...s, yieldTHa: y.low, price: s.price * (1 - spread) })
  const hi = compute({ ...s, yieldTHa: y.high, price: s.price * (1 + spread) })
  return {
    revenuePerHa: { low: lo.revenuePerHa, high: hi.revenuePerHa },
    marginPerHa: lo.marginPerHa == null || hi.marginPerHa == null ? null : { low: lo.marginPerHa, high: hi.marginPerHa },
  }
}

// Share of historical yield years with a negative margin at the user's price, cost and k.
export function lossShare(yields: number[], s: Scenario): { losing: number; total: number } | null {
  if (s.cost == null || !yields.length) return null
  return { losing: yields.filter((y) => y * s.k * s.price - s.cost! < 0).length, total: yields.length }
}

export const validPos = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n > 0
export const validNonNeg = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n >= 0

export type Currency = 'USD' | 'UAH'
// Money amounts: whole numbers from 100 up, two decimals below (so a 5 USD/t difference is not rounded away).
export const fmtMoney = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: Math.abs(v) >= 100 ? 0 : 2, maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 })
// Converts a typed amount to the other currency with the user's rate; UAH rounded to whole hryvnias, USD to cents.
export function convertAmount(v: number, to: Currency, uahPerUsd: number): number {
  return to === 'UAH' ? Math.round(v * uahPerUsd) : Math.round((v / uahPerUsd) * 100) / 100
}
// Crop price series in one currency; years without a value in that column are dropped. USD is FAO's own conversion.
export function priceSeries(prices: CropInputs['prices'], cur: Currency): YearValue[] {
  return prices.flatMap((p) => { const v = cur === 'USD' ? p.usd : p.value; return v == null ? [] : [{ year: p.year, value: v }] })
}

// ---- shared inputs: one store for the Finance page and the Fields page summaries ----
type Str = Record<string, string>
export interface FinSettings {
  cur: Currency; rateStr: string; spread: number
  yieldStr: Str; priceStr: Str; costStr: Str   // per CROP, typed in the selected currency
  areaMap: Str; cropMap: Str                    // per FIELD id: area/crop typed on the Finance page instead of the Fields-page values
}
export const DEFAULT_SPREAD = 20 // price +-% is the user's assumption, not data
const SETTINGS_KEY = 'fieldshift.finance.v1'
const EMPTY_SETTINGS: FinSettings = { cur: 'USD', rateStr: '', spread: DEFAULT_SPREAD, yieldStr: {}, priceStr: {}, costStr: {}, areaMap: {}, cropMap: {} }

function loadSettings(): FinSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...EMPTY_SETTINGS, ...JSON.parse(raw) }
    const old = localStorage.getItem('fieldshift.finance.currency') // currency key of the first version
    if (old === 'UAH') return { ...EMPTY_SETTINGS, cur: 'UAH' }
  } catch { /* storage unavailable or corrupt */ }
  return EMPTY_SETTINGS
}

export function useFinSettings(): [FinSettings, (patch: Partial<FinSettings>) => void] {
  const [s, setS] = useState<FinSettings>(loadSettings)
  const patch = useCallback((p: Partial<FinSettings>) => setS((st) => {
    const next = { ...st, ...p }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
    return next
  }), [])
  return [s, patch]
}

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: FinanceInputs }
let inputsPromise: Promise<FinanceInputs> | null = null
export function useFinanceInputs(): Load {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  useEffect(() => {
    inputsPromise ??= fetch('/data/finance_inputs.json').then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<FinanceInputs> })
    inputsPromise.then((data) => setLoad({ state: 'ready', data }), () => { inputsPromise = null; setLoad({ state: 'error' }) })
  }, [])
  return load
}

// Inputs with every crop price taken from the FAOSTAT column of the selected currency.
// Default cost (sample items, USD) is converted with the rate; a typed cost always wins.
export function inCurrency(raw: FinanceInputs, cur: Currency, rate: number = raw.fx.uah_per_usd): FinanceInputs {
  const conv = (usd: number) => (cur === 'USD' ? usd : usd * rate)
  const sum = (c: CropInputs, kind?: CostItem['kind']) => (c.cost_items ?? []).filter((i) => !kind || i.kind === kind).reduce((t, i) => t + i.usd_per_ha, 0)
  return { ...raw, crops: Object.fromEntries(Object.entries(raw.crops).map(([id, c]) => {
    const has = (c.cost_items?.length ?? 0) > 0 && Number.isFinite(conv(1))
    return [id, { ...c, prices: priceSeries(c.prices, cur), cost_default: has ? Math.round(conv(sum(c))) : null, cost_var: has ? Math.round(conv(sum(c, 'variable'))) : null }]
  })) }
}
// The exchange rate in use: typed (valid) or the FAO implied default.
export function fxRate(raw: FinanceInputs, s: FinSettings): number {
  const t = s.rateStr.trim() !== '' ? Number(s.rateStr) : NaN
  return validPos(t) ? t : raw.fx.uah_per_usd
}
export const viewData = (raw: FinanceInputs, s: FinSettings) => inCurrency(raw, s.cur, fxRate(raw, s))

const parseStr = (s: string | undefined) => (s == null || s.trim() === '' ? null : Number(s))

// soil: yield multiplier from the field's soil analysis (salt only; pH only warns). It scales the default yield and the historical range only;
// a yield typed by the user is taken as is (the user already knows the field).
export function cropCalc(c: CropInputs, area: number, yS: string | undefined, pS: string | undefined, cS: string | undefined, spread: number, soil = 1) {
  const typed = !!yS && yS.trim() !== ''
  const dflt = median(lastN(c.yields, YIELD_DEFAULT_YEARS).map((p) => p.value)) * soil
  const y = typed ? Number(yS) : dflt
  const p = pS && pS.trim() !== '' ? Number(pS) : c.prices[c.prices.length - 1]?.value ?? NaN
  const typedCost = parseStr(cS)
  const costRaw = typedCost ?? c.cost_default ?? null // typed cost, else the sample default
  const invalid = !validPos(y) || !validPos(p) || (costRaw != null && !validNonNeg(costRaw))
  const cost = costRaw != null && validNonNeg(costRaw) ? costRaw : null
  const yr = lastN(c.yields, YIELD_RANGE_YEARS).map((q) => q.value * (typed ? 1 : soil))
  const costDefault = typedCost == null && cost != null
  const varShare = c.cost_var != null && c.cost_default ? c.cost_var / c.cost_default : null // gross margin: variable part of the cost
  const sc: Scenario = { areaHa: area, yieldTHa: y, price: p, cost, k: 1 }
  const res = compute(sc)
  const rg = rangeOf(sc, { low: percentile(yr, 0.1), high: percentile(yr, 0.9) }, spread / 100)
  return {
    invalid, y, p, cost, costDefault, varShare, gross: res.revenue != null && cost != null && varShare != null ? res.revenue - cost * varShare * area : null,
    rev: res.revenue, revLow: rg.revenuePerHa.low * area, revHigh: rg.revenuePerHa.high * area,
    margin: res.margin, marLow: rg.marginPerHa ? rg.marginPerHa.low * area : null, marHigh: rg.marginPerHa ? rg.marginPerHa.high * area : null,
  }
}

// One field with the finance settings applied. Inputs are per crop; k is not applied (it depends on the previous crop).
// soilDoc: when given, the field's soil analysis (salt factor of this row's crop) scales the default yield; see cropCalc.
export function fieldRow(data: FinanceInputs, f: FieldItem, s: FinSettings, soilDoc: SoilDoc | null = null) {
  const cropId = s.cropMap[f.id] || f.crop || ''
  const c = data.crops[cropId]
  const area = (s.areaMap[f.id] ?? '').trim() !== '' ? Number(s.areaMap[f.id]) : f.areaHa
  const base = { f, cropId, cropLabel: c?.label ?? (cropId === 'black_fallow' ? 'Black fallow' : null), area: validPos(area) ? area : null }
  const soil = soilFactorOf(cropId, f.analysis, soilDoc)
  const calc = c && base.area != null ? cropCalc(c, base.area, s.yieldStr[cropId], s.priceStr[cropId], s.costStr[cropId], s.spread, soil) : null
  return { ...base, calc, soil }
}
export type FieldRow = ReturnType<typeof fieldRow>

// Totals over the fields that have a crop, an area and valid inputs; margin only if every counted field has a cost.
export function farmTotals(rows: FieldRow[]) {
  const ok = rows.filter((r) => r.calc && !r.calc.invalid)
  const sum = (pick: (c: NonNullable<FieldRow['calc']>) => number) => ok.reduce((t, r) => t + pick(r.calc!), 0)
  const hasMargin = ok.length > 0 && ok.every((r) => r.calc!.margin != null)
  return {
    ok, counted: ok.length, total: rows.length, area: ok.reduce((t, r) => t + r.area!, 0),
    rev: { low: sum((c) => c.revLow), mid: sum((c) => c.rev), high: sum((c) => c.revHigh) },
    mar: hasMargin ? { low: sum((c) => c.marLow!), mid: sum((c) => c.margin!), high: sum((c) => c.marHigh!) } : null,
  }
}

// ---- Stage 2: scenarios, sensitivity grid, tornado, break-even rows. Pure, per hectare unless said otherwise. ----
const margin1 = (y: number, p: number, k: number, cost: number | null) => y * k * p - (cost ?? 0)

export interface ScenarioCol { name: 'Bad' | 'Base' | 'Good'; yieldTHa: number; price: number; res: Result }
// Bad = low yield and low price, Good = high both; Base = the central values. A typed yield outside the range widens the range.
export function threeScenarios(s: Scenario, y: Range, spread: number): ScenarioCol[] {
  const lo = Math.min(y.low, s.yieldTHa), hi = Math.max(y.high, s.yieldTHa)
  const mk = (name: ScenarioCol['name'], yy: number, pp: number): ScenarioCol => ({ name, yieldTHa: yy, price: pp, res: compute({ ...s, yieldTHa: yy, price: pp }) })
  return [mk('Bad', lo, s.price * (1 - spread)), mk('Base', s.yieldTHa, s.price), mk('Good', hi, s.price * (1 + spread))]
}

// 5 x 5 grid of margin per ha (revenue per ha when there is no cost). Rows = yield low..high, columns = price -spread..+spread.
export function marginGrid(s: Scenario, y: Range, spread: number) {
  const lo = Math.min(y.low, s.yieldTHa), hi = Math.max(y.high, s.yieldTHa)
  const yields = [lo, (lo + s.yieldTHa) / 2, s.yieldTHa, (s.yieldTHa + hi) / 2, hi]
  const sp = Math.max(spread, 0.1)
  const prices = [-1, -0.5, 0, 0.5, 1].map((f) => s.price * (1 + f * sp))
  return { yields, prices, cells: yields.map((yy) => prices.map((pp) => margin1(yy, pp, s.k, s.cost))), hasCost: s.cost != null }
}

export interface TornadoRow { name: 'Yield' | 'Price' | 'Cost'; low: number; high: number }
// Margin per ha when one driver moves -pct / +pct and the others stay. Sorted by swing, largest first.
export function tornado(s: Scenario, pct = 0.1): { base: number; rows: TornadoRow[] } | null {
  if (s.cost == null) return null
  const m = (y: number, p: number, c: number) => margin1(y, p, s.k, c)
  const mk = (name: TornadoRow['name'], a: number, b: number): TornadoRow => ({ name, low: Math.min(a, b), high: Math.max(a, b) })
  const rows = [
    mk('Yield', m(s.yieldTHa * (1 - pct), s.price, s.cost), m(s.yieldTHa * (1 + pct), s.price, s.cost)),
    mk('Price', m(s.yieldTHa, s.price * (1 - pct), s.cost), m(s.yieldTHa, s.price * (1 + pct), s.cost)),
    mk('Cost', m(s.yieldTHa, s.price, s.cost * (1 - pct)), m(s.yieldTHa, s.price, s.cost * (1 + pct))),
  ].sort((a, b) => b.high - b.low - (a.high - a.low))
  return { base: m(s.yieldTHa, s.price, s.cost), rows }
}

export interface BreakEvenRow { id: string; label: string; y: number; p: number; cost: number | null; costDefault: boolean; beY: number | null; beP: number | null }
// One row per crop with the farm's current inputs (typed or default), k not applied.
export function breakEvenRows(data: FinanceInputs, ids: string[], s: FinSettings): BreakEvenRow[] {
  return ids.flatMap((id) => {
    const c = data.crops[id]
    if (!c) return []
    const x = cropCalc(c, 1, s.yieldStr[id], s.priceStr[id], s.costStr[id], s.spread)
    const ok = !x.invalid && x.cost != null
    return [{ id, label: c.label, y: x.y, p: x.p, cost: x.cost, costDefault: x.costDefault, beY: ok ? x.cost! / x.p : null, beP: ok ? x.cost! / x.y : null }]
  })
}
