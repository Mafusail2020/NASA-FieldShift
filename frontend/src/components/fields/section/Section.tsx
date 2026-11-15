// One numbered block of the field page: colour rail, icon, kicker, large title and the question the block answers.
// The number comes from a CSS counter (section.css), so it follows the blocks that are actually shown.
import { useId, useState, type ReactNode } from 'react'
import './section.css'

export type SecTone = 'primary' | 'water' | 'heat' | 'dry' | 'good'
export type SecSurface = 'open' | 'wash' | 'lift'
export type SecIcon = 'passport' | 'climate' | 'rotation' | 'cropfit' | 'twins' | 'soil'

// 24x24 line icons, stroke = currentColor
const ICONS: Record<SecIcon, string> = {
  passport: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  climate: 'M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 9.5a4.2 4.2 0 0 1 0 8.5zM12 3v1.5M5 5.5l1 1M19 5.5l-1 1',
  rotation: 'M20 12a8 8 0 0 1-13.7 5.6M4 12a8 8 0 0 1 13.7-5.6M17 3v4h-4M7 21v-4h4',
  cropfit: 'M12 21v-9M12 12c0-4 2.5-6.5 7-7 0 4.5-2.5 7-7 7zM12 15c0-3-2-5-6-5.5 0 3.5 2 5.5 6 5.5z',
  twins: 'M9 8a5 5 0 1 0 0 8 5 5 0 0 0 0-8zM15 8a5 5 0 1 1 0 8',
  soil: 'M3 7l9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4',
}

interface Props {
  title: string
  question: string
  kicker: string
  icon: SecIcon
  tone: SecTone
  surface: SecSurface
  wide?: boolean
  rail?: boolean   // accent bar on the left (default on)
  flat?: boolean   // wash without the contour lines
  fold?: boolean   // closed at first; the header opens it
  children: ReactNode
}

export function Section({ title, question, kicker, icon, tone, surface, wide, rail = true, flat, fold, children }: Props) {
  const id = useId()
  const [open, setOpen] = useState(!fold)
  const cls = `sec sec-${tone} sec-${surface}${wide ? ' fr-wide' : ''}${rail ? '' : ' sec-norail'}${flat ? ' sec-flat' : ''}${fold ? ` sec-foldable${open ? '' : ' sec-folded'}` : ''}`
  const body = <div className="sec-body">{children}</div>
  return (
    <section className={cls} aria-labelledby={id}>
      <header className="sec-head">
        <span className="sec-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d={ICONS[icon]} /></svg>
        </span>
        <div className="sec-titles">
          <p className="sec-kicker">{kicker}</p>
          <h2 id={id} className="sec-title">
            {fold
              ? <button type="button" className="sec-toggle" aria-expanded={open} aria-controls={`${id}b`} onClick={() => setOpen((o) => !o)}>{title}</button>
              : title}
          </h2>
          <p className="sec-q">{question}</p>
        </div>
        {fold && <span className="sec-state" aria-hidden="true">{open ? 'Hide' : 'Show'}</span>}
      </header>
      {fold
        ? <div id={`${id}b`} className="sec-fold" inert={!open}><div className="sec-fold-in">{body}</div></div>
        : body}
    </section>
  )
}
