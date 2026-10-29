import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircle2,
  ExternalLink,
  FileUp,
  Home,
  Package,
  RotateCw,
  ShieldAlert,
  Smartphone,
  Trash2,
  Zap,
} from 'lucide-react';
import { useStudio } from '../lib/studio';
import { extractApkAssets } from '../lib/apk';
import { KOMA_NOTES, komaShim } from '../lib/komaShim';

/**
 * KOMA-режим (?koma=1): стенд для читалки.
 *
 * Смысл — ВИДЕТЬ, что происходит: под экраном телефона показываются мосты
 * Android-оболочки, «нативная панель» с текущей репликой и журнал «прочитано по
 * порядку» — то есть какой текст читалка взяла и в каком порядке. Раньше это
 * приходилось угадывать по логам.
 */
const KOMA_MODE = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('koma');

const KOMA_PLUGIN = __KOMA_PLUGIN__;
const KOMA_SHIM = KOMA_MODE ? komaShim(JSON.stringify(KOMA_PLUGIN ?? {})) : '';

/**
 * Сверка с эталоном прямо на экране стенда.
 *
 * Раньше «попал/не попал» считал только прогон в терминале. Но смысл стенда —
 * видеть это глазами: какая реплика эталона нашлась, с какой точностью и в
 * каком порядке. Формулы те же, что в koma/live.py: только буквы и цифры,
 * верхний регистр, близость 0..1, порог 0.75.
 */
const komaNorm = (t: string): string =>
  String(t || '').toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, '');

function komaRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[n] / Math.max(m, n);
}

type KomaMatch = { want: string; got: string; ratio: number; index: number };

type KomaState = {
  text?: string; index?: number; total?: number; band?: number; bands?: number;
  playing?: boolean; paused?: boolean; voice?: string; status?: string;
} | null;

const BRIDGE_SHIM = `<script>(function(){
  function send(method, payload){
    try { window.parent.postMessage({ __apkforge: true, method: method, payload: payload }, '*'); } catch (e) {}
  }
  window.Android = {
    showToast: function (m) { send('showToast', m); },
    log: function (m) { send('log', m); },
    vibrate: function (ms) { send('vibrate', ms); },
    finish: function () { send('finish', ''); },
    deviceInfo: function () { return 'APKForge Studio Device (API 34)'; },
    setTitle: function (t) { send('setTitle', t); },
    getPackageName: function () { send('getPackageName', ''); }
  };
})();</script>`;

function inlineAssets(html: string, assets: Record<string, string>): string {
  let out = html.replace(/<link[^>]*href=["']([^"']+)["'][^>]*>/g, (match, href: string) => {
    const clean = href.replace(/^\.\//, '');
    const css = assets[clean] ?? assets[href];
    return css ? `<style>\n${css}\n</style>` : match;
  });
  out = out.replace(/<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/g, (match, src: string) => {
    const clean = src.replace(/^\.\//, '');
    const js = assets[clean] ?? assets[src];
    return js ? `<script>\n${js}\n</script>` : match;
  });
  return out;
}

interface LogEntry {
  id: number;
  tag: string;
  text: string;
  level: 'I' | 'W' | 'E';
}

export function Emulator() {
  const { apps, installApk, installExternalApkFile, uninstallApp, buildArtifacts, config, pushTerminal } = useStudio();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dismissedHome, setDismissedHome] = useState(false);
  const [frameState, setFrameState] = useState<{ appId: string; url: string | null }>({ appId: '', url: null });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [rotated, setRotated] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const logId = useRef(0);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [komaPanel, setKomaPanel] = useState<KomaState>(null);
  const [komaSpoken, setKomaSpoken] = useState<string[]>([]);
  const [komaBridges, setKomaBridges] = useState<string>('');

  // Опрос contentWindow: postMessage из iframe до React-состояния не доходит
  // (проверено 29.10), а прямое чтение функций моста работает надёжно.
  useEffect(() => {
    if (!KOMA_MODE) return;
    const tick = () => {
      const win = frameRef.current?.contentWindow as (Window & {
        __komaPanel?: () => { visible: boolean; state: KomaState };
        __komaSpoken?: () => string;
        __komaBridges?: string;
      }) | null;
      if (!win || typeof win.__komaPanel !== 'function') return;
      try {
        const p = win.__komaPanel();
        setKomaPanel(p.visible ? p.state : null);
        const spoken = win.__komaSpoken ? JSON.parse(win.__komaSpoken() || '[]') : [];
        setKomaSpoken(
          Array.isArray(spoken)
            ? spoken.map((x: { text?: string } | string) => (typeof x === 'string' ? x : String(x?.text || '')))
                .filter((t: string) => t.trim())
            : [],
        );
        if (win.__komaBridges) setKomaBridges(win.__komaBridges);
      } catch {
        /* кадр ещё грузится */
      }
    };
    const timer = setInterval(tick, 250);
    tick();
    return () => clearInterval(timer);
  }, []);

  const activeApp = useMemo(() => {
    if (dismissedHome && !selectedId) return undefined;
    if (selectedId) return apps.find((a) => a.id === selectedId) ?? apps[0];
    return apps[0];
  }, [apps, dismissedHome, selectedId]);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeApp) return;
    let revokedUrl: string | null = null;
    let revokeMedia: (() => void) | null = null;
    let cancelled = false;

    void extractApkAssets(activeApp.blob).then(({ text, mediaUrls, revokeAll }) => {
      if (cancelled) {
        revokeAll();
        return;
      }
      revokeMedia = revokeAll;
      const html = text['index.html'];
      if (!html) {
        setFrameState({ appId: activeApp.id, url: null });
        return;
      }
      const mediaScript = `<script>window.__APKFORGE_MEDIA__ = ${JSON.stringify(mediaUrls)};</script>`;
      const inlined = inlineAssets(html, text);
      const withBridge = inlined.includes('<head>')
        ? inlined.replace('<head>', `<head>${mediaScript}${BRIDGE_SHIM}${KOMA_SHIM}`)
        : mediaScript + BRIDGE_SHIM + KOMA_SHIM + inlined;
      revokedUrl = URL.createObjectURL(new Blob([withBridge], { type: 'text/html' }));
      setFrameState({ appId: activeApp.id, url: revokedUrl });
    });

    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
      if (revokeMedia) revokeMedia();
    };
  }, [activeApp]);

  const activeFrameUrl = activeApp && frameState.appId === activeApp.id ? frameState.url : null;

  // Эталон берём из плагина стенда: правка JSON — новые ожидания без сборки.
  const komaExpected: string[] = useMemo(() => {
    const forge = (KOMA_PLUGIN as { koma?: { forge?: { expected?: unknown } } })?.koma?.forge;
    const exp = forge?.expected;
    return Array.isArray(exp) ? exp.map(String) : [];
  }, []);

  const komaMatches: KomaMatch[] = useMemo(() => {
    if (!komaExpected.length) return [];
    return komaExpected.map((want) => {
      const wn = komaNorm(want);
      let bestIdx = -1;
      let bestRatio = 0;
      komaSpoken.forEach((got, i) => {
        const r = komaRatio(wn, komaNorm(got));
        if (r > bestRatio) { bestRatio = r; bestIdx = i; }
      });
      return { want, got: bestIdx >= 0 ? komaSpoken[bestIdx] : '', ratio: bestRatio, index: bestIdx };
    });
  }, [komaExpected, komaSpoken]);

  const komaHits = komaMatches.filter((m) => m.ratio >= 0.75).length;
  const komaOrderOk = komaMatches
    .map((m) => m.index)
    .filter((i) => i >= 0)
    .every((v, i, arr) => i === 0 || arr[i - 1] <= v);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { __apkforge?: boolean; method?: string; payload?: unknown } | null;
      if (!data || !data.__apkforge) return;
      logId.current += 1;
      const entry: LogEntry = {
        id: logId.current,
        tag: 'ForgeDeck',
        text: String(data.payload ?? ''),
        level: 'I',
      };
      if (data.method === 'showToast') {
        setToast(String(data.payload));
        setTimeout(() => setToast(null), 2200);
        entry.text = `Toast: ${String(data.payload)}`;
      }
      if (data.method === 'finish') {
        setSelectedId(null);
        setDismissedHome(true);
      }
      setLogs((prev) => [entry, ...prev].slice(0, 120));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const appendLog = (tag: string, text: string, level: 'I' | 'W' | 'E' = 'I') => {
    logId.current += 1;
    setLogs((prev) => [{ id: logId.current, tag, text, level }, ...prev].slice(0, 120));
  };

  const handleFile = async (file: File) => {
    try {
      const inspected = await installExternalApkFile(file);
      setDismissedHome(false);
      setSelectedId(null);
      appendLog(
        'PackageManager',
        `Installed ${inspected.packageName} v${inspected.versionName} (${inspected.entries.length} entries, v2=${inspected.verification.v2SignatureVerified})`,
        'I',
      );
      pushTerminal(
        `Loaded APK ${file.name}: package=${inspected.packageName} v${inspected.versionName} · v1=${inspected.verification.hasV1Signature} · v2=${inspected.verification.v2SignatureVerified}`,
        'ok',
      );
    } catch (error) {
      const msg = (error as Error).message;
      appendLog('PackageManager', `Install failed: ${msg}`, 'E');
      pushTerminal(`emulator: failed to open ${file.name}: ${msg}`, 'err');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-1)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <Smartphone size={14} className="text-[var(--accent)]" />
        <select
          value={activeApp?.id ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            if (!val) {
              setSelectedId(null);
              setDismissedHome(true);
            } else {
              setDismissedHome(false);
              setSelectedId(val);
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-2)] px-2 py-1 text-[11.5px] text-[var(--text)] outline-none"
        >
          <option value="">Home screen (no app focused)</option>
          {apps.map((app) => (
            <option key={app.id} value={app.id}>
              {app.name} · {app.packageName}
            </option>
          ))}
        </select>
        <button onClick={() => setRotated((v) => !v)} className="icon-btn" title="Rotate">
          <RotateCw size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex justify-center">
          <div
            className={`relative rounded-[34px] border border-[#2a3441] bg-[#05070a] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)] transition-transform ${
              rotated ? 'rotate-90' : ''
            }`}
            style={{ width: rotated ? 300 : KOMA_MODE ? 330 : 268 }}
          >
            <div className="pointer-events-none absolute left-1/2 top-3 z-10 h-5 w-16 -translate-x-1/2 rounded-full bg-[#05070a]" />
            <div className="relative overflow-hidden rounded-[26px] bg-[#05070a]">
              <div className="flex h-7 items-center justify-between bg-[#05070a] px-4 text-[10px] font-medium text-[#cfd8e3]">
                <span>{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="flex items-center gap-1.5">
                  <span className="flex items-end gap-[2px]">
                    {[3, 5, 7, 9].map((h) => (
                      <span key={h} className="w-[2px] rounded-sm bg-[#cfd8e3]" style={{ height: h }} />
                    ))}
                  </span>
                  <span className="rounded-[3px] border border-[#cfd8e3] px-1 py-[1px] text-[8px]">86%</span>
                </span>
              </div>

              <div className={`relative w-full bg-[#0b0f14] ${KOMA_MODE ? 'h-[560px]' : 'h-[470px]'}`}>
                {activeFrameUrl ? (
                  <iframe
                    ref={frameRef}
                    src={activeFrameUrl}
                    title="app"
                    className="h-full w-full border-0"
                    sandbox="allow-scripts allow-same-origin allow-modals"
                  />
                ) : activeApp && !activeApp.hasWebPayload ? (
                  <div className="flex h-full flex-col justify-center gap-3 px-5 text-left">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--border)] bg-[var(--bg-2)]">
                        <Package size={18} className="text-[var(--accent)]" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-semibold text-[var(--text)]">{activeApp.name}</div>
                        <div className="truncate font-mono text-[10px] text-[var(--muted)]">{activeApp.packageName}</div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-2)] p-3 font-mono text-[10.5px] leading-relaxed text-[var(--muted)]">
                      <div>version: {activeApp.version}</div>
                      <div>entries: {activeApp.entriesCount}</div>
                      <div>zipalign (4B): {activeApp.zipAligned ? 'OK' : 'NO'}</div>
                      <div>JAR v1 sig: {activeApp.signedV1 ? 'present' : 'none'}</div>
                      <div>APK v2 sig: {activeApp.signedV2 ? 'verified' : 'none'}</div>
                    </div>
                    <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                      Native Dalvik/ART APK inspected. Run on a full Android device via <span className="font-mono">adb install</span> or cloud AVD.
                    </p>
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                    <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--border)] bg-[var(--bg-2)]">
                      <Package size={22} className="text-[var(--muted)]" />
                    </div>
                    <p className="text-[12px] leading-relaxed text-[var(--muted)]">
                      {apps.length
                        ? 'Select an installed app above to launch it.'
                        : 'Build an APK or click Open APK… to inspect and run it here.'}
                    </p>
                  </div>
                )}

                <AnimatePresence>
                  {toast && (
                    <motion.div
                      initial={{ opacity: 0, y: -12, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-[#20262f] px-3 py-2 text-[11px] text-[#e6edf3] shadow-lg"
                    >
                      {toast}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex h-9 items-center justify-center gap-16 bg-[#05070a]">
                <button
                  onClick={() => {
                    setSelectedId(null);
                    setDismissedHome(true);
                  }}
                  className="text-[#6f7d90] hover:text-[#cfd8e3]"
                  title="Back"
                >
                  <span className="block h-[3px] w-4 rounded-full bg-current" />
                </button>
                <button
                  onClick={() => {
                    setSelectedId(null);
                    setDismissedHome(true);
                  }}
                  className="grid h-5 w-5 place-items-center rounded-full border border-current text-[10px] text-[#6f7d90] hover:text-[#cfd8e3]"
                  title="Home"
                >
                  <Home size={10} />
                </button>
                <button
                  onClick={() => setDismissedHome(false)}
                  className="text-[#6f7d90] hover:text-[#cfd8e3]"
                  title="Recents"
                >
                  <span className="block h-[3px] w-4 rounded-full bg-current opacity-60" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {KOMA_MODE && (
          <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-2)] p-2.5 text-left">
            <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wide text-[var(--muted)]">
              {komaBridges || KOMA_NOTES.join(' · ')}
            </div>
            <div
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-1)] px-2 py-1.5"
              data-koma-panel={komaPanel ? 'shown' : 'hidden'}
              data-koma-index={komaPanel?.index ?? 0}
              data-koma-total={komaPanel?.total ?? 0}
              data-koma-text={komaPanel?.text ?? ''}
              data-koma-playing={komaPanel?.playing ? '1' : '0'}
              data-koma-paused={komaPanel?.paused ? '1' : '0'}
            >
              {komaPanel ? (
                <>
                  <div className="truncate text-[11.5px] font-medium text-[var(--text)]">{komaPanel.text}</div>
                  <div className="mt-0.5 text-[9.5px] text-[var(--muted)]">
                    реплика {komaPanel.index || 0} из {komaPanel.total || 0}
                    {' · '}полоса {komaPanel.band || 0} из {komaPanel.bands || 0}
                    {komaPanel.voice ? ' · ' + komaPanel.voice : ''}
                    {komaPanel.paused ? ' · пауза' : ''}
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-[var(--muted)]">панель скрыта</div>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              {([['toggle', '▶/⏸'], ['next', '⏭'], ['repeat', '⟲'], ['stop', '⏹']] as const).map(([cmd, label]) => (
                <button
                  key={cmd}
                  onClick={() => {
                    const win = frameRef.current?.contentWindow as (Window & { __komaCmd?: (c: string) => void }) | null;
                    try { win?.__komaCmd?.(cmd); } catch { /* кадр не готов */ }
                  }}
                  className="rounded-md border border-[var(--border)] px-2 py-[3px] text-[11px] text-[var(--text)] hover:border-[var(--accent)]"
                  data-koma-cmd={cmd}
                >
                  {label}
                </button>
              ))}
            </div>
            {komaExpected.length > 0 && (
              <div
                className="mt-2 rounded-md border border-[var(--border)] bg-[var(--bg-1)] px-2 py-1.5"
                data-koma-hits={komaHits}
                data-koma-expected={komaExpected.length}
                data-koma-order={komaOrderOk ? 'ok' : 'broken'}
              >
                <div className="flex items-center justify-between text-[9.5px] uppercase tracking-wide text-[var(--muted)]">
                  <span>сверка с эталоном</span>
                  <span
                    className={
                      komaHits === komaExpected.length && komaOrderOk
                        ? 'text-emerald-400'
                        : komaPanel?.playing
                          ? 'text-[var(--muted)]'
                          : 'text-amber-400'
                    }
                  >
                    {komaHits} из {komaExpected.length}
                    {komaPanel?.playing
                      ? ' · идёт чтение'
                      : komaOrderOk
                        ? ' · порядок ok'
                        : ' · порядок нарушен'}
                  </span>
                </div>
                <ol className="mt-1 max-h-28 space-y-[1px] overflow-y-auto text-[10px] leading-snug">
                  {komaMatches.map((m, i) => {
                    // Пока идёт чтение, «не найдено» — это чаще всего «ещё не
                    // дочитали»: не пугаем красным, показываем серым.
                    const hit = m.ratio >= 0.75;
                    const pending = !hit && !!komaPanel?.playing;
                    return (
                      <li key={i} className="truncate" data-koma-match={i}>
                        <span
                          className={
                            hit ? 'text-emerald-400' : pending ? 'text-[var(--muted)]' : 'text-amber-400'
                          }
                        >
                          {hit ? '✓' : pending ? '·' : '—'} {hit ? m.ratio.toFixed(2) : pending ? 'жду' : m.ratio.toFixed(2)}
                        </span>{' '}
                        <span className="text-[var(--muted)]">{m.want.slice(0, 46)}</span>
                        {!hit && m.got && (
                          <span className="text-[var(--muted)]"> → {m.got.slice(0, 34)}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[9.5px] uppercase tracking-wide text-[var(--muted)]">
                прочитано по порядку ({komaSpoken.length})
              </span>
              <button
                onClick={() => {
                  const win = frameRef.current?.contentWindow as (Window & { __komaReport?: () => string }) | null;
                  try {
                    const json = win?.__komaReport?.() || '{}';
                    const blob = new Blob([json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `koma-report-${Date.now()}.json`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 3000);
                  } catch { /* кадр не готов */ }
                }}
                className="rounded border border-[var(--border)] px-1.5 py-[1px] text-[9.5px] text-[var(--muted)] hover:border-[var(--accent)]"
                data-koma-cmd="report"
              >
                отчёт
              </button>
            </div>
            <ol className="mt-1 max-h-32 space-y-[2px] overflow-y-auto text-[10.5px] leading-snug text-[var(--text)]">
              {komaSpoken.map((t, i) => (
                <li key={i} className="truncate" data-koma-spoken={i}>
                  <span className="text-[var(--muted)]">{i + 1}.</span> {t}
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              const latest = buildArtifacts[buildArtifacts.length - 1];
              if (latest) {
                setDismissedHome(false);
                void installApk(latest);
              }
            }}
            disabled={!buildArtifacts.length}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-2 py-2 text-[11.5px] font-semibold text-[#06210f] disabled:opacity-40"
          >
            <Zap size={13} /> Install APK
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] px-2 py-2 text-[11.5px] text-[var(--text)]"
          >
            <FileUp size={13} /> Open APK…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".apk"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => window.open('https://appetizer.io/upload', '_blank', 'noopener')}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] px-2 py-2 text-[11.5px] text-[var(--text)]"
          >
            <ExternalLink size={13} /> appetizer.io
          </button>
          <button
            onClick={() => {
              if (activeApp) uninstallApp(activeApp.id);
              setSelectedId(null);
            }}
            disabled={!activeApp}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] px-2 py-2 text-[11.5px] text-[var(--muted)] disabled:opacity-40"
          >
            <Trash2 size={13} /> Uninstall
          </button>
        </div>

        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] p-2.5 text-[11px] text-[var(--muted)]">
          <div className="mb-1 flex items-center gap-1.5 font-semibold uppercase tracking-[0.12em] text-[var(--text)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" /> Package & Signature
          </div>
          <div className="font-mono leading-relaxed">
            {activeApp ? (
              <>
                <div>app: {activeApp.packageName} (v{activeApp.version})</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px]">
                  <span className={activeApp.signedV2 ? 'flex items-center gap-1 text-[var(--accent)]' : 'flex items-center gap-1 text-[var(--warn)]'}>
                    {activeApp.signedV2 ? <CheckCircle2 size={11} /> : <ShieldAlert size={11} />}
                    {activeApp.signedV2 ? 'v1 + v2 verified' : activeApp.signedV1 ? 'v1 signed' : 'unsigned'}
                  </span>
                  <span>· zipalign: {activeApp.zipAligned ? '4B OK' : 'unaligned'}</span>
                </div>
              </>
            ) : (
              <div>{config.applicationId} · not installed</div>
            )}
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[#070a0e]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
            <span>logcat</span>
            <button
              onClick={() => setLogs([])}
              className="text-[10px] normal-case tracking-normal hover:text-[var(--text)]"
            >
              clear
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed">
            {logs.length === 0 && <div className="text-[var(--muted)] opacity-60">— no output —</div>}
            {logs.map((log) => (
              <div key={log.id} className="flex gap-1.5">
                <span
                  className={
                    log.level === 'E'
                      ? 'text-[var(--err)]'
                      : log.level === 'W'
                        ? 'text-[var(--warn)]'
                        : 'text-[var(--accent)]'
                  }
                >
                  {log.level}
                </span>
                <span className="text-[#7dcfff]">{log.tag}</span>
                <span className="text-[var(--muted)]">{log.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
