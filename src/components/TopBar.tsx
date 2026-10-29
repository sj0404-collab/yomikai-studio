import { motion } from 'framer-motion';
import {
  Bot,
  Box,
  Cpu,
  FolderTree,
  Hammer,
  KeyRound,
  Package,
  Play,
  Search,
  Smartphone,
  TerminalSquare,
} from 'lucide-react';
import { useStudio } from '../lib/studio';

export function TopBar() {
  const {
    config,
    buildGradle,
    building,
    setActivity,
    setRightDockOpen,
    setRightTab,
    setDeliverOpen,
    setDocsOpen,
    templateId,
    loadTemplate,
  } = useStudio();

  return (
    <header className="flex h-12 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-1)] px-3">
      <div className="flex items-center gap-2.5">
        <div className="grid h-7 w-7 place-items-center rounded-[9px] bg-gradient-to-br from-[var(--accent)] to-[#2f81f7] shadow-[0_0_16px_rgba(61,220,132,0.35)]">
          <Box size={15} className="text-[#06210f]" strokeWidth={2.4} />
        </div>
        <div className="leading-none">
          <div className="text-[13px] font-semibold tracking-tight text-[var(--text)]">APKForge Studio</div>
          <div className="mt-[3px] text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">android v1+v2 lab</div>
        </div>
      </div>

      <div className="mx-2 hidden h-6 w-px bg-[var(--border)] sm:block" />

      <div className="hidden items-center gap-2 sm:flex">
        <span className="rounded-md border border-[var(--border)] bg-[var(--bg-2)] px-2 py-1 font-mono text-[11px] text-[var(--muted)]">
          {config.applicationId}
        </span>
        <span className="rounded-md border border-[var(--border)] bg-[var(--bg-2)] px-2 py-1 font-mono text-[11px] text-[var(--accent)]">
          v{config.versionName}
        </span>
        <select
          value={templateId}
          onChange={(e) => loadTemplate(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--bg-2)] px-2 py-1 text-[11px] text-[var(--muted)] outline-none hover:text-[var(--text)]"
          title="Project template"
        >
          <option value="webview">WebView Shell</option>
          <option value="compose">Compose Counter</option>
          <option value="maven">Maven WebView</option>
        </select>
      </div>

      <div className="flex flex-1 items-center justify-center gap-1.5">
        <button
          onClick={() => void buildGradle('assembleDebug')}
          disabled={building}
          className="toolbar-btn"
          title="gradle assembleDebug"
        >
          <Hammer size={14} />
          <span className="hidden md:inline">Debug</span>
        </button>
        <button
          onClick={() => void buildGradle('assembleRelease')}
          disabled={building}
          className="toolbar-btn"
          title="gradle assembleRelease"
        >
          <Package size={14} />
          <span className="hidden md:inline">Release</span>
        </button>
        <button
          onClick={() => {
            setActivity('build');
            setRightDockOpen(true);
            setRightTab('device');
          }}
          className="toolbar-btn"
          title="Open the emulator"
        >
          <Play size={14} />
          <span className="hidden md:inline">Run</span>
        </button>
        <button
          onClick={() => {
            setActivity('build');
            void buildGradle('test');
          }}
          disabled={building}
          className="toolbar-btn"
          title="gradle test"
        >
          <TerminalSquare size={14} />
          <span className="hidden md:inline">Test</span>
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => {
            setActivity('assistant');
            setRightTab('assistant');
            setRightDockOpen(true);
          }}
          className="toolbar-btn"
          title="OpenCode assistant"
        >
          <Bot size={14} />
          <span className="hidden lg:inline">OpenCode</span>
        </button>
        <button onClick={() => setDocsOpen(true)} className="toolbar-btn" title="Setup guide">
          <Cpu size={14} />
          <span className="hidden lg:inline">Guide</span>
        </button>
        <button
          onClick={() => setDeliverOpen(true)}
          className="toolbar-btn-primary"
          title="Build and deliver the bundle"
        >
          <Package size={14} />
          <span className="hidden lg:inline">Deliver</span>
        </button>
        <button onClick={() => setActivity('explorer')} className="toolbar-btn lg:hidden" title="Explorer">
          <FolderTree size={14} />
        </button>
        <button onClick={() => setActivity('search')} className="toolbar-btn lg:hidden" title="Search">
          <Search size={14} />
        </button>
        <button onClick={() => setActivity('keys')} className="toolbar-btn lg:hidden" title="Keys">
          <KeyRound size={14} />
        </button>
        <button
          onClick={() => {
            setRightDockOpen((v) => !v);
            setRightTab('device');
          }}
          className="toolbar-btn xl:hidden"
          title="Device"
        >
          <Smartphone size={14} />
        </button>
      </div>

      {building && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute right-3 top-14 z-50 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-[#06210f]"
        >
          building…
        </motion.div>
      )}
    </header>
  );
}
