import { useEffect, useRef, useState } from 'react'

const TITLE_BEFORE = 'Field '
const TITLE_SHIFT = 'Shift'
const TAG = ['Making farming', 'predictable'] // two lines on purpose: "predictable" sits on the second row
const DESC = 'Enter your fields. Get NASA-based climate, soil, crop rotation and income estimates for each one, in one place.'

// Soil: dark earth tiles with slightly lighter glyphs, a few terracotta ones.
const SOIL_BG = ['#2e2219', '#3a2b1e', '#46342a', '#33261c', '#523a2b', '#2a1f17']
const SOIL_FG = ['#6b5240', '#7d6049', '#5a4333', '#8a6a4f']
const SOIL_GLYPHS = '#@%▓&8#@%'
const TERRACOTTA = '#7a3f21'

// Small charges go off at random places in the soil, one after another. Each blast clears a crater of tiles and throws them out
// as big spinning chunks that fall under gravity until they leave the canvas.
const START = 0.3   // s before the first blast
const SPAN = 1.5    // s over which the blasts are spread
const GRAVITY = 1500 // px/s^2 for the chunks
const DEBRIS_SHARE = 0.5 // share of cleared tiles that turn into flying chunks

const rnd = (a: number, b: number) => a + Math.random() * (b - a)

// The title's letters sit under an opaque patch of soil made of glyph cells. The blasts are planned up front so that together
// they cover every tile (random places, random order, random timing); onDug fires after the last blast.
function DigCanvas({ host, onReady, onDug, onDone }: { host: HTMLElement; onReady(): void; onDug(): void; onDone(): void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  // the parent re-renders when the title is dug: keep the latest callbacks in refs so that never restarts the animation
  const cb = useRef({ onReady, onDug, onDone })
  cb.current = { onReady, onDug, onDone }

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0, cancelled = false

    const run = () => {
      const r = host.getBoundingClientRect()
      const w = r.width, h = r.height
      const fs = parseFloat(getComputedStyle(host).fontSize)
      const ch = Math.max(11, Math.round(fs / 8)), cw = Math.round(ch * 0.62)
      // the canvas covers the whole viewport (position: fixed), so chunks fly and fall across the full screen, never clipped
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cssW = window.innerWidth, cssH = window.innerHeight
      canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // soil grid: covers the title plus one cell of margin; the outer ring is ragged
      // viewport coordinates of the grid origin; re-read from the title every frame, so a layout shift (late font, scroll) never leaves
      // the soil in the wrong place
      let ox = r.left - cw, oy = r.top - ch
      const cols = Math.ceil((w + cw * 2) / cw), rows = Math.ceil((h + ch * 2) / ch)
      const N = cols * rows
      const bg = new Array<string>(N), fg = new Array<string>(N), gl = new Array<string>(N)
      const alive = new Uint8Array(N)
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i
          const ring = i === 0 || j === 0 || i === cols - 1 || j === rows - 1
          alive[k] = ring && Math.random() < 0.4 ? 0 : 1
          bg[k] = Math.random() < 0.06 ? TERRACOTTA : SOIL_BG[(Math.random() * SOIL_BG.length) | 0]
          fg[k] = SOIL_FG[(Math.random() * SOIL_FG.length) | 0]
          gl[k] = SOIL_GLYPHS[(Math.random() * SOIL_GLYPHS.length) | 0]
        }
      }
      const cx = (i: number) => ox + (i + 0.5) * cw, cy = (j: number) => oy + (j + 0.5) * ch

      // plan: keep adding blasts at random uncovered tiles until every tile is inside some blast radius
      type Blast = { x: number; y: number; R: number; t: number; fired: boolean }
      const covered = new Uint8Array(N)
      const blasts: Blast[] = []
      let left = alive.reduce((n, v) => n + v, 0)
      while (left > 0) {
        let k = (Math.random() * N) | 0
        while (!alive[k] || covered[k]) k = (k + 1) % N
        const R = rnd(2.3, 3.8) * ch
        const bx = cx(k % cols) + rnd(-0.6, 0.6) * cw, by = cy((k / cols) | 0) + rnd(-0.6, 0.6) * ch
        blasts.push({ x: bx, y: by, R, t: 0, fired: false })
        for (let q = 0; q < N; q++) {
          if (!alive[q] || covered[q]) continue
          if (Math.hypot(cx(q % cols) - bx, cy((q / cols) | 0) - by) <= R) { covered[q] = 1; left-- }
        }
      }
      for (let n = blasts.length - 1; n > 0; n--) { const m = (Math.random() * (n + 1)) | 0; [blasts[n], blasts[m]] = [blasts[m], blasts[n]] } // random order
      const ox0 = ox, oy0 = oy
      blasts.forEach((b) => { b.x -= ox0; b.y -= oy0 }) // blast centres are kept relative to the title
      blasts.forEach((b, n) => { b.t = START + ((n + Math.random() * 0.7) / blasts.length) * SPAN })
      blasts.sort((a, b) => a.t - b.t)
      const tEnd = blasts[blasts.length - 1].t + 0.1

      type Chunk = { x: number; y: number; vx: number; vy: number; a: number; w: number; sc: number; age: number; life: number; bg: string; fg: string; gl: string }
      const chunks: Chunk[] = []
      let prev = 0, dugFired = false, readyFired = false
      const t0 = performance.now()

      const explode = (b: Blast) => {
        b.fired = true
        for (let k = 0; k < N; k++) {
          if (!alive[k]) continue
          const px = cx(k % cols), py = cy((k / cols) | 0)
          const dx = px - (b.x + ox), dy = py - (b.y + oy), dist = Math.hypot(dx, dy)
          if (dist > b.R) continue
          alive[k] = 0
          if (Math.random() > DEBRIS_SHARE) continue // the tile is gone, but only some of them become flying chunks
          const ang = dist < 1 ? rnd(0, Math.PI * 2) : Math.atan2(dy, dx)
          const sp = (160 + 520 * (1 - dist / b.R)) * rnd(0.6, 1.1)
          chunks.push({ x: px, y: py, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - rnd(60, 220), a: rnd(0, 6.28), w: rnd(-9, 9), sc: rnd(1.7, 2.9), age: 0, life: rnd(1.2, 2.0), bg: bg[k], fg: fg[k], gl: gl[k] })
        }
      }

      const frame = (now: number) => {
        if (cancelled) return
        raf = requestAnimationFrame(frame)
        const t = (now - t0) / 1000, dt = Math.min(0.05, t - prev)
        prev = t
        const hr = host.getBoundingClientRect()
        ox = hr.left - cw; oy = hr.top - ch
        for (const b of blasts) if (!b.fired && b.t <= t) explode(b)

        ctx.clearRect(0, 0, cssW, cssH)
        ctx.font = `${ch - 1}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`
        ctx.textBaseline = 'top'
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const k = j * cols + i
          if (!alive[k]) continue
          const x = ox + i * cw, y = oy + j * ch
          ctx.fillStyle = bg[k]; ctx.fillRect(x, y, cw + 0.5, ch + 0.5)
          ctx.fillStyle = fg[k]; ctx.fillText(gl[k], x, y)
        }
        // chunks: ballistic motion with a little air drag; they tumble until they fall out of the canvas
        for (let n = chunks.length - 1; n >= 0; n--) {
          const c = chunks[n]
          c.age += dt
          c.vy += GRAVITY * dt; c.vx *= Math.exp(-0.5 * dt)
          c.x += c.vx * dt; c.y += c.vy * dt; c.a += c.w * dt
          // a chunk lives for its lifespan, losing opacity as it goes, or until it has left the screen
          if (c.age >= c.life || c.y > cssH + ch * 4 || c.x < -ch * 4 || c.x > cssW + ch * 4) { chunks.splice(n, 1); continue }
          ctx.globalAlpha = 1 - c.age / c.life
          ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a); ctx.scale(c.sc, c.sc)
          ctx.fillStyle = c.bg; ctx.fillRect(-cw / 2, -ch / 2, cw, ch)
          ctx.fillStyle = c.fg; ctx.fillText(c.gl, -cw / 2, -ch / 2)
          ctx.restore()
        }
        ctx.globalAlpha = 1
        if (!readyFired) { readyFired = true; cb.current.onReady() } // the soil is on screen now: the title may be shown (it sits under it)
        if (!dugFired && t >= tEnd) { dugFired = true; cb.current.onDug() }
        if (dugFired && !chunks.length) { cancelAnimationFrame(raf); cb.current.onDone() }
      }
      raf = requestAnimationFrame(frame)
    }

    // measure only after the web font is in, so the soil patch matches the final title size. fonts.ready alone can resolve before the
    // download has even started, so ask for the weights explicitly, give up waiting after 2.5 s, then wait two frames for the layout to settle
    const fontsIn = Promise.race([
      Promise.all([document.fonts.load('700 1em "DM Sans"'), document.fonts.load('400 1em "DM Sans"')]).then(() => document.fonts.ready),
      new Promise((res) => setTimeout(res, 2500)),
    ])
    fontsIn.then(() => { if (!cancelled) requestAnimationFrame(() => requestAnimationFrame(() => { if (!cancelled) run() })) })
    // a resize reflows the title: no point in digging into the old shape, show the title at once
    const onResize = () => { if (cancelled) return; cancelled = true; cancelAnimationFrame(raf); cb.current.onReady(); cb.current.onDug(); cb.current.onDone() }
    window.addEventListener('resize', onResize)
    return () => { cancelled = true; cancelAnimationFrame(raf); window.removeEventListener('resize', onResize) }
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
  const [covered, setCovered] = useState(reduce) // the soil is drawn over the title: until then the title text stays hidden

  // failsafe: whatever goes wrong (font never arrives, canvas fails), the title and the text below it appear after 4 s
  useEffect(() => {
    if (covered) return
    const t = setTimeout(() => { setCovered(true); setDug(true); setDigging(false) }, 4000)
    return () => clearTimeout(t)
  }, [covered])

  return (
    <>
      <h1 className={`dig-title${covered ? '' : ' dig-pending'}`} aria-label={TITLE_BEFORE + TITLE_SHIFT} ref={setHost}>
        <span aria-hidden="true">
          {TITLE_BEFORE}
          <span className={`tt-shift${dug ? ' tt-done' : ''}`}>{TITLE_SHIFT}</span>
        </span>
        {digging && host && <DigCanvas host={host} onReady={() => setCovered(true)} onDug={() => setDug(true)} onDone={() => setDigging(false)} />}
      </h1>
      <p className={`home-tag home-rest${dug ? ' on' : ''}`}>{TAG[0]}<br />{TAG[1]}</p>
      <p className={`home-desc home-rest${dug ? ' on' : ''}`}>{DESC}</p>
    </>
  )
}
