import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useStudio } from '../lib/studio';

export function SearchPanel() {
  const { files, openFile } = useStudio();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: { path: string; line: number; text: string }[] = [];
    for (const [path, content] of Object.entries(files)) {
      content.split('\n').forEach((line, index) => {
        if (line.toLowerCase().includes(q)) out.push({ path, line: index + 1, text: line.trim() });
      });
      if (out.length > 400) break;
    }
    return out;
  }, [files, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Search</div>
      <div className="px-2.5 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] px-2 py-1.5 focus-within:border-[var(--accent)]">
          <Search size={13} className="text-[var(--muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in files"
            className="w-full bg-transparent text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--muted)]/60"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {query && (
          <div className="px-2 pb-1 text-[10.5px] text-[var(--muted)]">
            {results.length} result{results.length === 1 ? '' : 's'}
          </div>
        )}
        {results.map((result, index) => (
          <button
            key={index}
            onClick={() => openFile(result.path)}
            className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left hover:bg-white/[0.04]"
          >
            <span className="shrink-0 font-mono text-[10px] text-[var(--muted)]">{result.line}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[10.5px] text-[var(--accent)]">{result.path}</span>
              <span className="block truncate font-mono text-[11px] text-[var(--muted)]">{result.text}</span>
            </span>
          </button>
        ))}
        {query && !results.length && (
          <p className="px-2 text-[11.5px] text-[var(--muted)]">No matches for “{query}”.</p>
        )}
      </div>
    </div>
  );
}
