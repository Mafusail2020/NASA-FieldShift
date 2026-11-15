// Scroll-triggered appearing animations of the Fields tab (the CSS is pages/FieldsMotion.css).
// A block that starts below the visible screen is marked data-fm="wait": its animations are paused on their first frame, so it is
// hidden. When the user scrolls it into view it becomes data-fm="go" and the animations play once. A block that is on screen when it
// appears (the first screen at page load, or content that arrives later in view) is set to "go" at once, with a small start offset per
// block (--fm-base) so the first screen plays as a sequence. Blocks above the screen are left alone. Not used with reduced motion.
import { useLayoutEffect } from 'react'

// Every block that gets a scroll-triggered animation. A block can be a "scene": its children are animated, the block only triggers them.
const TARGETS = [
  '.fp-side-top h1', '.fp-add', '.fp-sum',
  '.fd-name', '.fd-top .cp-mini', '.fr-inputs', '.fr-meta', '.fr-fin', '.fg-verdict', '.pass-group',
  '.fc-head h3', '.pass-head h3', '.rot h2', '.rot h3:not(.coll-h)', '.ft-head h3',
  '.fc-card', '.ft-card', '.rot-years', '.rot-seg', '.fc-seg', '.rot-tablewrap', '.cf-wrap', '.fs-tablewrap',
  '.coll', '.rot-sec', '.cf', '.fs', '.ft-head', '.fs-suggest', '.fs-cards', '.srcfold',
].join(',')

export function useScrollReveal() {
  // a layout effect and a synchronous MutationObserver: blocks are tagged before the browser paints, so nothing flashes visible first
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return
    const root = document.querySelector('.main') ?? document.body
    const seen = new WeakSet<Element>()
    const tagged = new Set<HTMLElement>()
    // start when a useful part of the block is on screen: 15 % of it, or 160 px of a tall one. No margin at the bottom: the last block of
    // the page can only ever reach the lower edge of the screen, and it must still start.
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        if (e.intersectionRatio >= 0.15 || e.intersectionRect.height >= Math.min(160, e.boundingClientRect.height)) {
          (e.target as HTMLElement).dataset.fm = 'go'; io.unobserve(e.target)
        }
      }
    }, { threshold: [0, 0.02, 0.05, 0.1, 0.15, 0.25, 0.5, 1] })

    const scan = () => {
      let n = 0   // order of the blocks that start on screen in this pass
      root.querySelectorAll<HTMLElement>(TARGETS).forEach((el) => {
        if (seen.has(el)) return
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) return          // not laid out (inside a closed details): looked at again after a toggle
        seen.add(el)
        tagged.add(el)
        if (r.bottom <= 0) { tagged.delete(el); return }     // above the screen: nothing to show
        if (r.top < window.innerHeight * 0.9) {              // on screen now: play, a little after the block before it
          el.style.setProperty('--fm-base', `${Math.min(n++, 14) * 70}ms`)
          el.dataset.fm = 'go'
          return
        }
        el.dataset.fm = 'wait'
        io.observe(el)
      })
    }
    const later = () => { scan() }
    const mo = new MutationObserver(later)
    mo.observe(root, { childList: true, subtree: true })
    document.addEventListener('toggle', later, true)         // <details> opened: its content has a size now
    window.addEventListener('resize', later)
    scan()
    return () => {
      mo.disconnect(); io.disconnect()
      document.removeEventListener('toggle', later, true); window.removeEventListener('resize', later)
      tagged.forEach((el) => { el.removeAttribute('data-fm'); el.style.removeProperty('--fm-base') })
    }
  }, [])
}
