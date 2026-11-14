import { useEffect, useRef } from 'react'

// Glyph-matrix shader. Behind the glyphs flows a plasma of very light grey, emerald/neon green and burnt orange/amber (a warped
// noise field through a colour ramp). The plasma lives on a tiny canvas (one pixel per glyph cell) that CSS scales and blurs on
// the GPU; the glyphs are drawn from a pre-rendered sprite sheet in ONE uniform translucent charcoal. The pointer does not push
// the surface up: moving it makes a 2D wave simulation ripple, refracting the plasma and catching light on the wave slopes,
// like rubbing the surface of water. The whole thing fades from the white page along an edge tilted 20 degrees from vertical
// (wide screens) or from horizontal (narrow screens). 60 fps, paused when the tab is hidden, a still frame for reduced motion.

const RAMP = ' .:-=+*#%@'
const ANGLE = (20 * Math.PI) / 180
const GLYPH_COLOR = 'rgba(11, 12, 12, 0.4)'
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)
// colour ramp stops: [position, r, g, b]. Greys are very light; the ramp is cyclic.
const STOPS: [number, number, number, number][] = [
  [0.0, 0xe9, 0xeb, 0xec], [0.16, 0xd6, 0xd9, 0xdb], [0.36, 0x1b, 0x7a, 0x43], [0.5, 0x2d, 0xc6, 0x53],
  [0.64, 0xe8, 0x5d, 0x04], [0.76, 0xf4, 0x8c, 0x06], [0.88, 0xd6, 0xd9, 0xdb], [1.0, 0xe9, 0xeb, 0xec],
]
// ramp lookup table: 256 entries, so the per-cell colour is one array read
const LUT = new Uint8Array(256 * 3)
for (let i = 0; i < 256; i++) {
  const t = i / 255
  let k = 1
  while (k < STOPS.length - 1 && t > STOPS[k][0]) k++
  const [p0, r0, g0, b0] = STOPS[k - 1], [p1, r1, g1, b1] = STOPS[k]
  const u = Math.min(1, Math.max(0, (t - p0) / (p1 - p0)))
  LUT[i * 3] = r0 + (r1 - r0) * u; LUT[i * 3 + 1] = g0 + (g1 - g0) * u; LUT[i * 3 + 2] = b0 + (b1 - b0) * u
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const hash = (x: number, y: number, z: number) => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
function vnoise(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = x - xi, yf = y - yi, zf = z - zi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf)
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz)
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  )
}
const fbm = (x: number, y: number, z: number) => {
  let s = 0, a = 0.5, f = 1
  for (let o = 0; o < 4; o++) { s += a * vnoise(x * f, y * f, z * f); a *= 0.5; f *= 2 }
  return s / 0.9375
}

export default function AsciiField() {
  const bgRef = useRef<HTMLCanvasElement>(null)
  const fgRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const bg = bgRef.current!, fg = fgRef.current!
    const bctx = bg.getContext('2d')!, ctx = fg.getContext('2d')!
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0, cols = 0, rows = 0, cw = 10, ch = 16, cc = 0, cr = 0
    let img: ImageData | null = null
    let glyph = new Uint8Array(0), coarse = new Float32Array(0)
    let hgt = new Float32Array(0), prev = new Float32Array(0) // wave height now / one step ago
    let atlas: HTMLCanvasElement | null = null
    let raf = 0, last = 0, acc = 0
    let pointer: { x: number; y: number } | null = null

    const size = () => {
      const r = fg.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = r.width; h = r.height
      fg.width = Math.round(w * dpr); fg.height = Math.round(h * dpr)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const small = w < 700
      cw = small ? 8 : 10; ch = small ? 13 : 16
      cols = Math.ceil(w / cw); rows = Math.ceil(h / ch)
      cc = Math.ceil(cols / 2) + 2; cr = Math.ceil(rows / 2) + 2
      glyph = new Uint8Array(cols * rows); coarse = new Float32Array(cc * cr)
      hgt = new Float32Array(cols * rows); prev = new Float32Array(cols * rows)
      bg.width = cols; bg.height = rows
      img = bctx.createImageData(cols, rows)
      // sprite sheet: one glyph per slot, drawn once in the uniform colour
      const aw = Math.round(cw * dpr), ah = Math.round(ch * dpr)
      atlas = document.createElement('canvas'); atlas.width = aw * RAMP.length; atlas.height = ah
      const a = atlas.getContext('2d')!
      a.font = `${Math.round((ch - 2) * dpr)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`
      a.textBaseline = 'top'; a.fillStyle = GLYPH_COLOR
      for (let g = 1; g < RAMP.length; g++) a.fillText(RAMP[g], g * aw, 0)
    }

    // pointer = a finger moving through water: it drops a small dent along its path, the dent spreads as rings and dies out
    const onMove = (e: PointerEvent) => {
      const r = fg.getBoundingClientRect()
      const x = (e.clientX - r.left) / cw, y = (e.clientY - r.top) / ch
      if (x < 0 || y < 0 || x > cols || y > rows) { pointer = null; return }
      if (pointer) {
        const dx = x - pointer.x, dy = (y - pointer.y) * (ch / cw)
        const len = Math.hypot(dx, dy)
        const n = Math.max(1, Math.ceil(len))
        const amp = -0.32 * Math.min(1, len / 2.5)
        for (let s = 1; s <= n; s++) {
          const px = pointer.x + ((x - pointer.x) * s) / n, py = pointer.y + ((y - pointer.y) * s) / n
          const i0 = Math.floor(px), j0 = Math.floor(py)
          for (let j = j0 - 2; j <= j0 + 2; j++) for (let i = i0 - 3; i <= i0 + 3; i++) {
            if (i < 1 || j < 1 || i >= cols - 1 || j >= rows - 1) continue
            const ex = (i + 0.5 - px) / 1.4, ey = (j + 0.5 - py) / 0.95
            hgt[j * cols + i] += (amp / n) * 2.2 * Math.exp(-(ex * ex + ey * ey))
          }
        }
      }
      pointer = { x, y }
    }
    const onLeave = () => { pointer = null }

    // 2D wave equation with different spacing in x and y (cells are taller than wide), damped
    const step = () => {
      const kx = 0.45 / (1 + (cw * cw) / (ch * ch)), ky = kx * (cw * cw) / (ch * ch)
      for (let j = 1; j < rows - 1; j++) {
        for (let i = 1; i < cols - 1; i++) {
          const k = j * cols + i, c = hgt[k]
          const lap = (hgt[k - 1] + hgt[k + 1] - 2 * c) * kx + (hgt[k - cols] + hgt[k + cols] - 2 * c) * ky
          prev[k] = (2 * c - prev[k] + lap) * 0.991
        }
      }
      const t = hgt; hgt = prev; prev = t
    }

    const sample = (x: number, y: number) => {
      const fx = Math.min(cc - 1.001, Math.max(0, x / 2)), fy = Math.min(cr - 1.001, Math.max(0, y / 2))
      const x0 = fx | 0, y0 = fy | 0, u = fx - x0, v = fy - y0, k = y0 * cc + x0
      return (coarse[k] * (1 - u) + coarse[k + 1] * u) * (1 - v) + (coarse[k + cc] * (1 - u) + coarse[k + cc + 1] * u) * v
    }

    const draw = (time: number) => {
      if (!img) return
      const narrow = w < 900
      const fade = (narrow ? h : w) * (narrow ? 0.3 : 0.32)
      const edge = (narrow ? h : w) * (narrow ? 0.42 : 0.4)
      const cs = Math.cos(ANGLE), sn = Math.sin(ANGLE)
      const dist = (i: number, j: number) => {
        const x = (i + 0.5) * cw, y = (j + 0.5) * ch
        return narrow ? (y - edge) * cs - (x - w / 2) * sn : (x - edge) * cs + (y - h / 2) * sn
      }
      const t = time * 0.00012
      // terrain noise on a half-resolution lattice (bilinear sampling fills the rest), only where the shader is visible
      for (let b = 0; b < cr; b++) {
        for (let a = 0; a < cc; a++) {
          if (dist(a * 2, b * 2) < -fade * 0.25) { coarse[b * cc + a] = 0; continue }
          const nx = a * 2 * 0.035, ny = b * 2 * 0.06
          const wx = fbm(nx + 3.1, ny, t) * 2.2, wy = fbm(nx, ny + 7.7, t * 1.3) * 2.2
          coarse[b * cc + a] = fbm(nx + wx * 0.55, ny + wy * 0.55, t * 0.8)
        }
      }
      const data = img.data
      const drift = time * 0.00005
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i, o = k * 4
          glyph[k] = 0
          const m = smooth(0, fade, dist(i, j))
          data[o + 3] = Math.round(255 * m)
          if (m <= 0) continue
          // wave surface: slope bends the view of the plasma (refraction) and catches light (specular)
          const c = hgt[k]
          const gx = i > 0 && i < cols - 1 ? (hgt[k + 1] - hgt[k - 1]) * 0.5 : 0
          const gy = j > 0 && j < rows - 1 ? (hgt[k + cols] - hgt[k - cols]) * 0.5 : 0
          const v = sample(i + gx * 22, j + gy * 14)
          const pt = (((v * 2.4 + drift) % 1) + 1) % 1
          const li = ((pt * 255) | 0) * 3
          const lift = Math.max(-26, Math.min(70, (gx * 0.7 + gy * 0.9) * -260 + Math.abs(c) * 40))
          data[o] = Math.max(0, Math.min(255, LUT[li] + lift)); data[o + 1] = Math.max(0, Math.min(255, LUT[li + 1] + lift)); data[o + 2] = Math.max(0, Math.min(255, LUT[li + 2] + lift))
          if (m <= BAYER[(j & 3) * 4 + (i & 3)] * 0.9) continue // ordered-dither dissolve of the glyphs
          const lines = 0.5 + 0.5 * Math.sin(v * 22 - time * 0.0006 + c * 5) // flowing contour lines, rippled by the waves
          const dens = Math.pow(lines, 1.6) * (0.35 + 0.65 * Math.min(1, m * 1.6))
          glyph[k] = Math.max(0, Math.min(RAMP.length - 1, Math.floor(dens * RAMP.length)))
        }
      }
      bctx.putImageData(img, 0, 0)
      ctx.clearRect(0, 0, fg.width, fg.height)
      const sx = fg.width / w, sy = fg.height / h
      const aw = atlas!.width / RAMP.length, ah = atlas!.height
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const g = glyph[j * cols + i]
        if (g) ctx.drawImage(atlas!, g * aw, 0, aw, ah, i * cw * sx, j * ch * sy, aw, ah)
      }
    }

    const loop = (time: number) => {
      raf = requestAnimationFrame(loop)
      if (document.hidden) { last = 0; return }
      const dt = last ? Math.min(100, time - last) : 16.7
      last = time
      acc += dt
      for (let n = 0; acc >= 16.7 && n < 3; n++, acc -= 16.7) step() // wave physics at a fixed 60 Hz, whatever the display rate
      draw(time)
    }

    size()
    if (reduce) draw(40000)
    else {
      raf = requestAnimationFrame(loop)
      window.addEventListener('pointermove', onMove)
      document.addEventListener('pointerleave', onLeave)
    }
    const ro = new ResizeObserver(() => { size(); if (reduce) draw(40000) })
    ro.observe(fg)
    return () => {
      cancelAnimationFrame(raf); ro.disconnect()
      window.removeEventListener('pointermove', onMove); document.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <>
      <canvas ref={bgRef} className="ascii-bg" aria-hidden="true" />
      <canvas ref={fgRef} className="ascii-field" aria-hidden="true" />
    </>
  )
}
