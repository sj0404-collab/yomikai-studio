import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CornerDownLeft, Search } from 'lucide-react';
import { useStudio } from '../lib/studio';

interface Command {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

function CommandPaletteDialog({ onClose }: { onClose: () => void }) {
  const studio = useStudio();
  const { setActivity, setRightTab, setRightDockOpen, setDeliverOpen, setDocsOpen } = studio;
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'build-debug',
        label: 'Build debug APK (v1 + v2 signed)',
        hint: 'gradle assembleDebug',
        run: () => void studio.buildGradle('assembleDebug'),
      },
      {
        id: 'build-release',
        label: 'Build release APK (v1 + v2 signed)',
        hint: 'gradle assembleRelease',
        run: () => void studio.buildGradle('assembleRelease'),
      },
      {
        id: 'build-all',
        label: 'Full build (debug + release + tests + lint)',
        hint: 'gradle build',
        run: () => void studio.buildGradle('build'),
      },
      { id: 'test', label: 'Run unit tests', hint: 'gradle test', run: () => void studio.buildGradle('test') },
      { id: 'lint', label: 'Run Android lint', hint: 'gradle lint', run: () => void studio.buildGradle('lint') },
      { id: 'maven', label: 'Build with Maven', hint: 'mvn package', run: () => void studio.buildMaven('package') },
      {
        id: 'run',
        label: 'Open device emulator dock',
        hint: 'device dock',
        run: () => {
          setRightDockOpen(true);
          setRightTab('device');
        },
      },
      {
        id: 'assistant',
        label: 'Open OpenCode assistant',
        hint: 'AI panel',
        run: () => {
          setActivity('assistant');
          setRightTab('assistant');
          setRightDockOpen(true);
        },
      },
      {
        id: 'deliver',
        label: 'Deliver bundle (ZIP / GoFile.io)',
        hint: 'apk + sources + tests',
        run: () => setDeliverOpen(true),
      },
      { id: 'docs', label: 'Open setup guide', hint: 'SDK · signing · opencode', run: () => setDocsOpen(true) },
      {
        id: 'key-release',
        label: 'Generate a release signing key',
        hint: 'keys panel',
        run: () => {
          setActivity('keys');
          void studio.generateKey('release');
        },
      },
      { id: 'clear', label: 'Clear the terminal', hint: 'shell', run: () => studio.clearTerminal() },
    ],
    [setActivity, setDeliverOpen, setDocsOpen, setRightDockOpen, setRightTab, studio],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q));
  }, [commands, query]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(640px,92vw)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-1)] shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3.5 py-2.5">
          <Search size={15} className="text-[var(--muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                filtered[index]?.run();
                onClose();
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
            placeholder="Type a command…"
            className="flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--muted)]/60"
          />
          <span className="flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
            <CornerDownLeft size={10} /> run
          </span>
        </div>
        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {filtered.map((command, i) => (
            <button
              key={command.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => {
                command.run();
                onClose();
              }}
              className={`flex w-full items-center gap-3 px-3.5 py-2 text-left text-[12.5px] ${
                i === index ? 'bg-[var(--accent)]/12 text-[var(--text)]' : 'text-[var(--muted)]'
              }`}
            >
              <span className="w-3 text-[var(--accent)]">{i === index ? '›' : ''}</span>
              <span className="flex-1">{command.label}</span>
              <span className="font-mono text-[10.5px] opacity-60">{command.hint}</span>
            </button>
          ))}
          {!filtered.length && (
            <p className="px-3.5 py-3 text-[12px] text-[var(--muted)]">No command matches “{query}”.</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useStudio();
  if (!paletteOpen) return null;
  return <CommandPaletteDialog onClose={() => setPaletteOpen(false)} />;
}
