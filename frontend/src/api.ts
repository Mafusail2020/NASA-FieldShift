import type { EvaluateResponse, Region } from './types'

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return r.json()
}

export const health = () => get<{ status: string }>('/api/health')
export const regions = () => get<Region[]>('/api/regions')

export async function evaluate(region: string, rotation: string[], soil: string): Promise<EvaluateResponse> {
  const r = await fetch(`/api/regions/${region}/rotations/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rotation, soil }),
  })
  if (!r.ok) throw new Error(`evaluate: ${r.status}`)
  return r.json()
}
