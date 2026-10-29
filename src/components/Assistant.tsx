import { useEffect, useRef, useState } from 'react';
import { Bot, Eraser, Send, Settings2, Sparkles } from 'lucide-react';
import { useStudio } from '../lib/studio';
import { Markdown } from './Markdown';

const QUICK = [
  'How do I sign a release APK?',
  'Build the debug APK',
  'Run the unit tests',
  'Open the APK on appetizer.io',
];

export function Assistant() {
  const { chat, chatBusy, sendChat, clearChat, aiEndpoint, setAiEndpoint, aiModel, setAiModel, aiKey, setAiKey } =
    useStudio();
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat, chatBusy]);

  const submit = () => {
    const text = input.trim();
    if (!text || chatBusy) return;
    setInput('');
    void sendChat(text);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-1)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <Bot size={15} className="text-[var(--accent)]" />
        <div className="leading-none">
          <div className="text-[12.5px] font-semibold text-[var(--text)]">OpenCode</div>
          <div className="mt-[3px] font-mono text-[10px] text-[var(--muted)]">{aiModel}</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setShowSettings((v) => !v)} className="icon-btn" title="Endpoint settings">
            <Settings2 size={13} />
          </button>
          <button onClick={clearChat} className="icon-btn" title="Clear conversation">
            <Eraser size={13} />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="space-y-2 border-b border-[var(--border)] bg-[var(--bg-2)] p-3 text-[11px]">
          <label className="block">
            <span className="mb-1 block text-[var(--muted)]">OpenAI-compatible endpoint</span>
            <input
              value={aiEndpoint}
              onChange={(e) => setAiEndpoint(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-0)] px-2 py-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[var(--muted)]">Model</span>
            <input
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-0)] px-2 py-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[var(--muted)]">API key (optional for a local opencode serve)</span>
            <input
              value={aiKey}
              onChange={(e) => setAiKey(e.target.value)}
              placeholder="sk-…"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-0)] px-2 py-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <p className="leading-relaxed text-[var(--muted)]">
            Point this at a local OpenCode instance: <span className="font-mono text-[var(--accent)]">opencode serve --port 4096</span>{' '}
            then use <span className="font-mono text-[var(--accent)]">http://127.0.0.1:4096/v1</span>. When no endpoint answers,
            the studio falls back to its offline assistant.
          </p>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {chat.map((message, index) => (
          <div key={index} className={message.role === 'user' ? 'flex justify-end' : ''}>
            {message.role === 'user' ? (
              <div className="max-w-[85%] rounded-xl rounded-br-sm bg-[var(--accent)]/15 px-3 py-2 text-[12.5px] text-[var(--text)]">
                {message.content}
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[var(--accent)]/15">
                  <Sparkles size={12} className="text-[var(--accent)]" />
                </div>
                <div className="min-w-0 flex-1 text-[var(--muted)]">
                  <Markdown text={message.content} />
                </div>
              </div>
            )}
          </div>
        ))}
        {chatBusy && (
          <div className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
            opencode is thinking…
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] p-2.5">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button
              key={q}
              onClick={() => void sendChat(q)}
              className="rounded-full border border-[var(--border)] bg-[var(--bg-2)] px-2.5 py-1 text-[10.5px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-2)] p-2 focus-within:border-[var(--accent)]">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Ask opencode… (Enter to send)"
            className="max-h-28 min-h-[22px] flex-1 resize-none bg-transparent text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--muted)]/60"
          />
          <button
            onClick={submit}
            disabled={chatBusy || !input.trim()}
            className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--accent)] text-[#06210f] disabled:opacity-40"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
