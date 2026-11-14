import { useEffect, useState } from 'react'

const TITLE = 'Field Shift'
const SHIFT_FROM = TITLE.indexOf('Shift')
const TAG = 'Making farming more predictable'
const DESC = 'Enter your fields. Get NASA-based climate, soil, crop rotation and income estimates for each one, in one place.'

// One line after another: [text, ms per letter, pause before the line starts].
const LINES: [string, number, number][] = [[TITLE, 90, 300], [TAG, 45, 350], [DESC, 16, 300]]

// Types the whole hero block in. A single caret rides on the right edge of the last typed letter, so it moves from the title to the
// tagline to the description as each one types. Untyped letters keep their space (hidden only), so nothing shifts while typing.
// When the title is in, "Shift" turns orange and is underlined (timing in HomePage.css).
export default function TypedBlock() {
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [counts, setCounts] = useState<number[]>(reduce ? LINES.map((l) => l[0].length) : LINES.map(() => 0))
  const [line, setLine] = useState(reduce ? LINES.length : 0) // line being typed; LINES.length = all done
  const [shiftDone, setShiftDone] = useState(reduce)

  useEffect(() => {
    if (reduce) return
    let timer: ReturnType<typeof setTimeout>
    let li = 0, n = 0
    const step = () => {
      n += 1
      const cur = li, val = n // copy: the updater runs later, after li and n have moved on to the next line
      setCounts((c) => c.map((v, i) => (i === cur ? val : v)))
      if (n < LINES[li][0].length) { timer = setTimeout(step, LINES[li][1]); return }
      if (li === 0) setTimeout(() => setShiftDone(true), 250)
      li += 1; n = 0
      if (li >= LINES.length) { setLine(LINES.length); return }
      setLine(li)
      timer = setTimeout(step, LINES[li][2])
    }
    setLine(0)
    timer = setTimeout(step, LINES[0][2])
    return () => clearTimeout(timer)
  }, [reduce])

  // caret: right edge of the last typed letter of the line being typed; left edge of the first letter before it types anything
  const letters = (li: number, from = 0, to = LINES[li][0].length) =>
    [...LINES[li][0].slice(from, to)].map((ch, k) => {
      const i = from + k
      const c = counts[li]
      const caret = !reduce && line === li ? (c === 0 ? (i === 0 ? ' tt-caret-l' : '') : i === c - 1 ? ' tt-caret-r' : '') : ''
      return <span key={i} className={(i < c ? 'tt-on' : 'tt-off') + caret}>{ch}</span>
    })

  return (
    <>
      <h1 className="typed-title" aria-label={TITLE}>
        <span aria-hidden="true">
          {letters(0, 0, SHIFT_FROM)}
          <span className={`tt-shift${shiftDone ? ' tt-done' : ''}`}>{letters(0, SHIFT_FROM)}</span>
        </span>
      </h1>
      <p className="home-tag" aria-label={TAG}><span aria-hidden="true">{letters(1)}</span></p>
      <p className="home-desc" aria-label={DESC}><span aria-hidden="true">{letters(2)}</span></p>
    </>
  )
}
