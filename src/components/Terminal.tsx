import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useStudio } from '../lib/studio';

const TONE_ANSI: Record<string, string> = {
  info: '\x1b[38;2;195;205;219m',
  ok: '\x1b[38;2;61;220;132m',
  warn: '\x1b[38;2;245;181;68m',
  err: '\x1b[38;2;255;107;107m',
  muted: '\x1b[38;2;111;125;144m',
  cmd: '\x1b[38;2;125;207;255m',
};

export function Terminal() {
  const { terminal, runShell, cwd, shellHistory } = useStudio();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const bufferRef = useRef('');
  const lastId = useRef(-1);
  const cwdRef = useRef(cwd);
  const historyRef = useRef<string[]>(shellHistory);
  const historyIdxRef = useRef<number>(-1);
  const runShellRef = useRef(runShell);

  useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd]);

  useEffect(() => {
    historyRef.current = shellHistory;
    historyIdxRef.current = shellHistory.length;
  }, [shellHistory]);

  useEffect(() => {
    runShellRef.current = runShell;
  }, [runShell]);

  useEffect(() => {
    if (!hostRef.current || termRef.current) return;
    const term = new XTerm({
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: '#0b0f14',
        foreground: '#c3cddb',
        cursor: '#3ddc84',
        selectionBackground: '#2a4a6b77',
        black: '#0b0f14',
        red: '#ff6b6b',
        green: '#3ddc84',
        yellow: '#f5b544',
        blue: '#7dcfff',
        magenta: '#c792ea',
        cyan: '#7dcfff',
        white: '#c3cddb',
        brightBlack: '#6f7d90',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const writePrompt = () => {
      const path = cwdRef.current ? `/${cwdRef.current}` : '~';
      term.write(`\x1b[38;5;79mforge\x1b[0m:\x1b[38;5;111m${path}\x1b[0m$ `);
    };

    const replaceInput = (next: string) => {
      const prevLen = bufferRef.current.length;
      if (prevLen > 0) {
        term.write('\b \b'.repeat(prevLen));
      }
      bufferRef.current = next;
      if (next) term.write(next);
    };

    // Replay initial lines + prompt
    terminal.forEach((line) => {
      const ansi = TONE_ANSI[line.tone ?? 'info'] ?? TONE_ANSI.info;
      term.write(`${ansi}${line.text}\x1b[0m\r\n`);
      if (line.id > lastId.current) lastId.current = line.id;
    });
    writePrompt();
    bufferRef.current = '';

    term.onData((data) => {
      if (data === '\r') {
        const line = bufferRef.current;
        term.write('\r\n');
        bufferRef.current = '';
        if (line.trim()) {
          void runShellRef.current(line).finally(() => {
            writePrompt();
          });
        } else {
          writePrompt();
        }
        return;
      }
      if (data === '\x7f') {
        if (bufferRef.current.length > 0) {
          bufferRef.current = bufferRef.current.slice(0, -1);
          term.write('\b \b');
        }
        return;
      }
      if (data === '\x03') {
        bufferRef.current = '';
        term.write('^C\r\n');
        writePrompt();
        return;
      }
      if (data === '\x1b[A') {
        const hist = historyRef.current;
        if (!hist.length) return;
        historyIdxRef.current = Math.max(0, historyIdxRef.current - 1);
        replaceInput(hist[historyIdxRef.current] ?? '');
        return;
      }
      if (data === '\x1b[B') {
        const hist = historyRef.current;
        if (!hist.length) return;
        historyIdxRef.current = Math.min(hist.length, historyIdxRef.current + 1);
        replaceInput(historyIdxRef.current >= hist.length ? '' : hist[historyIdxRef.current] ?? '');
        return;
      }
      if (data.startsWith('\x1b')) return;
      bufferRef.current += data;
      term.write(data);
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    });
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (terminal.length === 0) {
      term.clear();
      lastId.current = -1;
      const path = cwdRef.current ? `/${cwdRef.current}` : '~';
      term.write(`\x1b[38;5;79mforge\x1b[0m:\x1b[38;5;111m${path}\x1b[0m$ `);
      return;
    }
    const fresh = terminal.filter((line) => line.id > lastId.current);
    if (!fresh.length) return;
    // Skip echoing `cmd` line if the user typed it interactively right in xterm
    fresh.forEach((line) => {
      if (line.tone === 'cmd') return;
      const ansi = TONE_ANSI[line.tone ?? 'info'] ?? TONE_ANSI.info;
      term.write(`${ansi}${line.text}\x1b[0m\r\n`);
    });
    lastId.current = terminal[terminal.length - 1]?.id ?? -1;
    term.scrollToBottom();
  }, [terminal]);

  return <div ref={hostRef} className="h-full w-full px-2 py-1.5" />;
}
