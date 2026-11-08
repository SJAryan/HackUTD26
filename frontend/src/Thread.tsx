import { useState } from 'react';
import { Message, postJobMessage, useFixture } from './store';

const NAMES: Record<Message['sender'], string> = { resident: 'Resident', driver: 'Ana' };

export function Thread({ jobId, me, placeholder }: { jobId: string; me: Message['sender']; placeholder: string }) {
  const { messages } = useFixture();
  const [text, setText] = useState('');
  const thread = messages.filter((m) => m.jobId === jobId);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    postJobMessage(jobId, crypto.randomUUID(), me, body);
    setText('');
  }

  return (
    <section className="thread" aria-label="Conversation">
      <h2>Messages</h2>
      {thread.length === 0 ? (
        <p className="muted">No messages yet. Anything you send appears on the other screen right away.</p>
      ) : (
        <ol className="messages">
          {thread.map((m) => (
            <li key={m.clientMessageId} className={m.sender === me ? 'msg mine' : 'msg theirs'}>
              <span className="sender">{m.sender === me ? 'You' : NAMES[m.sender]}</span>
              {m.text}
            </li>
          ))}
        </ol>
      )}
      <form className="composer" onSubmit={send}>
        <label className="visually-hidden" htmlFor={`compose-${me}`}>
          Message
        </label>
        <input id={`compose-${me}`} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoComplete="off" />
        <button type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
