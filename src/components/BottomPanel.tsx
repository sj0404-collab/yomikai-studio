import { AlertTriangle, CheckCircle2, Eraser, Play, Terminal, XCircle } from 'lucide-react';
import { useStudio, type BottomTab } from '../lib/studio';
import { Terminal as TerminalView } from './Terminal';

export function BottomPanel() {
  const {
    bottomTab,
    setBottomTab,
    output,
    problems,
    clearTerminal,
    clearOutput,
    config,
    lastTestReport,
    buildGradle,
    building,
    openFile,
  } = useStudio();

  const tabs: { id: BottomTab; label: string; count?: number; badgeTone?: 'ok' | 'err' | 'neutral' }[] = [
    { id: 'terminal', label: 'TERMINAL' },
    { id: 'output', label: 'OUTPUT', count: output.length ? output.length : undefined, badgeTone: 'neutral' },
    { id: 'problems', label: 'PROBLEMS', count: problems.length, badgeTone: problems.length ? 'err' : 'neutral' },
    {
      id: 'tests',
      label: 'TESTS',
      count: lastTestReport ? lastTestReport.total : undefined,
      badgeTone: lastTestReport ? (lastTestReport.failed > 0 ? 'err' : 'ok') : 'neutral',
    },
  ];

  return (
    <div className="flex h-full flex-col bg-[var(--bg-1)]">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--border)] px-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setBottomTab(item.id)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] ${
              bottomTab === item.id ? 'bg-white/[0.06] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span
                className={`rounded-full px-1.5 text-[9.5px] tracking-normal ${
                  item.badgeTone === 'ok'
                    ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                    : item.badgeTone === 'err'
                      ? 'bg-[var(--err)]/20 text-[var(--err)]'
                      : 'bg-white/10 text-[var(--muted)]'
                }`}
              >
                {item.id === 'tests' && lastTestReport ? `${lastTestReport.passed}/${lastTestReport.total}` : item.count}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {bottomTab === 'terminal' && (
            <button onClick={clearTerminal} className="icon-btn" title="Clear terminal">
              <Eraser size={12} />
            </button>
          )}
          {bottomTab === 'output' && (
            <button onClick={clearOutput} className="icon-btn" title="Clear output">
              <Eraser size={12} />
            </button>
          )}
          {bottomTab === 'tests' && (
            <button
              onClick={() => void buildGradle('test')}
              disabled={building}
              className="flex items-center gap-1 rounded-md bg-[var(--accent)]/15 px-2 py-0.5 text-[10.5px] font-medium text-[var(--accent)] hover:bg-[var(--accent)]/25 disabled:opacity-40"
              title="Run unit tests"
            >
              <Play size={10} /> Run tests
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {bottomTab === 'terminal' && <TerminalView />}
        {bottomTab === 'output' && (
          <div className="h-full overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed">
            {output.length === 0 && <div className="text-[var(--muted)] opacity-60">— no build output yet —</div>}
            {output.map((line, index) => (
              <div
                key={index}
                className={
                  line.tone === 'ok'
                    ? 'text-[var(--accent)]'
                    : line.tone === 'warn'
                      ? 'text-[var(--warn)]'
                      : line.tone === 'err'
                        ? 'text-[var(--err)]'
                        : line.tone === 'task'
                          ? 'text-[#7dcfff]'
                          : line.tone === 'muted'
                            ? 'text-[var(--muted)]'
                            : 'text-[var(--text)]'
                }
              >
                {line.text || '\u00A0'}
              </div>
            ))}
          </div>
        )}
        {bottomTab === 'problems' && (
          <div className="h-full overflow-y-auto p-2">
            {!problems.length && (
              <div className="flex items-center gap-2 px-2 py-3 text-[12px] text-[var(--muted)]">
                <CheckCircle2 size={14} className="text-[var(--accent)]" /> No problems detected.
              </div>
            )}
            {problems.map((problem, index) => (
              <button
                key={index}
                type="button"
                onClick={() => problem.file && openFile(problem.file)}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.03]"
              >
                {problem.severity === 'error' ? (
                  <XCircle size={14} className="mt-[2px] shrink-0 text-[var(--err)]" />
                ) : problem.severity === 'warning' ? (
                  <AlertTriangle size={14} className="mt-[2px] shrink-0 text-[var(--warn)]" />
                ) : (
                  <CheckCircle2 size={14} className="mt-[2px] shrink-0 text-[var(--accent)]" />
                )}
                <div className="min-w-0">
                  <div className="text-[12px] text-[var(--text)]">{problem.message}</div>
                  {problem.file && (
                    <div className="font-mono text-[10.5px] text-[var(--muted)]">{problem.file}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
        {bottomTab === 'tests' && (
          <div className="h-full overflow-y-auto p-3">
            <div className="mb-2 flex flex-wrap items-center gap-3 text-[11.5px] text-[var(--muted)]">
              <span className="flex items-center gap-1.5">
                <Terminal size={13} className="text-[var(--accent)]" /> Unit test suite · {config.applicationId}
              </span>
              {lastTestReport ? (
                <span className={lastTestReport.failed > 0 ? 'text-[var(--err)]' : 'text-[var(--accent)]'}>
                  {lastTestReport.passed}/{lastTestReport.total} passed ({lastTestReport.durationMs} ms)
                </span>
              ) : (
                <span>
                  Press <strong>Run tests</strong> or execute{' '}
                  <span className="font-mono text-[var(--accent)]">gradle test</span>
                </span>
              )}
            </div>

            {lastTestReport ? (
              <div className="space-y-1.5">
                {lastTestReport.results.map((res, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] px-2.5 py-1.5 font-mono text-[11px]"
                  >
                    {res.passed ? (
                      <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                    ) : (
                      <XCircle size={13} className="mt-0.5 shrink-0 text-[var(--err)]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[var(--text)]">
                        <span className="text-[var(--muted)]">{res.suite} › </span>
                        {res.name}
                      </div>
                      {res.error && <div className="mt-0.5 text-[var(--err)]">{res.error}</div>}
                    </div>
                    <span className="text-[10px] text-[var(--muted)]">{res.durationMs} ms</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-2)] p-3 font-mono text-[11px] leading-relaxed text-[var(--muted)]">
                <div className="text-[var(--text)]">app/src/test/js/core.test.js</div>
                <div className="text-[var(--text)]">app/src/test/java/com/forge/droid/ConverterTest.java</div>
                <div className="mt-1 text-[var(--accent)]">
                  Click “Run tests” above to execute the suite and generate JUnit XML + HTML reports.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
