// Shared state for the user's fields. Owned by the coordinator; agents read and write it through useField().
// A farmer enters each field by coordinates and area; everything else (grid cell, climate, soil, rotation analysis,
// finance) is computed by the site. `field` is the ACTIVE field (the expanded row on the Fields page).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type CropId = 'winter_wheat' | 'maize' | 'sunflower' | 'pea' | 'soybean' | 'sugar_beet' | 'spring_barley' | 'millet' | 'black_fallow'
export const CROP_LABEL: Record<CropId, string> = {
  winter_wheat: 'Winter wheat', maize: 'Maize', sunflower: 'Sunflower', pea: 'Pea', soybean: 'Soybean', sugar_beet: 'Sugar beet',
  spring_barley: 'Spring barley', millet: 'Millet', black_fallow: 'Black fallow',
}
export type Soil = 'light' | 'medium' | 'heavy'

export interface FieldItem {
  id: string
  name: string
  lat: number | null         // decimal degrees N, entered by the farmer
  lon: number | null         // decimal degrees E, entered by the farmer
  areaHa: number | null      // area in hectares, entered by the farmer
  cellId: string | null      // NASA POWER grid cell containing (lat, lon), set by the Fields page; null when unknown or outside the grid
  crop: CropId | null        // crop grown this season
  rotation: CropId[]         // this field's current rotation, one crop per year, in order (may be empty)
  locked: boolean            // location lock: coordinates and map cannot be changed by accident
  soil: Soil | null          // soil preset chosen by the user; null = automatic (from the grid cell, see grid_soil.json)
}

interface Stored { fields: FieldItem[]; activeId: string }

interface Ctx {
  field: FieldItem | null                             // the active field; null when the farmer has no fields
  setField(patch: Partial<Omit<FieldItem, 'id'>>): void // patches the active field
  fields: FieldItem[]
  activeId: string                                    // '' when there are no fields
  selectField(id: string): void
  addField(): string                                  // creates an empty field, makes it active, returns its id
  removeField(id: string): void                       // the list may become empty
  renameField(id: string, name: string): void
  updateField(id: string, patch: Partial<Omit<FieldItem, 'id'>>): void   // patch any field, not only the active one
}

const KEY = 'fieldshift.field.v3'
const OLD_KEYS = ['fieldshift.field.v2', 'fieldshift.field.v1']
const blank = (n: number): FieldItem => ({ id: `f${Date.now().toString(36)}${n}`, name: `Field ${n}`, lat: null, lon: null, areaHa: null, cellId: null, crop: null, rotation: [], locked: false, soil: null })
const FieldCtx = createContext<Ctx | null>(null)

// Fields saved by the earlier map version carried a drawn polygon: its centre becomes the coordinates.
function migrate(f: Record<string, unknown>, n: number): FieldItem {
  const poly = Array.isArray(f.polygon) ? (f.polygon as [number, number][]) : []
  const centre = poly.length >= 3 ? [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length] : null
  return { ...blank(n), ...(f as Partial<FieldItem>), lat: (f.lat as number | null) ?? (centre ? +centre[0].toFixed(4) : null), lon: (f.lon as number | null) ?? (centre ? +centre[1].toFixed(4) : null), soil: (f.soil as FieldItem['soil']) ?? null }
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as Stored
      if (Array.isArray(s.fields)) return { fields: s.fields.map((f, i) => migrate(f as never, i + 1)), activeId: s.fields.some((f) => f.id === s.activeId) ? s.activeId : s.fields[0]?.id ?? '' }
    }
    for (const k of OLD_KEYS) {
      const old = localStorage.getItem(k)
      if (!old) continue
      const o = JSON.parse(old)
      const list = Array.isArray(o.fields) ? o.fields : [o]
      const fields = list.map((f: Record<string, unknown>, i: number) => migrate(f, i + 1))
      return { fields, activeId: fields.some((f: FieldItem) => f.id === o.activeId) ? o.activeId : fields[0]?.id ?? '' }
    }
  } catch { /* storage unavailable or corrupt */ }
  return { fields: [], activeId: '' }
}

export function FieldProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Stored>(load)
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* storage unavailable */ } }, [s])

  const value = useMemo<Ctx>(() => {
    const active = s.fields.find((f) => f.id === s.activeId) ?? s.fields[0] ?? null
    const patchField = (st: Stored, id: string, patch: Partial<FieldItem>): Stored => {
      const { id: _id, ...rest } = patch as Partial<FieldItem>
      return { ...st, fields: st.fields.map((f) => (f.id === id ? { ...f, ...rest } : f)) }
    }
    return {
      field: active,
      setField: (patch) => setS((st) => patchField(st, st.activeId, patch)),
      updateField: (id, patch) => setS((st) => patchField(st, id, patch)),
      fields: s.fields,
      activeId: active?.id ?? '',
      selectField: (id) => setS((st) => (st.fields.some((f) => f.id === id) ? { ...st, activeId: id } : st)),
      addField: () => {
        let n = s.fields.length + 1 // first free "Field N" so names stay distinct after deletes
        while (s.fields.some((x) => x.name === `Field ${n}`)) n++
        const f = blank(n)
        setS((st) => ({ fields: [...st.fields, f], activeId: f.id }))
        return f.id
      },
      removeField: (id) => setS((st) => {
        const i = st.fields.findIndex((f) => f.id === id)
        const fields = st.fields.filter((f) => f.id !== id)
        const next = fields[Math.min(i, fields.length - 1)]?.id ?? ''
        return { fields, activeId: st.activeId === id ? next : st.activeId }
      }),
      renameField: (id, name) => setS((st) => patchField(st, id, { name: name.slice(0, 40) })),
    }
  }, [s])

  return <FieldCtx.Provider value={value}>{children}</FieldCtx.Provider>
}

export const useField = () => useContext(FieldCtx)!
