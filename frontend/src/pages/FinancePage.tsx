import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import StatusChip from '../components/StatusChip'
import LineChart from '../components/finance/LineChart'
import Info from '../components/finance/Info'
import { Kpi, Kpis, type Tone } from '../components/finance/Kpi'
import { Verdict } from '../components/finance/Verdict'
import { Assumptions, type AssumptionRow } from '../components/finance/Assumptions'
import { FinToolbar } from '../components/finance/FinToolbar'
import { Scenarios } from '../components/finance/Scenarios'
import { Grid } from '../components/finance/Grid'
import { Tornado } from '../components/finance/Tornado'
import { CostBreakdown } from '../components/finance/CostBreakdown'
import { BreakEven } from '../components/finance/BreakEven'
import { Distribution } from '../components/finance/Distribution'
import { RotationCompare, type RotRow } from '../components/finance/RotationCompare'
import { Actions, type Action } from '../components/finance/Actions'
import { FarmCharts } from '../components/finance/FarmCharts'
import { findCell, useGrid } from '../lib/grid'
import { canonical, cropName, evaluate, useCellRot, useGridSoil, useRotIndex, type Soil } from '../components/fields/rotation/model'
import { cropFactors, marginSeries, predecessorIn, rotationSeries, summarize, useCellRots, type CropMoney, type Summary, type YearSeries } from '../lib/weatherMargin'
import { downloadCsv, type Cell } from '../lib/financeExport'
import { useField, type CropId, type FieldItem } from '../lib/field'
import { fmt } from '../lib/format'
import { useSoilDoc } from '../lib/soil'
import {
  YIELD_DEFAULT_YEARS, YIELD_RANGE_YEARS, compute, convertAmount, cropCalc, farmTotals, fieldRow, type FinSettings, fmtMoney, inCurrency, threeScenarios, marginGrid, tornado, breakEvenRows, useFinanceInputs, useFinSettings, type Currency, lastN, lossShare, median, percentile, rangeOf, validNonNeg, validPos, type FieldRow,
  type FinanceInputs, type FStatus, type Scenario,
} from '../lib/finance'
import './FinancePage.css'

type Str = Record<string, string>

interface FarmW { years: [number, number]; total: Summary; fields: Record<string, Summary> }
const parse = (s: string | undefined) => (s == null || s.trim() === '' ? null : Number(s))
// Headroom of the central value over its break-even: tile flag + "+18%" text.
const headroom = (v: number, be: number) => (be > 0 ? v / be - 1 : NaN)
const headTone = (h: number): Tone => (!Number.isFinite(h) ? 'todo' : h < 0 ? 'loss' : h < 0.2 ? 'warn' : 'ok')
const pct = (h: number) => (Number.isFinite(h) ? `${h >= 0 ? '+' : '−'}${Math.round(Math.abs(h) * 100)}%` : '-')
const H2 = ({ id, info, children }: { id: string; info?: string; children: React.ReactNode }) => <div className="fin-head-row"><h2 id={id}>{children}</h2>{info && <Info text={info} />}</div>

export default function FinancePage() {
  const { fields } = useField()
  if (fields.length === 0) {
    return (
      <section className="fin" aria-label="Finance">
        <div className="fin-empty" role="status">Finance needs at least one field. Add a field with its area and crop on the <Link to="/fields">Fields page</Link>.</div>
      </section>
    )
  }
  return <FinanceInner />
}

function FinanceInner() {
  const { fields, activeId } = useField()
  const [params, setParams] = useSearchParams()
  const fieldParam = params.get('field')
  const selId = fields.some((f) => f.id === fieldParam) ? fieldParam! : activeId
  const field = fields.find((f) => f.id === selId) ?? fields[0]
  const scope: 'all' | 'one' = params.get('scope') === 'one' || fields.some((f) => f.id === fieldParam) ? 'one' : params.get('scope') === 'all' ? 'all' : fields.length >= 2 ? 'all' : 'one'
  const setScope = (sc: 'all' | 'one') => setParams(sc === 'all' ? { scope: 'all' } : { scope: 'one', field: field.id }, { replace: true })
  const setSelId = (id: string) => setParams({ scope: 'one', field: id }, { replace: true })

  const load = useFinanceInputs()
  const [S, setS] = useFinSettings()
  const { cur, rateStr, spread, yieldStr, priceStr, costStr, areaMap, cropMap } = S
  const areaStr = areaMap[field.id] ?? ''
  const cropSel = cropMap[field.id] ?? ''
  const setAreaStr = (v: string) => setS({ areaMap: { ...areaMap, [field.id]: v } })
  const setCropSel = (v: string) => setS({ cropMap: { ...cropMap, [field.id]: v } })
  const setYieldStr = (m: Str) => setS({ yieldStr: m })
  const setPriceStr = (m: Str) => setS({ priceStr: m })
  const setCostStr = (m: Str) => setS({ costStr: m })
  const setRateStr = (v: string) => setS({ rateStr: v })
  const setSpread = (v: number) => setS({ spread: v })
  const [kOn, setKOn] = useState(false)
  const [pred, setPred] = useState('')

  const raw = load.state === 'ready' ? load.data : null
  const rateTyped = rateStr.trim() !== '' ? Number(rateStr) : null
  const rateErr = rateTyped != null && !validPos(rateTyped)
  const rate = rateTyped != null && !rateErr ? rateTyped : raw?.fx.uah_per_usd ?? NaN
  // Every price in the page comes from this view: the FAOSTAT column of the selected currency.
  const data = useMemo<FinanceInputs | null>(() => raw && inCurrency(raw, cur, rate), [raw, cur, rate])
  const switchCur = (next: Currency) => {
    if (next === cur) return
    if (validPos(rate)) {
      const conv = (m: Str) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.trim() !== '' && Number.isFinite(Number(v)) ? String(convertAmount(Number(v), next, rate)) : v]))
      setS({ cur: next, priceStr: conv(priceStr), costStr: conv(costStr) })
    } else setS({ cur: next })
  }
  const crop = cropSel || (data && field.crop && data.crops[field.crop] ? field.crop : '')
  const c = data && crop ? data.crops[crop] : null

  const areaRaw = areaStr.trim() !== '' ? Number(areaStr) : field.areaHa
  const areaErr = areaStr.trim() !== '' && !validPos(Number(areaStr))
  const area = validPos(areaRaw) && !areaErr ? areaRaw : null
  const areaEdited = areaStr.trim() !== '' && !(field.areaHa != null && Number(areaStr) === field.areaHa)
  const cropEdited = cropSel !== '' && cropSel !== (field.crop ?? '')
  const resetToField = () => {
    const drop = (m: Str) => { const n = { ...m }; delete n[field.id]; return n }
    setS({ areaMap: drop(areaMap), cropMap: drop(cropMap) })
  }

  // Defaults come only from the national series; the user overrides them.
  const defaults = useMemo(() => {
    if (!c) return null
    const recent = lastN(c.yields, YIELD_DEFAULT_YEARS)
    const range = lastN(c.yields, YIELD_RANGE_YEARS).map((p) => p.value)
    const lastPrice = c.prices[c.prices.length - 1]
    return {
      yieldMedian: median(recent.map((p) => p.value)), yieldFrom: recent[0].year, yieldTo: recent[recent.length - 1].year,
      low: percentile(range, 0.1), high: percentile(range, 0.9), rangeYears: range.length,
      price: lastPrice?.value ?? null, priceYear: lastPrice?.year ?? null,
    }
  }, [c])

  const pick = (m: Str, f: string, fallback: number | null) => (m[f] !== undefined && m[f].trim() !== '' ? Number(m[f]) : fallback)
  const yieldVal = crop && defaults ? pick(yieldStr, crop, defaults.yieldMedian) : null
  const priceVal = crop && defaults ? pick(priceStr, crop, defaults.price) : null
  const costRaw = crop ? parse(costStr[crop]) : null
  const yieldErr = yieldStr[crop] !== undefined && yieldStr[crop].trim() !== '' && !validPos(Number(yieldStr[crop]))
  const priceErr = priceStr[crop] !== undefined && priceStr[crop].trim() !== '' && !validPos(Number(priceStr[crop]))
  const costErr = costRaw != null && !validNonNeg(costRaw)
  const cost = costRaw != null && !costErr ? costRaw : costRaw == null ? c?.cost_default ?? null : null // typed cost, else the sample default
  const costIsDefault = costRaw == null && cost != null

  const kRow = useMemo(() => {
    if (!data || !crop || !kOn || !pred) return null
    const hit = data.k.find((r) => r.crop === crop && r.predecessor === pred)
    return hit ?? { crop, predecessor: pred, value: 1, source: 'No row in k_predecessor.csv for this pair; k = 1.0 by project rule.', status: 'estimate' as FStatus }
  }, [data, crop, kOn, pred])
  const k = kRow?.value ?? 1

  const ok = area != null && validPos(yieldVal) && validPos(priceVal) && !yieldErr && !priceErr && !costErr
  const scen: Scenario | null = ok ? { areaHa: area!, yieldTHa: yieldVal!, price: priceVal!, cost, k } : null
  const res = scen ? compute(scen) : null
  const rng = scen && defaults ? rangeOf(scen, { low: defaults.low, high: defaults.high }, spread / 100) : null
  const lossNat = scen && c ? lossShare(lastN(c.yields, YIELD_RANGE_YEARS).map((p) => p.value), scen) : null

  const uga = useMemo(() => {
    if (!data || !crop) return []
    const rows = data.uga.filter((r) => r.crop.startsWith(crop))
    const latest = rows.reduce((m, r) => (r.date > m ? r.date : m), '')
    return rows.filter((r) => r.date === latest)
  }, [data, crop])

  const idx = (n: number) => ({ '--i': n }) as React.CSSProperties
  const cropOptions = data ? Object.entries(data.crops) : []

  const soilLoad = useSoilDoc()
  const farmRows = data ? fields.map((f) => fieldRow(data, f, S, soilLoad.state === 'ready' ? soilLoad.data : null)) : []
  const T = farmTotals(farmRows)

  // ---- Stage 3 (estimate): margin per historical weather year, rotations compared, farm spread ----
  const gridLoad = useGrid()
  const gsoil = useGridSoil()
  const ridx = useRotIndex()
  const rotIndex = ridx.state === 'ready' ? ridx.data : null
  const gridDoc = gridLoad.state === 'ready' ? gridLoad.grid : null
  const cellOf = (f: FieldItem) => (gridDoc && f.lat != null && f.lon != null ? findCell(gridDoc, f.lat, f.lon)?.id ?? null : f.cellId)
  const soilOf = (f: FieldItem): Soil => {
    if (f.soil) return f.soil
    const auto = gsoil.state === 'ready' ? gsoil.data.cells.find((x) => x.id === cellOf(f))?.preset : null
    return auto ?? 'medium'
  }
  const fieldCellId = cellOf(field)
  const missingCell = !!(fieldCellId && rotIndex && !rotIndex.cells.includes(fieldCellId))
  const cellLoad = useCellRot(fieldCellId, !rotIndex || missingCell || scope !== 'one')
  const cellRot = cellLoad.state === 'ready' ? cellLoad.data : null
  const farmCells = useCellRots(scope === 'all' && rotIndex ? fields.map(cellOf).filter((id): id is string => !!id && rotIndex.cells.includes(id)) : [])

  const fac = cellRot && c && crop ? cropFactors(cellRot, soilOf(field), predecessorIn(field.rotation, crop), crop, c) : null
  const wm = fac && ok && yieldVal != null && priceVal != null ? marginSeries(fac, { y: yieldVal, p: priceVal, cost, k }) : null
  const wsum = wm ? summarize(wm.values) : null
  const wYears: [number, number] | null = wm ? [wm.years[0], wm.years[wm.years.length - 1]] : null
  const loss = wsum ? { losing: wsum.losing, total: wsum.n, weather: true } : lossNat ? { ...lossNat, weather: false } : null

  const moneyOf = (id: string, prev: string): CropMoney | null => {
    const cc = data?.crops[id]
    if (!data || !cc) return null
    const x = cropCalc(cc, 1, yieldStr[id], priceStr[id], costStr[id], spread)
    if (x.invalid || x.cost == null) return null
    const kr = kOn ? data.k.find((r) => r.crop === id && r.predecessor === prev) : null
    return { y: x.y, p: x.p, cost: x.cost, k: kr?.value ?? 1 }
  }
  const currentRot: string[] = field.rotation.length ? field.rotation : field.crop ? [field.crop] : []
  const rotRows: RotRow[] = []
  let rotYears: [number, number] | null = null
  if (scope === 'one' && data && cellRot && rotIndex && currentRot.length) {
    const ft = parse(costStr['black_fallow'])
    const fallowCost = ft != null && validNonNeg(ft) ? ft : null
    const cands = [{ key: 'cur', name: 'Your rotation', rot: currentRot, current: true }, ...rotIndex.candidates.filter((cd) => canonical(cd.crops) !== canonical(currentRot)).map((cd) => ({ key: cd.id, name: `${cd.id}. ${cd.name}`, rot: cd.crops, current: false }))]
    for (const cd of cands) {
      const rs = rotationSeries(cd.rot, cellRot, soilOf(field), data.crops, moneyOf, fallowCost)
      const sm = rs && summarize(rs.series.values)
      if (!rs || !sm) continue
      const ev = evaluate(cd.rot, rotIndex, cellRot, soilOf(field))
      rotYears ??= [rs.series.years[0], rs.series.years[rs.series.years.length - 1]]
      rotRows.push({ key: cd.key, name: cd.name, crops: cd.rot.map(cropName).join(' › '), current: cd.current, avg: sm.mean, cum: sm.mean * cd.rot.length, p10: sm.p10, losing: sm.losing, total: sm.n, fallowNoCost: rs.fallowNoCost, kmu: ev.ok ? ev.ev.returns.every((r) => r.norm == null || r.gap >= r.norm) : null })
    }
    rotRows.sort((a, b) => (a.current ? -1 : b.current ? 1 : b.avg - a.avg))
  }

  let farmW: FarmW | null = null
  if (scope === 'all' && data && rotIndex && T.mar) {
    const parts: { id: string; area: number; s: YearSeries }[] = []
    for (const r of T.ok) {
      const cid = cellOf(r.f), cell = cid ? farmCells.get(cid) : undefined, cc = data.crops[r.cropId]
      const f = cell && cc ? cropFactors(cell, soilOf(r.f), predecessorIn(r.f.rotation, r.cropId), r.cropId, cc) : null
      const sr = f && r.calc!.cost != null ? marginSeries(f, { y: r.calc!.y, p: r.calc!.p, cost: r.calc!.cost, k: 1 }) : null
      if (!sr) { parts.length = 0; break }
      parts.push({ id: r.f.id, area: r.area!, s: sr })
    }
    if (parts.length) {
      const years = parts[0].s.years.filter((y) => parts.every((p) => p.s.years.includes(y)))
      const total = years.length ? summarize(years.map((y) => parts.reduce((t, p) => t + p.area * p.s.values[p.s.years.indexOf(y)], 0))) : null
      if (total) farmW = { years: [years[0], years[years.length - 1]], total, fields: Object.fromEntries(parts.map((p) => [p.id, summarize(p.s.values.map((v) => v * p.area))!])) }
    }
  }

  const hasM = !!res && res.margin != null && !!rng?.marginPerHa
  const eff = yieldVal != null ? yieldVal * k : NaN
  const hY = res?.breakEvenYield != null ? headroom(eff, res.breakEvenYield) : NaN
  const hP = res?.breakEvenPrice != null && priceVal != null ? headroom(priceVal, res.breakEvenPrice) : NaN
  const varShare = c?.cost_var != null && c.cost_default ? c.cost_var / c.cost_default : null
  const grossPerHa = res && cost != null && varShare != null ? res.revenuePerHa - cost * varShare : null
  const costPerT = cost != null && eff > 0 ? cost / eff : null
  const yr = defaults ? { low: defaults.low, high: defaults.high } : null
  const cols = scen && yr ? threeScenarios(scen, yr, spread / 100) : null
  const grid = scen && yr ? marginGrid(scen, yr, spread / 100) : null
  const torn = scen ? tornado(scen) : null
  const beIds = [...new Set([crop, ...field.rotation].filter((id) => id && data?.crops[id]))] as string[]
  const cmp = (low: number, high: number) => `${fmtMoney(low)} to ${fmtMoney(high)}`

  // One list of inputs with year, status and source: shown in the Assumptions block and written to the CSV.
  const assumptionRows: AssumptionRow[] = []
  if (data && raw) {
    const fxTyped = rateTyped != null && !rateErr
    if (scope === 'one' && c && defaults) {
      const yTyped = (yieldStr[crop] ?? '').trim() !== '', pTyped = (priceStr[crop] ?? '').trim() !== ''
      assumptionRows.push(
        { name: 'Yield', value: yieldVal != null ? `${fmt(yieldVal, 2)} t/ha` : '-', year: yTyped ? undefined : `${defaults.yieldFrom}-${defaults.yieldTo}`, status: yTyped ? 'estimate' : c.yield_status, source: yTyped ? 'Entered by you' : c.yield_source },
        { name: 'Price', value: priceVal != null ? `${fmtMoney(priceVal)} ${cur}/t` : '-', year: pTyped ? undefined : String(defaults.priceYear ?? ''), status: pTyped ? 'estimate' : c.price_status, source: pTyped ? 'Entered by you' : c.price_source ?? '' },
        { name: 'Cost', value: cost != null ? `${fmtMoney(cost)} ${cur}/ha` : '-', status: cost == null ? 'todo' : costIsDefault ? 'sample' : 'estimate', source: costIsDefault ? c.cost_items_source ?? data.notes.missing : 'Entered by you' },
        { name: 'Yield range', value: `${fmt(defaults.low, 2)}-${fmt(defaults.high, 2)} t/ha`, year: `last ${defaults.rangeYears} y`, status: c.yield_status, source: 'FAOSTAT 10th-90th percentile, raw' },
        { name: 'Price range', value: `±${spread}%`, status: 'estimate', source: 'Your assumption; not derived from data' },
      )
      if (kRow) assumptionRows.push({ name: 'Predecessor k', value: fmt(kRow.value, 2), status: kRow.status, source: kRow.source })
    } else {
      assumptionRows.push(
        { name: 'Yield', value: 'per crop', status: 'data', source: data.notes.yields },
        { name: 'Price', value: 'per crop', status: 'data', source: data.notes.prices },
        { name: 'Cost', value: 'per crop', status: 'sample', source: data.notes.missing },
        { name: 'Price range', value: `±${spread}%`, status: 'estimate', source: 'Your assumption; not derived from data' },
      )
    }
    const wy = wYears ?? farmW?.years
    if (wy) assumptionRows.push({ name: 'Weather years', value: `${wy[0]}-${wy[1]}`, status: 'estimate', source: 'NASA POWER water balance (mean Ks, mid-season) ranks the years; national FAOSTAT yield spread sets the size (quantile mapping). Heat, frost, pests and the war are not in it.' })
    assumptionRows.push({ name: 'Exchange rate', value: `${fmt(rate, 2)} UAH/USD`, year: fxTyped ? undefined : String(raw.fx.year), status: fxTyped ? 'estimate' : raw.fx.status, source: raw.fx.source })
  }

  const canExport = scope === 'one' ? !!res : T.counted > 0
  const exportCsv = () => {
    const out: Cell[][] = []
    if (scope === 'one' && res && rng && area != null) {
      out.push(['Field', field.name], ['Crop', c?.label ?? ''], ['Currency', cur], [], ['Metric', 'Central', 'Low', 'High', 'Unit'])
      out.push(['Revenue per ha', res.revenuePerHa, rng.revenuePerHa.low, rng.revenuePerHa.high, `${cur}/ha`])
      out.push([`Revenue, ${area} ha`, res.revenue, rng.revenuePerHa.low * area, rng.revenuePerHa.high * area, cur])
      if (res.marginPerHa != null && rng.marginPerHa) {
        out.push(['Margin per ha', res.marginPerHa, rng.marginPerHa.low, rng.marginPerHa.high, `${cur}/ha`])
        out.push([`Margin, ${area} ha`, res.margin, rng.marginPerHa.low * area, rng.marginPerHa.high * area, cur])
        out.push(['Break-even yield', res.breakEvenYield, null, null, 't/ha'], ['Break-even price', res.breakEvenPrice, null, null, `${cur}/t`])
      }
      if (wsum) out.push(['Margin per ha, weather years', wsum.p50, wsum.p10, wsum.p90, `${cur}/ha, P50 / P10 / P90`])
      if (loss) out.push(['Loss years', loss.losing, null, null, `of ${loss.total}${loss.weather ? ' weather years' : ' national yields'}`])
    } else {
      out.push(['Currency', cur], [], ['Field', 'Crop', 'Area, ha', 'Yield, t/ha', `Price, ${cur}/t`, `Cost, ${cur}/ha`, `Revenue low, ${cur}`, `Revenue central, ${cur}`, `Revenue high, ${cur}`, `Margin low, ${cur}`, `Margin central, ${cur}`, `Margin high, ${cur}`])
      for (const r of farmRows) {
        const x = r.calc
        out.push(!x || x.invalid ? [r.f.name, r.cropLabel, r.area, 'incomplete'] : [r.f.name, r.cropLabel, r.area, x.y, x.p, x.cost, x.revLow, x.rev, x.revHigh, x.marLow, x.margin, x.marHigh])
      }
      if (farmW) out.push(['Weather years P10 / P50 / P90, farm margin', null, null, null, null, null, null, null, null, farmW.total.p10, farmW.total.p50, farmW.total.p90])
      out.push(['Total', `${T.counted} of ${T.total} fields`, T.area, null, null, null, T.rev.low, T.rev.mid, T.rev.high, T.mar?.low ?? null, T.mar?.mid ?? null, T.mar?.high ?? null])
    }
    out.push([], ['Input', 'Value', 'Year', 'Status', 'Source'])
    for (const a of assumptionRows) out.push([a.name, a.value, a.year ?? '', a.status, a.source])
    downloadCsv(`field-shift-finance-${scope === 'one' ? 'field' : 'farm'}.csv`, out)
  }

  const actions: Action[] = []
  if (scope === 'one') {
    const curRow = rotRows.find((r) => r.current), best = rotRows.filter((r) => !r.current)[0]
    if (curRow && best && best.avg - curRow.avg > 0.1 * Math.max(Math.abs(curRow.avg), 1)) actions.push({ tone: 'ok', text: `Rotation ${best.key}: +${fmtMoney(best.avg - curRow.avg)} ${cur}/ha/yr` })
    if (curRow && curRow.kmu === false) actions.push({ tone: 'warn', text: 'Your rotation breaks KMU 164' })
    if (hasM && (hY < 0 || hP < 0)) actions.push({ tone: 'loss', text: 'Below break-even at your inputs' })
    if (costIsDefault) actions.push({ tone: 'warn', text: 'Enter your own cost', href: '#fin-cost' })
  } else if (T.ok.length > 0) {
    const withM = T.ok.filter((r) => r.calc!.margin != null)
    const low = [...withM].sort((a, b) => a.calc!.margin! / a.area! - b.calc!.margin! / b.area!)[0]
    if (withM.length > 1 && low) actions.push({ tone: 'warn', text: `${low.f.name}: lowest margin per ha` })
    for (const r of T.ok) { const w = farmW?.fields[r.f.id]; if (w && w.losing / w.n > 0.25) actions.push({ tone: 'loss', text: `${r.f.name}: loss in ${w.losing} of ${w.n} years` }) }
    if (T.ok.some((r) => r.calc!.costDefault)) actions.push({ tone: 'warn', text: 'Enter your own costs', href: '#fin-crops' })
  }

  return (
    <div className="fin">
      <header className="fin-head reveal" style={idx(0)}>
        <div>
          <p className="fin-eyebrow">Income estimate</p>
          <h1>Finance</h1>
        </div>
      </header>

      {load.state === 'loading' && <div className="fin-card" aria-busy="true"><p className="fin-muted">Loading inputs…</p></div>}
      {load.state === 'error' && (
        <div className="fin-card" role="alert">
          <p className="fin-error">Could not load <code>/data/finance_inputs.json</code>.</p>
          <p className="fin-muted">Run <code>python -m pipeline.export_finance</code> in backend.</p>
        </div>
      )}

      {data && raw && (
        <>
          <FinToolbar scope={scope} setScope={setScope} fields={fields} fieldId={field.id} setField={setSelId}
            cur={cur} setCur={switchCur} fx={rate} fxStatus={raw.fx.status} fxSource={raw.fx.source}
            rateStr={rateStr} rateErr={rateErr} setRateStr={setRateStr}
            onPrint={() => window.print()} onCsv={exportCsv} canExport={canExport} />

          {scope === 'all' && <Farm cur={cur} data={data} rows={farmRows} T={T} S={S} setS={setS} onOpen={(id) => setSelId(id)} W={farmW} actions={actions} />}

          {scope === 'one' && (<>
            {c && defaults && res && rng && area != null ? (<>
              <Verdict
                label={hasM ? `Margin, ${fmt(area, 1)} ha` : `Revenue, ${fmt(area, 1)} ha`}
                value={fmtMoney(hasM ? res.margin! : res.revenue)} cur={cur}
                range={hasM ? (wsum ? cmp(wsum.p10 * area, wsum.p90 * area) : cmp(rng.marginPerHa!.low * area, rng.marginPerHa!.high * area)) : cmp(rng.revenuePerHa.low * area, rng.revenuePerHa.high * area)}
                tone={!hasM ? 'todo' : res.margin! < 0 ? 'loss' : loss && loss.losing > 0 ? 'warn' : 'ok'}
                take={!hasM ? <a href="#fin-cost">Add cost for margin</a> : loss ? (loss.losing === 0 ? `Profit in all ${loss.total} years` : `Loss in ${loss.losing} of ${loss.total} years`) : ''} />
              <Actions items={actions} />
              <Kpis>
                <Kpi label="Gross margin per ha" info="Revenue minus variable cost (seed, fertilizer, protection, fuel, labour). Uses the sample cost split; a typed cost keeps the same split."
                  value={grossPerHa != null ? `${fmtMoney(grossPerHa)} ${cur}` : '-'} tone={grossPerHa == null ? 'todo' : grossPerHa < 0 ? 'loss' : 'ok'} sub={grossPerHa == null ? 'No cost split' : undefined} />
                <Kpi label="Net margin per ha" info={wsum ? 'Revenue minus all cost. Range: 10th to 90th percentile over the weather years (estimate).' : `Revenue minus all cost. Range: low and high yield (10th-90th percentile, last ${defaults.rangeYears} years, raw) with price ±${spread}%.`}
                  value={hasM ? `${fmtMoney(res.marginPerHa!)} ${cur}` : '-'} tone={!hasM ? 'todo' : res.marginPerHa! < 0 ? 'loss' : 'ok'}
                  sub={hasM ? (wsum ? cmp(wsum.p10, wsum.p90) : cmp(rng.marginPerHa!.low, rng.marginPerHa!.high)) : 'No cost'} />
                <Kpi label="Cost per t" info="Total cost per ha divided by your yield."
                  value={costPerT != null ? `${fmtMoney(costPerT)} ${cur}` : '-'} tone={costPerT == null || priceVal == null ? 'todo' : costPerT > priceVal ? 'loss' : 'ok'} sub={priceVal != null ? `price ${fmtMoney(priceVal)}` : undefined} />
                <Kpi label="Break-even yield" info="Yield where margin is 0 at your price. Sub-line: your yield above or below it."
                  value={hasM ? `${fmt(res.breakEvenYield!, 2)} t/ha` : '-'} tone={hasM ? headTone(hY) : 'todo'} sub={hasM ? `${pct(hY)} vs yield` : 'No cost'} />
                <Kpi label="Break-even price" info="Price where margin is 0 at your yield. Sub-line: your price above or below it."
                  value={hasM ? `${fmtMoney(res.breakEvenPrice!)} ${cur}/t` : '-'} tone={hasM ? headTone(hP) : 'todo'} sub={hasM ? `${pct(hP)} vs price` : 'No cost'} />
                <Kpi label="Loss years" info="Years with a negative margin at your price and cost: weather years of this cell when available, else the last national yields."
                  value={loss ? `${loss.losing} of ${loss.total}` : '-'} tone={!loss ? 'todo' : loss.losing === 0 ? 'ok' : loss.losing / loss.total <= 0.25 ? 'warn' : 'loss'} sub={loss ? (loss.weather ? 'weather years' : `last ${loss.total} years`) : 'No cost'} />
              </Kpis>

              {cols && <Scenarios cols={cols} cur={cur} area={area} info={`Bad: low yield (10th percentile of FAOSTAT, last ${defaults.rangeYears} years) and price −${spread}%. Good: high yield (90th) and price +${spread}%. Base: ${fmt(yieldVal!, 2)} t/ha${k !== 1 ? ` × k ${fmt(k, 2)}` : ''} at ${fmtMoney(priceVal!)} ${cur}/t.`} />}
              <div className="fin-pair">
                {grid && <Grid g={grid} cur={cur} info="Rows: yield from low to high. Columns: price around yours. Loss cells show a minus. Centre = your base." />}
                {torn && <Tornado base={torn.base} rows={torn.rows} cur={cur} info="Margin per ha when one driver moves ±10% and the rest stay. Longest bar = biggest lever." />}
              </div>
              {costIsDefault && c.cost_items && c.cost_items.length > 0 && <CostBreakdown items={c.cost_items} cur={cur} rate={rate} source={c.cost_items_source ?? ''} />}
              {wm && wsum && wYears && <Distribution values={wm.values} years={wYears} s={wsum} unit={`${cur}/ha`} title="Margin by weather year" info="One value per weather year at your yield, price and cost. Which years are bad comes from this cell's NASA POWER water balance; how bad comes from the national yield record. An estimate, not a forecast." />}
              {!wsum && hasM && cellLoad.state !== 'loading' && <p className="fin-muted fin-noprint">No weather years: set coordinates on the <Link to="/fields">Fields page</Link>.</p>}
              {rotRows.length > 1 && rotYears && <RotationCompare rows={rotRows} cur={cur} years={rotYears} idx={4} />}
            </>) : (
              <div className="fin-empty" role="status">{c ? `Fix the highlighted inputs${area == null ? ' and enter an area' : ''}.` : <>Pick a crop and area, or add a field on the <Link to="/fields">Fields page</Link>.</>}</div>
            )}

            <section className="fin-card reveal" style={idx(4)} aria-labelledby="fin-in">
              <H2 id="fin-in" info="Area and crop come from the Fields page. Edit here for this report only.">Field</H2>
              <div className="fin-form">
                <label className="fin-field">
                  <span>Area, ha</span>
                  <input type="number" inputMode="decimal" min="0" step="any" value={areaStr} placeholder={field.areaHa != null ? String(Math.round(field.areaHa * 100) / 100) : 'enter area'}
                    onChange={(e) => setAreaStr(e.target.value)} aria-invalid={areaErr} aria-describedby="h-area" />
                  <span className="fin-hint" id="h-area">{areaErr ? <em className="fin-error">Above 0</em> : areaEdited ? 'edited' : field.areaHa != null ? 'Fields page' : 'not set'}</span>
                </label>
                <label className="fin-field">
                  <span>Crop</span>
                  <select value={crop} onChange={(e) => setCropSel(e.target.value)} aria-describedby="h-crop">
                    <option value="" disabled>choose a crop</option>
                    {cropOptions.map(([id, v]) => <option key={id} value={id}>{v.label}</option>)}
                  </select>
                  <span className="fin-hint" id="h-crop">{cropEdited ? 'edited' : field.crop ? 'Fields page' : 'not set'}</span>
                </label>
              </div>
              <div className="fin-reset">
                <button type="button" className="fin-btn" disabled={!areaEdited && !cropEdited} onClick={resetToField} title="Restore area and crop from the Fields page">Reset</button>
                {field.crop === 'black_fallow' && !cropSel && <span className="fin-hint">Black fallow: no crop revenue</span>}
              </div>
            </section>

            {c && defaults && (<>
              <section className="fin-card reveal" style={idx(5)} aria-labelledby="fin-par">
                <H2 id="fin-par" info="Yield, price and cost are per crop and shared by every field with this crop.">Inputs: {c.label}</H2>
                <div className="fin-form">
                  <label className="fin-field">
                    <span>Yield, t/ha</span>
                    <input type="number" inputMode="decimal" min="0" step="any" value={yieldStr[crop] ?? ''} placeholder={fmt(defaults.yieldMedian, 2)}
                      onChange={(e) => setYieldStr({ ...yieldStr, [crop]: e.target.value })} aria-invalid={yieldErr} />
                    {yieldErr ? <em className="fin-error">Above 0</em> : <small>Median {defaults.yieldFrom}-{defaults.yieldTo} <StatusChip status={c.yield_status} source={c.yield_source} /></small>}
                    {c.psd.length > 0 && <small>USDA {c.psd.map((p) => `${p.year} ${fmt(p.value, 2)}${p.status === 'estimate' ? '*' : ''}`).join(', ')} <StatusChip status={c.psd[0].status} source={c.psd[0].source} /></small>}
                  </label>
                  <label className="fin-field">
                    <span>Price, {cur}/t</span>
                    <input type="number" inputMode="decimal" min="0" step="any" value={priceStr[crop] ?? ''} placeholder={defaults.price != null ? fmtMoney(defaults.price) : 'enter your price'}
                      onChange={(e) => setPriceStr({ ...priceStr, [crop]: e.target.value })} aria-invalid={priceErr} />
                    {priceErr ? <em className="fin-error">Above 0</em> : <small>{defaults.priceYear}, nominal <StatusChip status={c.price_status} source={c.price_source ?? undefined} /></small>}
                  </label>
                  <label className="fin-field">
                    <span>Cost, {cur}/ha</span>
                    <input id="fin-cost" type="number" inputMode="decimal" min="0" step="any" value={costStr[crop] ?? ''} placeholder={c.cost_default != null ? fmtMoney(c.cost_default) : 'enter your own'}
                      onChange={(e) => setCostStr({ ...costStr, [crop]: e.target.value })} aria-invalid={costErr} />
                    {costErr ? <em className="fin-error">Not negative</em> : <small>{costIsDefault ? 'Default' : 'Yours'} <StatusChip status={cost == null ? 'todo' : costIsDefault ? 'sample' : 'estimate'} source={costIsDefault ? c.cost_items_source ?? '' : 'Entered by you; no open source for costs per hectare'} /></small>}
                  </label>
                  <label className="fin-field">
                    <span>Price range, ± {spread}%</span>
                    <input type="range" min="0" max="50" step="5" value={spread} onChange={(e) => setSpread(Number(e.target.value))} aria-label="Price range, plus or minus percent" />
                    <small>Your assumption <StatusChip status="estimate" source="User-set sensitivity; the default 20% is not derived from data" /></small>
                  </label>
                </div>

                <div className="fin-k">
                  <label className="fin-check">
                    <input type="checkbox" checked={kOn} onChange={(e) => { setKOn(e.target.checked); if (!pred) setPred(data.k.find((r) => r.crop === crop)?.predecessor ?? '') }} />
                    <span>Predecessor effect k <Info text="Multiplies yield for money only. Not combined with the water-balance risk." /></span>
                  </label>
                  {kOn && (
                    <div className="fin-k-body">
                      <label className="fin-field">
                        <span>Previous crop</span>
                        <select value={pred} onChange={(e) => setPred(e.target.value)}>
                          <option value="" disabled>choose previous crop</option>
                          {Object.entries({ winter_wheat: 'Winter wheat', maize: 'Maize', sunflower: 'Sunflower', pea: 'Pea', black_fallow: 'Black fallow' }).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
                        </select>
                      </label>
                      {kRow && <p>k = <b>{fmt(kRow.value, 2)}</b> <StatusChip status={kRow.status} source={kRow.source} /></p>}
                    </div>
                  )}
                </div>
              </section>

              <section className="fin-card reveal" style={idx(5)} aria-labelledby="fin-mkt">
                <H2 id="fin-mkt" info="National FAOSTAT and UGA export prices, not local farm-gate. Prices are nominal: the rise is mostly inflation and the exchange rate. Last year available is 2023.">Market: national</H2>
                <h3>Producer price, {cur}/t <StatusChip status={c.price_status} source={c.price_source ?? undefined} /></h3>
                <LineChart points={c.prices} unit={`${cur}/t`} label={`National producer price of ${c.label}, ${cur} per tonne, nominal, ${c.prices[0]?.year} to ${c.prices[c.prices.length - 1]?.year}`}
                  marker={priceVal ? { value: priceVal, label: 'your price' } : null} />
                <h3>Yield, t/ha <StatusChip status={c.yield_status} source={c.yield_source} /> <Info text={`Filled dots: the last ${YIELD_RANGE_YEARS} years used for the range.`} /></h3>
                <LineChart points={c.yields} unit="t/ha" digits={1} highlightFrom={c.yields[c.yields.length - YIELD_RANGE_YEARS]?.year}
                  label={`National yield of ${c.label}, tonnes per hectare, ${c.yields[0].year} to ${c.yields[c.yields.length - 1].year}`} />
                <h3>Export, UGA Index <Info text="CPT Black Sea export prices, latest days only: a different basis from farm-gate. UAH uses the exchange rate in the toolbar." /></h3>
                {uga.length ? (
                  <div className="fin-table-wrap">
                    <table>
                      <caption className="sr-only">Latest UGA Index export prices</caption>
                      <thead><tr><th scope="col">Date</th><th scope="col">Item</th><th scope="col" className="fin-num">USD/t</th><th scope="col" className="fin-num">UAH/t</th><th scope="col">Status</th></tr></thead>
                      <tbody>{uga.map((r) => (
                        <tr key={r.item}><td>{r.date}</td><th scope="row">{r.item}</th><td className="fin-num">{fmt(r.usd_per_t)}</td><td className="fin-num">{validPos(rate) ? fmt(r.usd_per_t * rate) : 'n/a'}</td><td><StatusChip status={r.status} source={r.source} /></td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                ) : <p className="fin-muted">No UGA price for this crop.</p>}
              </section>
            </>)}

            {field.rotation.length > 0 && (
              <Rotation cur={cur} name={field.name} data={data} rotation={field.rotation} kOn={kOn} yieldStr={yieldStr} priceStr={priceStr} costStr={costStr}
                setCost={(id, v) => setCostStr({ ...costStr, [id]: v })} area={area} idx={idx} />
            )}
            <BreakEven rows={breakEvenRows(data, beIds, S)} cur={cur} idx={6} />
          </>)}

          <Assumptions rows={assumptionRows} />
        </>
      )}
    </div>
  )
}

interface RotProps {
  cur: Currency
  data: FinanceInputs; rotation: CropId[]; kOn: boolean; yieldStr: Str; priceStr: Str; costStr: Str
  name: string; setCost: (id: string, v: string) => void; area: number | null; idx: (n: number) => React.CSSProperties
}

function Rotation({ cur, name, data, rotation, kOn, yieldStr, priceStr, costStr, setCost, area, idx }: RotProps) {
  const rows = rotation.map((id, i) => {
    const prev = rotation[(i - 1 + rotation.length) % rotation.length]
    const c = data.crops[id]
    if (!c) return { id, i, label: id === 'black_fallow' ? 'Black fallow' : id, revenue: 0, cost: parse(costStr[id]), isDef: false, noRevenue: true, k: 1, kStatus: null as FStatus | null }
    const recent = lastN(c.yields, YIELD_DEFAULT_YEARS).map((p) => p.value)
    const y = parse(yieldStr[id]) ?? median(recent)
    const p = parse(priceStr[id]) ?? c.prices[c.prices.length - 1]?.value ?? NaN
    const kr = kOn ? data.k.find((r) => r.crop === id && r.predecessor === prev) : null
    const k = kr?.value ?? 1
    return { id, i, label: c.label, revenue: y * k * p, cost: parse(costStr[id]) ?? c.cost_default ?? null, isDef: parse(costStr[id]) == null && c.cost_default != null, noRevenue: false, k, kStatus: kOn ? (kr?.status ?? 'estimate') : null, prev }
  })
  const allCost = rows.every((r) => r.cost != null && validNonNeg(r.cost))
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0)
  const totalCost = allCost ? rows.reduce((s, r) => s + (r.cost as number), 0) : null
  return (
    <section className="fin-card reveal" style={idx(5)} aria-labelledby="fin-rot">
      <H2 id="fin-rot" info={`Rotation of ${name}. Each crop uses its own yield and price. Money only, no agronomic claim.`}>Rotation, per ha per year</H2>
      <div className="fin-table-wrap">
        <table>
          <caption className="sr-only">Revenue per hectare for each year of the rotation</caption>
          <thead><tr><th scope="col">Year</th><th scope="col">Crop</th><th scope="col" className="fin-num">Revenue, {cur}/ha</th><th scope="col">Cost, {cur}/ha</th><th scope="col" className="fin-num">Margin, {cur}/ha</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const bad = r.cost != null && !validNonNeg(r.cost)
              return (
                <tr key={r.i}>
                  <td>{r.i + 1}</td>
                  <th scope="row">{r.label}{r.kStatus && r.k !== 1 && <> <small>k {fmt(r.k, 2)}</small> <StatusChip status={r.kStatus} /></>}</th>
                  <td className="fin-num">{r.noRevenue ? '0' : Number.isFinite(r.revenue) ? fmtMoney(r.revenue) : 'n/a'}</td>
                  <td>
                    <input className="fin-cell" type="number" min="0" step="any" value={costStr[r.id] ?? ''} placeholder={r.isDef && r.cost != null ? fmtMoney(r.cost) : 'enter your own'} aria-label={`Cost per hectare, year ${r.i + 1} ${r.label}`}
                      aria-invalid={bad} onChange={(e) => setCost(r.id, e.target.value)} />
                  </td>
                  <td className="fin-num">{r.cost != null && !bad ? <>{fmtMoney(r.revenue - r.cost)}{r.isDef && <> <StatusChip status="sample" source="Sample cost, not a real source" /></>}</> : <StatusChip status="todo" />}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>Average per year</th>
              <td className="fin-num">{fmtMoney(totalRev / rows.length)}</td>
              <td />
              <td className="fin-num">{totalCost != null ? fmtMoney((totalRev - totalCost) / rows.length) : '-'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {area != null && <p className="fin-muted">{fmt(area, 1)} ha: about {fmtMoney((totalRev / rows.length) * area)} {cur} revenue per year</p>}
    </section>
  )
}

interface FarmProps { cur: Currency; data: FinanceInputs; rows: FieldRow[]; T: ReturnType<typeof farmTotals>; S: FinSettings; setS: (p: Partial<FinSettings>) => void; onOpen: (id: string) => void; W: FarmW | null; actions: Action[] }

// One row per field. Inputs are per crop (shared). k is not applied here: it depends on the previous crop of each field.
function Farm({ cur, data, rows, T, S, setS, onOpen, W, actions }: FarmProps) {
  const skipped = T.total - T.counted
  const usedCrops = [...new Set(rows.filter((r) => r.cropId && data.crops[r.cropId]).map((r) => r.cropId))]
  const set = (key: 'yieldStr' | 'priceStr' | 'costStr', id: string, v: string) => setS({ [key]: { ...S[key], [id]: v } })
  const cmp = (low: number, high: number) => `${fmtMoney(low)} to ${fmtMoney(high)}`
  const idx = (n: number) => ({ '--i': n }) as React.CSSProperties
  const hasM = !!T.mar
  const tone: Tone = !T.counted || !hasM ? 'todo' : T.mar!.mid < 0 ? 'loss' : W ? (W.total.losing > 0 ? 'warn' : 'ok') : T.mar!.low < 0 ? 'warn' : 'ok'
  const share = Object.values(T.ok.reduce<Record<string, { label: string; value: number }>>((a, r) => { (a[r.cropId] ??= { label: r.cropLabel ?? r.cropId, value: 0 }).value += r.calc!.rev; return a }, {}))
  const bars = T.ok.map((r) => {
    const c = r.calc!, w = W?.fields[r.f.id]
    return w ? { name: r.f.name, low: w.p10, mid: w.p50, high: w.p90 } : c.margin != null ? { name: r.f.name, low: c.marLow!, mid: c.margin, high: c.marHigh! } : { name: r.f.name, low: c.revLow, mid: c.rev, high: c.revHigh }
  })
  return (
    <>
      {T.counted > 0 ? (<>
        <Verdict
          label={hasM ? 'Margin, farm' : 'Revenue, farm'} value={fmtMoney(hasM ? T.mar!.mid : T.rev.mid)} cur={cur}
          range={hasM ? (W ? cmp(W.total.p10, W.total.p90) : cmp(T.mar!.low, T.mar!.high)) : cmp(T.rev.low, T.rev.high)} tone={tone}
          take={!hasM ? <a href="#fin-crops">Add costs for margin</a> : W ? (W.total.losing === 0 ? `Profit in all ${W.total.n} years` : `Loss in ${W.total.losing} of ${W.total.n} years`) : T.mar!.mid < 0 ? 'Loss at central yield' : T.mar!.low < 0 ? 'Loss possible at low yield' : 'Profit across the range'} />
        <Actions items={actions} />
        <Kpis>
          <Kpi label="Margin per ha" value={hasM ? `${fmtMoney(T.mar!.mid / T.area)} ${cur}` : '-'} tone={!hasM ? 'todo' : T.mar!.mid < 0 ? 'loss' : 'ok'} sub={hasM ? (W ? cmp(W.total.p10 / T.area, W.total.p90 / T.area) : cmp(T.mar!.low / T.area, T.mar!.high / T.area)) : 'No cost'}
            info="Farm total divided by counted area." />
          <Kpi label="Revenue" value={`${fmtMoney(T.rev.mid)} ${cur}`} tone="ok" sub={cmp(T.rev.low, T.rev.high)} />
          <Kpi label="Area" value={`${fmt(T.area, 1)} ha`} tone="ok" />
          <Kpi label="Fields counted" value={`${T.counted} of ${T.total}`} tone={skipped > 0 ? 'warn' : 'ok'} sub={skipped > 0 ? `${skipped} incomplete` : undefined} />
        </Kpis>
        <FarmCharts share={share} fields={bars} cur={cur} weather={!!W} idx={3} />
      </>) : (
        <div className="fin-empty" role="status">No complete field. Add crop and area on the <Link to="/fields">Fields page</Link>.</div>
      )}

      <section className="fin-card reveal" style={idx(3)} aria-labelledby="fin-farm">
        <H2 id="fin-farm" info={`Range: 10th-90th percentile of national yields (last ${YIELD_RANGE_YEARS} years), price ±${S.spread}%. Predecessor k not applied. Incomplete fields are left out. ${W ? `Farm range: P10 to P90 of the farm total over the ${W.total.n} weather years (estimate), so fields share the same weather.` : 'Summed ranges add every field\'s low and high, so they are wider than a realistic farm spread.'}`}>Fields</H2>
        <div className="fin-table-wrap">
          <table className="fin-farm-table">
            <caption className="sr-only">Revenue and margin by field</caption>
            <thead><tr><th scope="col">Field</th><th scope="col">Crop</th><th scope="col" className="fin-num">Area, ha</th><th scope="col" className="fin-num">Yield, t/ha</th><th scope="col" className="fin-num">Price, {cur}/t</th><th scope="col" className="fin-num">Cost, {cur}/ha</th><th scope="col" className="fin-num">Revenue, {cur}</th><th scope="col" className="fin-num">Margin, {cur}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.f.id}>
                  <th scope="row"><button type="button" className="fin-link" onClick={() => onOpen(r.f.id)}>{r.f.name}</button></th>
                  <td>{r.cropLabel ?? '-'}</td>
                  {!r.calc || r.calc.invalid ? (
                    <td colSpan={6}><span className="fin-incomplete">{r.calc?.invalid ? 'Incomplete: invalid inputs' : `Incomplete: ${r.area == null ? 'no area' : ''}${r.area == null && !r.cropLabel ? ' and ' : ''}${!r.cropLabel ? 'no crop' : ''}`}</span></td>
                  ) : (<>
                    <td className="fin-num">{fmt(r.area!, 1)}</td>
                    <td className="fin-num">{fmt(r.calc.y, 2)}</td>
                    <td className="fin-num">{fmtMoney(r.calc.p)}</td>
                    <td className="fin-num">{r.calc.cost != null ? <>{fmtMoney(r.calc.cost)}{r.calc.costDefault && <> <StatusChip status="sample" source="Sample cost, not a real source" /></>}</> : <StatusChip status="todo" source="Enter your own cost in the inputs below" />}</td>
                    <td className="fin-num">{fmtMoney(r.calc.revLow)} to {fmtMoney(r.calc.revHigh)}<br /><small>central {fmtMoney(r.calc.rev)}</small></td>
                    <td className="fin-num">{r.calc.margin != null ? <>{fmtMoney(r.calc.marLow!)} to {fmtMoney(r.calc.marHigh!)}<br /><small>central {fmtMoney(r.calc.margin)}</small></> : '-'}</td>
                  </>)}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>Total ({T.counted} of {T.total})</th>
                <td className="fin-num">{fmt(T.area, 1)}</td>
                <td colSpan={3} />
                <td className="fin-num">{T.counted ? <>{fmtMoney(T.rev.low)} to {fmtMoney(T.rev.high)}<br /><small>central {fmtMoney(T.rev.mid)}</small></> : '-'}</td>
                <td className="fin-num">{T.mar ? <>{fmtMoney(T.mar.low)} to {fmtMoney(T.mar.high)}<br /><small>central {fmtMoney(T.mar.mid)}</small></> : '-'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <BreakEven rows={breakEvenRows(data, usedCrops, S)} cur={cur} idx={4} />

      <section className="fin-card reveal" style={idx(5)} aria-labelledby="fin-crops">
        <H2 id="fin-crops" info={`Leave yield and price empty to use defaults (FAOSTAT national, nominal, last year 2023). Default cost is a sample: enter your own. Yield: median of the last ${YIELD_DEFAULT_YEARS} years.`}>Inputs per crop</H2>
        {usedCrops.length === 0 ? <p className="fin-muted">No field has a crop yet. Add crops on the <Link to="/fields">Fields page</Link>.</p> : (
          <div className="fin-table-wrap">
            <table className="fin-farm-table">
              <caption className="sr-only">Yield, price and cost per crop</caption>
              <thead><tr><th scope="col">Crop</th><th scope="col">Yield, t/ha</th><th scope="col">Price, {cur}/t</th><th scope="col">Cost, {cur}/ha</th></tr></thead>
              <tbody>
                {usedCrops.map((id) => {
                  const c = data.crops[id]
                  const dy = median(lastN(c.yields, YIELD_DEFAULT_YEARS).map((p) => p.value))
                  const dp = c.prices[c.prices.length - 1]?.value
                  return (
                    <tr key={id}>
                      <th scope="row">{c.label}</th>
                      <td><input className="fin-cell" type="number" min="0" step="any" value={S.yieldStr[id] ?? ''} placeholder={fmt(dy, 2)} aria-label={`Yield for ${c.label}, t per ha`} aria-invalid={S.yieldStr[id] != null && S.yieldStr[id].trim() !== '' && !validPos(Number(S.yieldStr[id]))} onChange={(e) => set('yieldStr', id, e.target.value)} /></td>
                      <td><input className="fin-cell" type="number" min="0" step="any" value={S.priceStr[id] ?? ''} placeholder={dp != null ? fmtMoney(dp) : 'enter price'} aria-label={`Price for ${c.label}, ${cur} per t`} aria-invalid={S.priceStr[id] != null && S.priceStr[id].trim() !== '' && !validPos(Number(S.priceStr[id]))} onChange={(e) => set('priceStr', id, e.target.value)} /></td>
                      <td><input className="fin-cell" type="number" min="0" step="any" value={S.costStr[id] ?? ''} placeholder={c.cost_default != null ? fmtMoney(c.cost_default) : 'enter your own'} aria-label={`Cost for ${c.label}, ${cur} per ha`} aria-invalid={S.costStr[id] != null && S.costStr[id].trim() !== '' && !validNonNeg(Number(S.costStr[id]))} onChange={(e) => set('costStr', id, e.target.value)} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
