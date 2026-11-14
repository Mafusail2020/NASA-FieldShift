import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { Climate, Defaults, EconomicsRequest, EconomicsResponse, EvaluateResponse, Region } from './types'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
const TIMEOUT_MS = 5000

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal })
    if (!r.ok) {
      let detail = ''
      try { detail = (await r.json()).detail ?? '' } catch { /* not JSON */ }
      throw new HttpError(r.status, detail || `${r.status}`)
    }
    return (await r.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

const cache = new Map<string, Promise<unknown>>()
const staticJson = <T,>(file: string): Promise<T> => {
  if (!cache.has(file)) cache.set(file, fetchJson(`/data/${file}`))
  return cache.get(file) as Promise<T>
}

interface Meta { regions: Region[]; prices_costs: Defaults['prices_costs']; k: Defaults['k'] }
interface EvalFile { evaluations: Record<string, Record<string, EvaluateResponse['farmer']>>; climate: Record<string, Climate> }

export interface Backend {
  offline: boolean
  regions(): Promise<Region[]>
  climate(id: string, soil: string): Promise<Climate>
  evaluate(id: string, rotation: string[], soil: string): Promise<EvaluateResponse>
  defaults(): Promise<Defaults>
  economics(req: EconomicsRequest): Promise<EconomicsResponse>
}

const Ctx = createContext<Backend | null>(null)
export const useBackend = () => useContext(Ctx)!

export function BackendProvider({ children }: { children: ReactNode }) {
  const [offline, setOffline] = useState(false)

  // The API is tried first. A network failure, a 5 s timeout or a 5xx (gateway) answer switches to the static JSON; 4xx are real answers.
  const call = useCallback(async <T,>(live: () => Promise<T>, fallback: () => Promise<T>): Promise<T> => {
    if (!offline) {
      try { return await live() } catch (e) {
        if (e instanceof HttpError && e.status < 500) throw e
        setOffline(true)
      }
    }
    return fallback()
  }, [offline])

  const backend: Backend = {
    offline,
    regions: () => call(() => fetchJson<Region[]>(`${API}/api/regions`), async () => (await staticJson<Meta>('meta.json')).regions),
    climate: (id, soil) => call(() => fetchJson<Climate>(`${API}/api/regions/${id}/climate?soil=${soil}`),
      async () => (await staticJson<EvalFile>(`${id}_eval.json`)).climate[soil]),
    evaluate: (id, rotation, soil) => call(
      () => fetchJson<EvaluateResponse>(`${API}/api/regions/${id}/rotations/evaluate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rotation, soil }) }),
      async () => {
        const [file, meta] = await Promise.all([staticJson<EvalFile>(`${id}_eval.json`),
          staticJson<{ rotations: { id: string; name: string; crops: string[]; source: string; status: EvaluateResponse['alternatives'][0]['status'] }[] }>('meta.json')])
        const ev = file.evaluations[soil]
        const farmer = ev[rotation.join(',')]
        if (!farmer) throw new HttpError(422, 'offline-limit')
        return { region: id, soil, farmer, alternatives: meta.rotations.map((r) => ({ id: r.id, name: r.name, source: r.source, status: r.status, evaluation: ev[r.crops.join(',')] })) }
      }),
    defaults: () => call(() => fetchJson<Defaults>(`${API}/api/defaults`), async () => {
      const m = await staticJson<Meta>('meta.json')
      return { prices_costs: m.prices_costs, k: m.k }
    }),
    // Prices and yields are not available offline: the economics call needs the API.
    economics: (req) => offline ? Promise.reject(new HttpError(0, 'offline')) : fetchJson<EconomicsResponse>(`${API}/api/economics`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) }),
  }
  return <Ctx.Provider value={backend}>{children}</Ctx.Provider>
}
