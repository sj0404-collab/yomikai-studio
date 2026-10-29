import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ActivityBar } from './components/ActivityBar';
import { Assistant } from './components/Assistant';
import { BottomPanel } from './components/BottomPanel';
import { BuildPanel } from './components/BuildPanel';
import { CommandPalette } from './components/CommandPalette';
import { DeliverModal } from './components/DeliverModal';
import { DocsModal } from './components/DocsModal';
import { EditorPane } from './components/EditorPane';
import { Emulator } from './components/Emulator';
import { Explorer } from './components/Explorer';
import { KeysPanel } from './components/KeysPanel';
import { SearchPanel } from './components/SearchPanel';
import { StatusBar } from './components/StatusBar';
import { TopBar } from './components/TopBar';
import { StudioProvider, useStudio } from './lib/studio';

function SidePanel() {
  const { activity } = useStudio();
  if (activity === 'explorer') return <Explorer />;
  if (activity === 'search') return <SearchPanel />;
  if (activity === 'build') return <BuildPanel />;
  if (activity === 'keys') return <KeysPanel />;
  return <BuildPanel />;
}

function RightDock() {
  const { rightTab, setRightTab, setRightDockOpen } = useStudio();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-[var(--border)] px-2 py-1.5">
        {(
          [
            { id: 'device', label: 'Device' },
            { id: 'assistant', label: 'OpenCode' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setRightTab(tab.id)}
            className={`rounded-md px-2.5 py-1 text-[11.5px] ${
              rightTab === tab.id ? 'bg-[var(--accent)]/12 text-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <button onClick={() => setRightDockOpen(false)} className="icon-btn ml-auto" title="Close dock">
          <span className="text-[13px] leading-none">×</span>
        </button>
      </div>
      <div className="min-h-0 flex-1">{rightTab === 'device' ? <Emulator /> : <Assistant />}</div>
    </div>
  );
}

function Studio() {
  const { setPaletteOpen, setBottomTab, bottomTab, rightDockOpen, mobilePanel, setMobilePanel, activity } =
    useStudio();
  const [bottomHeight, setBottomHeight] = useState(240);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && /input|textarea/i.test(target.tagName);
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setPaletteOpen(true);
      } else if ((event.ctrlKey || event.metaKey) && event.key === '`') {
        event.preventDefault();
        setBottomTab(bottomTab === 'terminal' ? 'output' : 'terminal');
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setBottomTab(bottomTab === 'terminal' ? 'output' : 'terminal');
      } else if (event.key === 'Escape' && typing) {
        (target as HTMLElement).blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bottomTab, setBottomTab, setPaletteOpen]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - event.clientY;
      setBottomHeight(Math.min(Math.max(dragRef.current.startHeight + delta, 120), window.innerHeight - 220));
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[var(--bg-0)] text-[var(--text)]">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />

        <AnimatePresence>
          {mobilePanel && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-30 bg-black/50 lg:hidden"
                onClick={() => setMobilePanel(false)}
              />
              <motion.aside
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ type: 'tween', duration: 0.18 }}
                className="fixed bottom-0 left-[52px] top-12 z-40 w-[264px] border-r border-[var(--border)] bg-[var(--bg-1)] lg:hidden"
              >
                <SidePanel />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <aside className="hidden w-[264px] shrink-0 border-r border-[var(--border)] bg-[var(--bg-1)] lg:block">
          <SidePanel />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <EditorPane />
          </div>
          <div
            className="relative shrink-0 border-t border-[var(--border)]"
            style={{ height: bottomHeight }}
          >
            <div
              onMouseDown={(event) => {
                dragRef.current = { startY: event.clientY, startHeight: bottomHeight };
                document.body.style.cursor = 'ns-resize';
              }}
              className="absolute -top-[3px] left-0 right-0 h-[6px] cursor-ns-resize"
            />
            <BottomPanel />
          </div>
        </main>

        {/* Single RightDock instance styled responsively (overlay below xl, static column at xl+) */}
        {rightDockOpen && (
          <aside className="fixed bottom-0 right-0 top-12 z-40 w-[380px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-1)] xl:static xl:z-auto">
            <RightDock />
          </aside>
        )}
      </div>

      <StatusBar />
      <CommandPalette />
      <DeliverModal />
      <DocsModal />
      <span className="hidden">{activity}</span>
    </div>
  );
}

export default function App() {
  return (
    <StudioProvider>
      <Studio />
    </StudioProvider>
  );
}
