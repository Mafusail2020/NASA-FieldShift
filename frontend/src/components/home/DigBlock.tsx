import { useEffect, useRef, useState } from 'react'

const TITLE_BEFORE = 'Field '
const TITLE_SHIFT = 'Shift'
const TAG = 'Making farming more predictable'
const DESC = 'Enter your fields. Get NASA-based climate, soil, crop rotation and income estimates for each one, in one place.'

// Soil: dark earth tiles with slightly lighter glyphs, a few terracotta ones.
const SOIL_BG = ['#2e2219', '#3a2b1e', '#46342a', '#33261c', '#523a2b', '#2a1f17']
const SOIL_FG = ['#6b5240', '#7d6049', '#5a4333', '#8a6a4f']
const SOIL_GLYPHS = '#@%▓&8#@%'
const TERRACOTTA = '#7a3f21'

// A trowel works over the title in three passes (left to right, right to left, left to right), one band of rows each.
const START = 0.3 // s before the first pass
const PASS = 0.62 // s per pass
const GAP = 0.08  // s between passes

const rnd = (a: number, b: number) => a + Math.random() * (b - a)

// The title's letters sit under an opaque patch of soil made of glyph cells. A scripted trowel sweeps the patch; every cell it
// passes is removed (and thrown aside as a particle), unearthing the letters. onDug fires when the last cell is gone.
function DigCanvas({ host, onDug, onDone }: { host: HTMLElement; onDug(): void; onDone(): void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  // the parent re-renders when the title is dug: keep the latest callbacks in refs so that never restarts the animation
  const cb = useRef({ onDug, onDone })
  cb.current = { onDug, onDone }

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0, cancelled = false

    const run = () => {
      const r = host.getBoundingClientRect()
      const w = r.width, h = r.height
      const fs = parseFloat(getComputedStyle(host).fontSize)
      const ch = Math.max(11, Math.round(fs / 8)), cw = Math.round(ch * 0.62)
      const PADX = 60, PADT = 170, PADB = 60 // canvas margins around the title, room for flying dirt
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cssW = w + PADX * 2, cssH = h + PADT + PADB
      canvas.style.left = `${-PADX}px`; canvas.style.top = `${-PADT}px`
      canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // soil grid: covers the title plus one cell of margin; the outer ring is ragged
      const x0 = PADX - cw, y0 = PADT - ch
      const cols = Math.ceil((w + cw * 2) / cw), rows = Math.ceil((h + ch * 2) / ch)
      const N = cols * rows
      const bg = new Array<string>(N), fg = new Array<string>(N), gl = new Array<string>(N)
      const tAt = new Float32Array(N), alive = new Uint8Array(N)
      const bandH = rows / 3
      const dirOf = (b: number) => (b % 2 === 0 ? 1 : -1)
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i
          const ring = i === 0 || j === 0 || i === cols - 1 || j === rows - 1
          alive[k] = ring && Math.random() < 0.4 ? 0 : 1
          bg[k] = Math.random() < 0.06 ? TERRACOTTA : SOIL_BG[(Math.random() * SOIL_BG.length) | 0]
          fg[k] = SOIL_FG[(Math.random() * SOIL_FG.length) | 0]
          gl[k] = SOIL_GLYPHS[(Math.random() * SOIL_GLYPHS.length) | 0]
          const b = Math.min(2, Math.floor(j / bandH))
          const f = (i + 0.5) / cols
          const along = dirOf(b) === 1 ? f : 1 - f
          tAt[k] = START + b * (PASS + GAP) + along * PASS + Math.random() * 0.05
        }
      }
      const tEnd = START + 3 * PASS + 2 * GAP + 0.06
      const passY = (b: number) => y0 + (b + 0.5) * bandH * ch
      const trowel = (t: number) => {
        for (let b = 0; b < 3; b++) {
          const t0 = START + b * (PASS + GAP), t1 = t0 + PASS
          if (t >= t0 && t <= t1) {
            const f = (t - t0) / PASS, along = dirOf(b) === 1 ? f : 1 - f
            return { x: x0 + along * cols * cw, y: passY(b) + Math.sin(t * 22) * ch * 0.35, dir: dirOf(b) }
          }
          if (b < 2 && t > t1 && t < t1 + GAP) { // hop to the next band
            const nb = b + 1, u = (t - t1) / GAP
            const ex = dirOf(b) === 1 ? x0 + cols * cw : x0
            return { x: ex, y: passY(b) + (passY(nb) - passY(b)) * u, dir: dirOf(nb) }
          }
        }
        return null
      }

      type P = { x: number; y: number; vx: number; vy: number; life: number; age: number; c: string; ch: string }
      const parts: P[] = []
      let prev = 0, dugFired = false
      const t0 = performance.now()

      const frame = (now: number) => {
        if (cancelled) return
        raf = requestAnimationFrame(frame)
        const t = (now - t0) / 1000, dt = Math.min(0.05, t - prev)
        // remove the cells the trowel reached since the last frame and throw dirt aside
        const tw = trowel(t)
        for (let k = 0; k < N; k++) {
          if (alive[k] && tAt[k] <= t) {
            alive[k] = 0
            if (parts.length < 700 && Math.random() < 0.75) {
              const i = k % cols, j = (k / cols) | 0
              const b = Math.min(2, Math.floor(j / bandH)), d = dirOf(b)
              parts.push({
                x: x0 + (i + 0.5) * cw, y: y0 + (j + 0.5) * ch, vx: d * rnd(30, 150), vy: -rnd(90, 280),
                life: rnd(0.45, 0.95), age: 0, c: Math.random() < 0.25 ? '#8a6a4f' : '#46342a', ch: SOIL_GLYPHS[(Math.random() * SOIL_GLYPHS.length) | 0],
              })
            }
          }
        }
        prev = t
        ctx.clearRect(0, 0, cssW, cssH)
        ctx.font = `${ch - 1}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`
        ctx.textBaseline = 'top'
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const k = j * cols + i
          if (!alive[k]) continue
          const x = x0 + i * cw, y = y0 + j * ch
          ctx.fillStyle = bg[k]; ctx.fillRect(x, y, cw + 0.5, ch + 0.5)
          ctx.fillStyle = fg[k]; ctx.fillText(gl[k], x, y)
        }
        // flying dirt
        for (let n = parts.length - 1; n >= 0; n--) {
          const p = parts[n]
          p.age += dt; p.vy += 760 * dt; p.x += p.vx * dt; p.y += p.vy * dt
          if (p.age >= p.life) { parts.splice(n, 1); continue }
          ctx.globalAlpha = 1 - p.age / p.life
          ctx.fillStyle = p.c; ctx.fillText(p.ch, p.x, p.y)
        }
        ctx.globalAlpha = 1
        // the trowel: steel blade, orange handle, pointing along the pass
        if (tw) {
          ctx.save()
          ctx.translate(tw.x, tw.y); ctx.scale(tw.dir, 1); ctx.rotate(0.12)
          const L = ch * 2.8, W = ch * 0.95
          ctx.fillStyle = '#c7ccd0'; ctx.strokeStyle = '#7d8489'; ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(L, 0); ctx.quadraticCurveTo(L * 0.55, -W, 0, -W * 0.75)
          ctx.lineTo(0, W * 0.75); ctx.quadraticCurveTo(L * 0.55, W, L, 0); ctx.closePath(); ctx.fill(); ctx.stroke()
          ctx.fillStyle = '#f97316'; ctx.fillRect(-ch * 1.9, -ch * 0.2, ch * 1.9, ch * 0.4)
          ctx.fillStyle = '#7d8489'; ctx.fillRect(-ch * 0.12, -W * 0.45, ch * 0.2, W * 0.9)
          ctx.restore()
        }
        if (!dugFired && t >= tEnd) { dugFired = true; cb.current.onDug() }
        if (dugFired && !parts.length) { cancelAnimationFrame(raf); cb.current.onDone() }
      }
      raf = requestAnimationFrame(frame)
    }

    // measure only after the web font is in, so the soil patch matches the final title size
    document.fonts.ready.then(() => { if (!cancelled) run() })
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [host])

  return <canvas ref={ref} className="dig-canvas" aria-hidden="true" />
}

// The hero text block: the title is dug out of the soil, then "Shift" turns orange and is underlined (timing in HomePage.css),
// then the tagline and the description fade in. Reduced motion: everything is shown at once.
export default function DigBlock() {
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [digging, setDigging] = useState(!reduce)
  const [dug, setDug] = useState(reduce)

  return (
    <>
      <h1 className="dig-title" aria-label={TITLE_BEFORE + TITLE_SHIFT} ref={setHost}>
        <span aria-hidden="true">
          {TITLE_BEFORE}
          <span className={`tt-shift${dug ? ' tt-done' : ''}`}>{TITLE_SHIFT}</span>
        </span>
        {digging && host && <DigCanvas host={host} onDug={() => setDug(true)} onDone={() => setDigging(false)} />}
      </h1>
      <p className={`home-tag home-rest${dug ? ' on' : ''}`}>{TAG}</p>
      <p className={`home-desc home-rest${dug ? ' on' : ''}`}>{DESC}</p>
    </>
  )
}
