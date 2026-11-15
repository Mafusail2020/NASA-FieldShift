import type { ReactNode } from 'react'

// Small safe renderer for the model's answer: paragraphs, "- " lists, **bold**, *italic*, `code`. Builds elements, never HTML.
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g
  let last = 0, m: RegExpExecArray | null, k = 0
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const t = m[0]
    out.push(t.startsWith('**') ? <strong key={k++}>{t.slice(2, -2)}</strong> : t.startsWith('`') ? <code key={k++}>{t.slice(1, -1)}</code> : <em key={k++}>{t.slice(1, -1)}</em>)
    last = m.index + t.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

export default function MiniMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = () => { if (list.length) { blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = [] } }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const li = /^[-*•]\s+(.*)/.exec(line) ?? /^\d+[.)]\s+(.*)/.exec(line)
    if (li) { list.push(li[1]); continue }
    flush()
    if (!line) continue
    const h = /^#{1,4}\s+(.*)/.exec(line)
    blocks.push(h ? <p key={blocks.length}><strong>{inline(h[1])}</strong></p> : <p key={blocks.length}>{inline(line)}</p>)
  }
  flush()
  return <div className="md">{blocks}</div>
}
