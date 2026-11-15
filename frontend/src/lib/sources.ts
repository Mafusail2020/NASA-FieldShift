// Source and status labels (Literature, Estimate, ...) are not drawn next to the numbers. Each StatusChip registers its label here and
// SourcesFold shows them all in one collapsed block at the bottom of the page. Entries disappear when the component that owns them unmounts.
import { useSyncExternalStore } from 'react'
import type { Status } from '../types'

export interface SourceEntry { key: string; status: Status; source: string; count: number }

const map = new Map<string, SourceEntry>()
let snap: SourceEntry[] = []
const subs = new Set<() => void>()
let queued = false

function emit() {
  if (queued) return
  queued = true
  queueMicrotask(() => { queued = false; snap = [...map.values()]; subs.forEach((f) => f()) })   // many chips mount at once: notify once
}

/** Registers one label; returns the function that removes it again. Equal (status, source) pairs are listed once. */
export function registerSource(status: Status, source: string): () => void {
  const key = `${status}|${source}`
  const e = map.get(key)
  if (e) e.count++
  else map.set(key, { key, status, source, count: 1 })
  emit()
  return () => {
    const x = map.get(key)
    if (!x) return
    if (--x.count <= 0) map.delete(key)
    emit()
  }
}

export const useSources = (): SourceEntry[] =>
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => snap)
