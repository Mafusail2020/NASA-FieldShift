// Small "i" with the detail text in a tooltip: keeps the page free of explanatory paragraphs. Works on hover and keyboard focus.
export default function Info({ text }: { text: string }) {
  return (
    <span className="fin-info" tabIndex={0} role="note" aria-label={text}>
      i<span className="fin-info-tip" aria-hidden="true">{text}</span>
    </span>
  )
}
