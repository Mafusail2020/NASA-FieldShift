import { useEffect, type RefObject } from 'react'

// Closes a popover on an outside click or Esc.
export default function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key, true) }
  }, [ref, open, close])
}
