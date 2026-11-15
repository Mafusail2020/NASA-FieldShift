import { useAgent } from '../../lib/agent'

// Left column with the chat history (like Claude's sidebar). Wide containers show it; narrow ones (the floating window) slide it over the chat.
export default function ChatHistory({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { chats, activeId, newChat, openChat, deleteChat } = useAgent()
  return (
    <>
      {open && <div className="ag-scrim" onClick={onClose} aria-hidden="true" />}
      <nav className={`ag-side${open ? ' open' : ''}`} aria-label="Chat history">
        <button type="button" className="ag-new" onClick={() => { newChat(); onClose() }} aria-current={activeId ? undefined : 'true'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>New chat
        </button>
        <p className="ag-side-label">Recents</p>
        {chats.length === 0 ? (
          <p className="ag-side-empty">Your chats will appear here.</p>
        ) : (
          <ul className="ag-chats">
            {chats.map((c) => (
              <li key={c.id} className={c.id === activeId ? 'on' : undefined}>
                <button type="button" className="ag-chat" aria-current={c.id === activeId ? 'true' : undefined} title={c.title} onClick={() => { openChat(c.id); onClose() }}>{c.title}</button>
                <button type="button" className="ag-del" aria-label={`Delete chat: ${c.title}`} title="Delete" onClick={() => deleteChat(c.id)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </>
  )
}
