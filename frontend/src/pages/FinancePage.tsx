import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import StatusChip from '../components/StatusChip'
import LineChart from '../components/finance/LineChart'
import { useField, type CropId, type FieldItem } from '../lib/field'
import { fmt } from '../lib/format'
import { useSoilDoc } from '../lib/soil'
import {
  YIELD_DEFAULT_YEARS, YIELD_RANGE_YEARS, compute, convertAmount, farmTotals, fieldRow, type FinSettings, fmtMoney, inCurrency, useFinanceInputs, useFinSettings, type Currency, lastN, lossShare, median, percentile, rangeOf, validNonNeg, validPos,
  type FinanceInputs, type FStatus, type Scenario,
} from '../lib/finance'
import './FinancePage.css'

type Str = Record<string, string>

const parse = (s: string | undefined) => (s == null || s.trim() === '' ? null : Number(s))

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
  const data = useMemo<FinanceInputs | null>(() => raw && inCurrency(raw, cur), [raw, cur])
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
  const cost = costRaw != null && !costErr ? costRaw : null

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
  const loss = scen && c ? lossShare(lastN(c.yields, YIELD_RANGE_YEARS).map((p) => p.value), scen) : null

  const uga = useMemo(() => {
    if (!data || !crop) return []
    const rows = data.uga.filter((r) => r.crop.startsWith(crop))
    const latest = rows.reduce((m, r) => (r.date > m ? r.date : m), '')
    return rows.filter((r) => r.date === latest)
  }, [data, crop])

  const idx = (n: number) => ({ '--i': n }) as React.CSSProperties
  const cropOptions = data ? Object.entries(data.crops) : []

  return (
    <div className="fin">
      <header className="fin-head reveal" style={idx(0)}>
        <div>
          <p className="fin-eyebrow">Income estimate</p>
          <h1>Finance</h1>
        </div>
        <p className="fin-note" role="note">
          An <b>estimate with a range</b>, not a promise of income. It uses national statistics and numbers you enter.
        </p>
      </header>

      {load.state === 'loading' && <div className="fin-card" aria-busy="true"><p className="fin-muted">Loading inputs…</p></div>}
      {load.state === 'error' && (
        <div className="fin-card" role="alert">
          <p className="fin-error">Could not load <code>/data/finance_inputs.json</code>.</p>
          <p className="fin-muted">Generate it with <code>cd backend &amp;&amp; .venv/bin/python -m pipeline.export_finance</code>.</p>
        </div>
      )}

      {data && (
        <>
          <section className="fin-card reveal" aria-labelledby="fin-scope">
            <h2 id="fin-scope">View</h2>
            <div className="fin-seg" role="group" aria-label="Scope">
              <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All fields ({fields.length})</button>
              <button type="button" aria-pressed={scope === 'one'} onClick={() => setScope('one')}>One field</button>
            </div>
            <p className="fin-muted">Fields, their crops and areas come from the <Link to="/fields">Fields page</Link>. Yield, price and cost are set per crop and shared by every field with that crop.</p>
          </section>

          <section className="fin-card reveal" aria-labelledby="fin-cur">
            <h2 id="fin-cur">Currency</h2>
            <div className="fin-cur-row">
              <div className="fin-seg" role="group" aria-label="Currency">
                {(['USD', 'UAH'] as Currency[]).map((cc) => (
                  <button key={cc} type="button" aria-pressed={cur === cc} className={cur === cc ? 'on' : ''} onClick={() => switchCur(cc)}>{cc === 'USD' ? 'US dollars (USD)' : 'Hryvnia (UAH)'}</button>
                ))}
              </div>
              <label className="fin-field fin-rate">
                <span>Exchange rate, UAH per USD <StatusChip status={rateTyped != null && !rateErr ? 'estimate' : raw!.fx.status} source={raw!.fx.source} /></span>
                <input type="number" inputMode="decimal" min="0" step="any" value={rateStr} placeholder={fmt(raw!.fx.uah_per_usd, 2)}
                  onChange={(e) => setRateStr(e.target.value)} aria-invalid={rateErr} />
                {rateErr && <em className="fin-error">Rate must be above 0.</em>}
              </label>
            </div>
            <p className="fin-muted">Default {fmt(raw!.fx.uah_per_usd, 2)} is the FAO annual-average rate implied by FAOSTAT prices for {raw!.fx.year} (UAH/t divided by USD/t), not today's market rate. Edit it if you want another rate. The rate converts the prices and costs you typed when you switch currency, and the UGA export prices; FAOSTAT prices are taken from FAOSTAT's own column for each currency.</p>
          </section>

          {scope === 'all' && (
            <Farm cur={cur} data={data} fields={fields} S={S} setS={setS} onOpen={(id) => setSelId(id)} />
          )}

          {scope === 'one' && (<>
          <section className="fin-card reveal" style={idx(1)} aria-labelledby="fin-in">
            <h2 id="fin-in">Field detail</h2>
            <div className="fin-form">
              <label className="fin-field">
                <span>Field</span>
                <select value={field.id} onChange={(e) => setSelId(e.target.value)}>
                  {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
            </div>
            <div className="fin-form">
              <label className="fin-field">
                <span>Area, ha</span>
                <input type="number" inputMode="decimal" min="0" step="any" value={areaStr} placeholder={field.areaHa != null ? String(Math.round(field.areaHa * 100) / 100) : 'enter area'}
                  onChange={(e) => setAreaStr(e.target.value)} aria-invalid={areaErr} aria-describedby="h-area" />
                <span className="fin-hint" id="h-area">
                  {areaErr ? <em className="fin-error">Area must be a number above 0.</em> : areaEdited ? 'edited here' : field.areaHa != null ? 'from the Fields page' : 'not set on the Fields page'}
                </span>
              </label>
              <label className="fin-field">
                <span>Crop</span>
                <select value={crop} onChange={(e) => setCropSel(e.target.value)} aria-describedby="h-crop">
                  <option value="" disabled>choose a crop</option>
                  {cropOptions.map(([id, v]) => <option key={id} value={id}>{v.label}</option>)}
                </select>
                <span className="fin-hint" id="h-crop">{cropEdited ? 'edited here' : field.crop ? 'from the Fields page' : 'not set on the Fields page'}</span>
              </label>
            </div>
            <div className="fin-reset">
              <button type="button" className="fin-btn" disabled={!areaEdited && !cropEdited} onClick={resetToField}>Reset to field settings</button>
              <span className="fin-hint">Restores the area and crop of this field as set on the Fields page.</span>
            </div>
            {field.crop === 'black_fallow' && !cropSel && <p className="fin-muted">Black fallow earns no crop revenue; pick a crop to estimate income.</p>}
          </section>

          {!c || !defaults ? (
            <div className="fin-empty" role="status">Choose a crop and an area, or add a field with its area and crop on the <Link to="/fields">Fields page</Link>, to see an estimate.</div>
          ) : (
            <>
              <section className="fin-card reveal" style={idx(2)} aria-labelledby="fin-par">
                <h2 id="fin-par">Inputs for {c.label.toLowerCase()}</h2>
                <p className="fin-muted">Yield, price and cost are set per crop and shared by every field with this crop.</p>
                <div className="fin-form">
                  <label className="fin-field">
                    <span>Yield, t/ha</span>
                    <input type="number" inputMode="decimal" min="0" step="any" value={yieldStr[crop] ?? ''} placeholder={fmt(defaults.yieldMedian, 2)}
                      onChange={(e) => setYieldStr({ ...yieldStr, [crop]: e.target.value })} aria-invalid={yieldErr} />
                    {yieldErr ? <em className="fin-error">Yield must be above 0.</em> : (
                      <small>Default: median of FAOSTAT {defaults.yieldFrom}-{defaults.yieldTo}, national, all farm categories <StatusChip status={c.yield_status} source={c.yield_source} /></small>
                    )}
                    {c.psd.length > 0 && (
                      <small>USDA: {c.psd.map((p) => `${p.year} ${fmt(p.value, 2)}${p.status === 'estimate' ? ' (forecast)' : ''}`).join(', ')} t/ha <StatusChip status={c.psd[0].status} source={c.psd[0].source} /></small>
                    )}
                  </label>
                  <label className="fin-field">
                    <span>Price, {cur}/t</span>
                    <input type="number" inputMode="decimal" min="0" step="any" value={priceStr[crop] ?? ''} placeholder={defaults.price != null ? fmtMoney(defaults.price) : 'enter your price'}
                      onChange={(e) => setPriceStr({ ...priceStr, [crop]: e.target.value })} aria-invalid={priceErr} />
                    {priceErr ? <em className="fin-error">Price must be above 0.</em> : (
                      <small>Default: FAOSTAT producer price {defaults.priceYear} in {cur}, nominal (not inflation-adjusted); the last year available is 2023.{cur === 'USD' ? " USD is FAO's own conversion of the same price at its annual rate." : ''} <StatusChip status={c.price_status} source={c.price_source ?? undefined} /></small>
                    )}
                  </label>
                  <label className="fin-field">
                    <span>Cost, {cur}/ha <StatusChip status={cost == null ? 'todo' : 'estimate'} source="Entered by you; no open source for costs per hectare" /></span>
                    <input type="number" inputMode="decimal" min="0" step="any" value={costStr[crop] ?? ''} placeholder="enter your own"
                      onChange={(e) => setCostStr({ ...costStr, [crop]: e.target.value })} aria-invalid={costErr} />
                    {costErr ? <em className="fin-error">Cost cannot be negative.</em> : <small>No open source for costs per hectare: enter your own. Without it only revenue is shown.</small>}
                  </label>
                  <label className="fin-field">
                    <span>Price range, ± {spread}%</span>
                    <input type="range" min="0" max="50" step="5" value={spread} onChange={(e) => setSpread(Number(e.target.value))} aria-label="Price range, plus or minus percent" />
                    <small>Your assumption for price swings, not a forecast <StatusChip status="estimate" source="User-set sensitivity; the default 20% is not derived from data" /></small>
                  </label>
                </div>

                <div className="fin-k">
                  <label className="fin-check">
                    <input type="checkbox" checked={kOn} onChange={(e) => { setKOn(e.target.checked); if (!pred) setPred(data.k.find((r) => r.crop === crop)?.predecessor ?? '') }} />
                    <span>Apply predecessor effect k (multiplies yield for money only)</span>
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
                      {kRow && <p>k = <b>{fmt(kRow.value, 2)}</b> <StatusChip status={kRow.status} source={kRow.source} /> <small>{kRow.source}</small></p>}
                      <p className="fin-muted">k is applied to revenue only. It is not combined with the water-balance risk.</p>
                    </div>
                  )}
                </div>
              </section>

              <section className="fin-card fin-accent reveal" style={idx(3)} aria-labelledby="fin-out" aria-live="polite">
                <h2 id="fin-out">Estimate</h2>
                {!res || !rng ? (
                  <p className="fin-muted">Fix the highlighted inputs{area == null ? ' and enter an area' : ''} to see an estimate.</p>
                ) : (
                  <>
                    <div className="fin-stats">
                      <Stat label="Revenue per ha" value={`${fmtMoney(res.revenuePerHa)} ${cur}`} range={`${fmtMoney(rng.revenuePerHa.low)} to ${fmtMoney(rng.revenuePerHa.high)}`} />
                      <Stat label={`Revenue, ${fmt(area!, 1)} ha`} value={`${fmtMoney(res.revenue)} ${cur}`} range={`${fmtMoney(rng.revenuePerHa.low * area!)} to ${fmtMoney(rng.revenuePerHa.high * area!)}`} />
                      {res.marginPerHa != null && rng.marginPerHa && <>
                        <Stat label="Margin per ha" value={`${fmtMoney(res.marginPerHa)} ${cur}`} range={`${fmtMoney(rng.marginPerHa.low)} to ${fmtMoney(rng.marginPerHa.high)}`} />
                        <Stat label="Margin, total" value={`${fmtMoney(res.margin!)} ${cur}`} range={`${fmtMoney(rng.marginPerHa.low * area!)} to ${fmtMoney(rng.marginPerHa.high * area!)}`} />
                      </>}
                    </div>
                    <p className="fin-muted">
                      Range = low and high yield (10th-90th percentile of FAOSTAT yields, last {defaults.rangeYears} years, raw, not detrended: {fmt(defaults.low, 2)} to {fmt(defaults.high, 2)} t/ha)
                      combined with the price ±{spread}%. Central value uses {fmt(yieldVal!, 2)} t/ha{k !== 1 ? ` × k ${fmt(k, 2)}` : ''} and {fmtMoney(priceVal!)} {cur}/t.
                    </p>
                    {cost == null ? (
                      <p className="fin-warn" role="status">Margin needs a cost per hectare. Enter your own above; until then only revenue is shown.</p>
                    ) : (
                      <ul className="fin-list">
                        <li>Break-even yield at your price: <b>{fmt(res.breakEvenYield!, 2)} t/ha</b> (central yield {fmt(yieldVal!, 2)})</li>
                        <li>Break-even price at your yield: <b>{fmtMoney(res.breakEvenPrice!)} {cur}/t</b> (your price {fmtMoney(priceVal!)})</li>
                        {loss && <li>Years with a negative margin in the last {loss.total} national yields, at your price and cost: <b>{loss.losing} of {loss.total}</b></li>}
                      </ul>
                    )}
                  </>
                )}
              </section>

              <section className="fin-card reveal" style={idx(4)} aria-labelledby="fin-mkt">
                <h2 id="fin-mkt">Market context (national, not local)</h2>
                <p className="fin-warn" role="note">No regional or farm-gate price source is available. Enter your own local price above.</p>
                <h3>FAOSTAT producer price, {c.label.toLowerCase()}, {cur}/t, nominal</h3>
                <LineChart points={c.prices} unit={`${cur}/t`} label={`National producer price of ${c.label}, ${cur} per tonne, nominal, ${c.prices[0]?.year} to ${c.prices[c.prices.length - 1]?.year}`}
                  marker={priceVal ? { value: priceVal, label: 'your price' } : null} />
                <p className="fin-muted">Nominal prices: the rise is mostly inflation and the exchange rate, not real growth. Last year available is 2023. <StatusChip status={c.price_status} source={c.price_source ?? undefined} /></p>
                <h3>FAOSTAT yield, t/ha</h3>
                <LineChart points={c.yields} unit="t/ha" digits={1} highlightFrom={c.yields[c.yields.length - YIELD_RANGE_YEARS]?.year}
                  label={`National yield of ${c.label}, tonnes per hectare, ${c.yields[0].year} to ${c.yields[c.yields.length - 1].year}`} />
                <p className="fin-muted">Filled dots: the last {YIELD_RANGE_YEARS} years used for the range. National, all farm categories. <StatusChip status={c.yield_status} source={c.yield_source} /></p>
                <h3>Export prices, UGA Index (USD/t)</h3>
                {uga.length ? (
                  <div className="fin-table-wrap">
                    <table>
                      <caption className="sr-only">Latest UGA Index export prices</caption>
                      <thead><tr><th scope="col">Date</th><th scope="col">Item</th><th scope="col" className="fin-num">USD/t</th><th scope="col" className="fin-num">UAH/t at your rate</th><th scope="col">Status</th></tr></thead>
                      <tbody>{uga.map((r) => (
                        <tr key={r.item}><td>{r.date}</td><th scope="row">{r.item}</th><td className="fin-num">{fmt(r.usd_per_t)}</td><td className="fin-num">{validPos(rate) ? fmt(r.usd_per_t * rate) : 'n/a'}</td><td><StatusChip status={r.status} source={r.source} /></td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                ) : <p className="fin-muted">The UGA Index has no price for this crop.</p>}
                <p className="fin-muted">CPT Black Sea export prices (a different basis from farm-gate), the latest days only. The UAH column converts the USD price with the exchange rate set above (FAO annual implied rate, not today's market rate).</p>
              </section>
            </>
          )}

          {data && field.rotation.length > 0 && (
            <Rotation cur={cur} name={field.name} data={data} rotation={field.rotation} kOn={kOn} yieldStr={yieldStr} priceStr={priceStr} costStr={costStr}
              setCost={(id, v) => setCostStr({ ...costStr, [id]: v })} area={area} idx={idx} />
          )}

          </>)}

          <section className="fin-card reveal" style={idx(6)} aria-labelledby="fin-lim">
            <h2 id="fin-lim">Limitations</h2>
            <ul className="fin-list">
              <li>Yields are national FAOSTAT values for all farm categories, not your farm or your oblast.</li>
              <li>Prices are nominal and end in 2023; they are not inflation-adjusted. USD values are FAO's conversion at its annual rate for each year.</li>
              <li>The exchange rate is a historical FAO annual-average implied rate, not today's market rate and not a forecast. It only converts what you type and the UGA export prices.</li>
              <li>Costs per hectare and local market prices are not in any open source; you enter them.</li>
              <li>The yield range uses raw historical yields (technology trend not removed) and ignores the war's effect on yields and logistics.</li>
              <li>The price range is your own assumption. The result is an estimate, not a forecast or a promise of income.</li>
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, range }: { label: string; value: string; range: string }) {
  return (
    <div className="fin-stat">
      <span className="fin-stat-label">{label}</span>
      <span className="fin-stat-value">{value}</span>
      <span className="fin-stat-range">range {range}</span>
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
    if (!c) return { id, i, label: id === 'black_fallow' ? 'Black fallow' : id, revenue: 0, cost: parse(costStr[id]), noRevenue: true, k: 1, kStatus: null as FStatus | null }
    const recent = lastN(c.yields, YIELD_DEFAULT_YEARS).map((p) => p.value)
    const y = parse(yieldStr[id]) ?? median(recent)
    const p = parse(priceStr[id]) ?? c.prices[c.prices.length - 1]?.value ?? NaN
    const kr = kOn ? data.k.find((r) => r.crop === id && r.predecessor === prev) : null
    const k = kr?.value ?? 1
    return { id, i, label: c.label, revenue: y * k * p, cost: parse(costStr[id]), noRevenue: false, k, kStatus: kOn ? (kr?.status ?? 'estimate') : null, prev }
  })
  const allCost = rows.every((r) => r.cost != null && validNonNeg(r.cost))
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0)
  const totalCost = allCost ? rows.reduce((s, r) => s + (r.cost as number), 0) : null
  return (
    <section className="fin-card reveal" style={idx(5)} aria-labelledby="fin-rot">
      <h2 id="fin-rot">Your rotation: revenue per hectare per year</h2>
      <p className="fin-muted">Rotation of {name}. Each crop uses its own yield and price (defaults or what you entered above for it). This table compares money only and makes no agronomic claim.</p>
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
                  <td className="fin-num">{r.noRevenue ? '0 (no crop)' : Number.isFinite(r.revenue) ? fmtMoney(r.revenue) : 'n/a'}</td>
                  <td>
                    <input className="fin-cell" type="number" min="0" step="any" value={costStr[r.id] ?? ''} placeholder="enter your own" aria-label={`Cost per hectare, year ${r.i + 1} ${r.label}`}
                      aria-invalid={bad} onChange={(e) => setCost(r.id, e.target.value)} />
                  </td>
                  <td className="fin-num">{r.cost != null && !bad ? fmtMoney(r.revenue - r.cost) : <StatusChip status="todo" />}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>Average per year</th>
              <td className="fin-num">{fmtMoney(totalRev / rows.length)}</td>
              <td />
              <td className="fin-num">{totalCost != null ? fmtMoney((totalRev - totalCost) / rows.length) : 'needs all costs'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {area != null && <p className="fin-muted">For {fmt(area, 1)} ha the average revenue is about {fmtMoney((totalRev / rows.length) * area)} {cur} per year (an estimate; the range shown above applies).</p>}
    </section>
  )
}

interface FarmProps { cur: Currency; data: FinanceInputs; fields: FieldItem[]; S: FinSettings; setS: (p: Partial<FinSettings>) => void; onOpen: (id: string) => void }

// One row per field. Inputs are per crop (shared). k is not applied here: it depends on the previous crop of each field.
function Farm({ cur, data, fields, S, setS, onOpen }: FarmProps) {
  const soil = useSoilDoc()
  const rows = fields.map((f) => fieldRow(data, f, S, soil.state === 'ready' ? soil.data : null))
  const T = farmTotals(rows)
  const skipped = T.total - T.counted
  const usedCrops = [...new Set(rows.filter((r) => r.cropId && data.crops[r.cropId]).map((r) => r.cropId))]
  const set = (key: 'yieldStr' | 'priceStr' | 'costStr', id: string, v: string) => setS({ [key]: { ...S[key], [id]: v } })
  return (
    <>
      <section className="fin-card reveal" aria-labelledby="fin-crops">
        <h2 id="fin-crops">Inputs per crop</h2>
        <p className="fin-muted">One row per crop used on your fields. Leave yield and price empty to use the defaults shown (FAOSTAT national, nominal, last year 2023). Cost has no open source: enter your own.</p>
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
                      <td><input className="fin-cell" type="number" min="0" step="any" value={S.costStr[id] ?? ''} placeholder="enter your own" aria-label={`Cost for ${c.label}, ${cur} per ha`} aria-invalid={S.costStr[id] != null && S.costStr[id].trim() !== '' && !validNonNeg(Number(S.costStr[id]))} onChange={(e) => set('costStr', id, e.target.value)} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="fin-muted">Yield default: median of the last {YIELD_DEFAULT_YEARS} FAOSTAT years <StatusChip status="data" source={data.notes.yields} /> Price default: FAOSTAT producer price, nominal <StatusChip status="data" source={data.notes.prices} /> Cost: <StatusChip status="todo" source={data.notes.missing} /></p>
      </section>

      <section className="fin-card reveal" aria-labelledby="fin-farm">
        <h2 id="fin-farm">Whole farm</h2>
        <p className="fin-muted">Revenue and margin show a range: 10th-90th percentile of national yields (last {YIELD_RANGE_YEARS} years), price ±{S.spread}%. The predecessor effect k is not applied in this table. Fields without a crop or area are marked incomplete and left out of the totals.</p>
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
                    <td colSpan={6}><span className="fin-incomplete">{r.calc?.invalid ? 'Incomplete: invalid inputs for this crop' : `Incomplete: ${r.area == null ? 'no area' : ''}${r.area == null && !r.cropLabel ? ' and ' : ''}${!r.cropLabel ? 'no crop' : ''}`}</span>{r.cropLabel === 'Black fallow' && r.area != null ? ' (black fallow has no crop revenue)' : ''}</td>
                  ) : (<>
                    <td className="fin-num">{fmt(r.area!, 1)}</td>
                    <td className="fin-num">{fmt(r.calc.y, 2)}</td>
                    <td className="fin-num">{fmtMoney(r.calc.p)}</td>
                    <td className="fin-num">{r.calc.cost != null ? fmtMoney(r.calc.cost) : <StatusChip status="todo" source="Enter your own cost in the table above" />}</td>
                    <td className="fin-num">{fmtMoney(r.calc.revLow)} to {fmtMoney(r.calc.revHigh)}<br /><small>central {fmtMoney(r.calc.rev)}</small></td>
                    <td className="fin-num">{r.calc.margin != null ? <>{fmtMoney(r.calc.marLow!)} to {fmtMoney(r.calc.marHigh!)}<br /><small>central {fmtMoney(r.calc.margin)}</small></> : 'needs cost'}</td>
                  </>)}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>Total ({T.counted} of {T.total} fields)</th>
                <td className="fin-num">{fmt(T.area, 1)}</td>
                <td colSpan={3} />
                <td className="fin-num">{T.counted ? <>{fmtMoney(T.rev.low)} to {fmtMoney(T.rev.high)}<br /><small>central {fmtMoney(T.rev.mid)}</small></> : '-'}</td>
                <td className="fin-num">{T.mar ? <>{fmtMoney(T.mar.low)} to {fmtMoney(T.mar.high)}<br /><small>central {fmtMoney(T.mar.mid)}</small></> : 'needs all costs'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="fin-muted">
          Sources: yield FAOSTAT national, all farm categories <StatusChip status="data" source={data.notes.yields} /> price FAOSTAT 2023 nominal <StatusChip status="data" source={data.notes.prices} /> cost entered by you <StatusChip status="todo" source={data.notes.missing} />.
          {skipped > 0 && ` ${skipped} field${skipped > 1 ? 's are' : ' is'} excluded from the totals.`} Summed ranges add every field's low and high together, so they are wider than a realistic whole-farm spread (fields do not all hit the extremes at once).
        </p>
      </section>
    </>
  )
}
