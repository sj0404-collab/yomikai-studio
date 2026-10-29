import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Download, ExternalLink, Package, Upload, X } from 'lucide-react';
import { useStudio } from '../lib/studio';
import { createDeliveryZip, downloadBlob, type DeliveryResult } from '../lib/deliver';
import { runTests } from '../lib/tests';
import { uploadToGofile } from '../lib/gofile';
import { formatSize } from '../lib/project';

function DeliverDialog({ onClose }: { onClose: () => void }) {
  const { files, config, buildArtifacts, buildLogText, keys, templateId } = useStudio();
  const [selected, setSelected] = useState<string[]>(() => buildArtifacts.map((a) => a.id));
  const [bundle, setBundle] = useState<DeliveryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [upload, setUpload] = useState<{
    state: 'idle' | 'loading' | 'done' | 'error';
    link?: string;
    message?: string;
  }>({
    state: 'idle',
  });

  const create = async () => {
    setBusy(true);
    setUpload({ state: 'idle' });
    try {
      const report = await runTests(files);
      const apks = buildArtifacts
        .filter((a) => selected.includes(a.id))
        .map((a) => ({ name: a.name, blob: a.blob, sha256: a.sha256 ?? '', variant: a.variant ?? 'debug' }));
      const result = await createDeliveryZip({
        files,
        config,
        apks,
        report,
        buildLog: buildLogText(),
        key: keys.release ?? keys.debug,
        templateName: templateId,
      });
      setBundle(result);
    } finally {
      setBusy(false);
    }
  };

  const doUpload = async () => {
    if (!bundle) return;
    setUpload({ state: 'loading' });
    try {
      const result = await uploadToGofile(bundle.blob, bundle.fileName);
      setUpload({ state: 'done', link: result.link });
    } catch (error) {
      setUpload({ state: 'error', message: (error as Error).message });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-[min(760px,94vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-1)] shadow-[0_30px_90px_rgba(0,0,0,0.65)]"
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <Package size={16} className="text-[var(--accent)]" />
          <div className="leading-tight">
            <div className="text-[13.5px] font-semibold text-[var(--text)]">Delivery bundle</div>
            <div className="text-[10.5px] text-[var(--muted)]">
              APK (v1+v2 signed) · sources · tests · keystore — one archive
            </div>
          </div>
          <button onClick={onClose} className="icon-btn ml-auto">
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-2)] p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Artifacts to include
            </div>
            {buildArtifacts.length === 0 && (
              <p className="text-[12px] text-[var(--muted)]">
                Nothing built yet — run <span className="font-mono text-[var(--accent)]">assembleDebug</span> or{' '}
                <span className="font-mono text-[var(--accent)]">assembleRelease</span> first.
              </p>
            )}
            <div className="space-y-1.5">
              {buildArtifacts.map((artifact) => (
                <label
                  key={artifact.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-0)] px-2.5 py-2"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(artifact.id)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked ? [...prev, artifact.id] : prev.filter((id) => id !== artifact.id),
                      )
                    }
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <span className="font-mono text-[11.5px] text-[var(--text)]">{artifact.name}</span>
                  <span className="ml-auto text-[10.5px] text-[var(--muted)]">{formatSize(artifact.size)}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-2)] p-3 text-[11.5px] leading-relaxed text-[var(--muted)]">
            The bundle includes the signed installable APK(s), full Gradle/Maven source workspace, executed unit-test
            reports (JUnit XML + HTML), build log, and signing key material in PKCS#8 + X.509 PEM format.
          </div>

          {bundle && (
            <div className="mt-3 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-3">
              <div className="flex items-center gap-2">
                <Check size={15} className="text-[var(--accent)]" />
                <span className="font-mono text-[12px] text-[var(--text)]">{bundle.fileName}</span>
                <span className="ml-auto text-[11px] text-[var(--muted)]">{formatSize(bundle.size)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 font-mono text-[10.5px] text-[var(--muted)]">
                <span className="truncate">sha256 {bundle.sha256}</span>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(bundle.sha256);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="ml-auto flex shrink-0 items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 hover:text-[var(--text)]"
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />} {copied ? 'copied' : 'copy'}
                </button>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  onClick={() => downloadBlob(bundle.blob, bundle.fileName)}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-[12px] font-semibold text-[#06210f]"
                >
                  <Download size={13} /> Download ZIP
                </button>
                <button
                  onClick={() => void doUpload()}
                  disabled={upload.state === 'loading'}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-1)] px-3 py-2 text-[12px] text-[var(--text)] disabled:opacity-50"
                >
                  <Upload size={13} />
                  {upload.state === 'loading' ? 'Uploading…' : 'Upload to GoFile.io'}
                </button>
              </div>
              {upload.state === 'done' && upload.link && (
                <a
                  href={upload.link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 flex items-center gap-1.5 text-[11.5px] text-[var(--accent)] hover:underline"
                >
                  <ExternalLink size={12} /> {upload.link}
                </a>
              )}
              {upload.state === 'error' && (
                <p className="mt-2 text-[11.5px] text-[var(--err)]">
                  GoFile upload failed: {upload.message}. The ZIP is still available locally.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            onClick={() => void create()}
            disabled={busy || !selected.length}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-[12.5px] font-semibold text-[#06210f] disabled:opacity-40"
          >
            <Package size={14} /> {busy ? 'Packaging…' : 'Create bundle'}
          </button>
          <span className="text-[11px] text-[var(--muted)]">
            {config.applicationId} · v{config.versionName} · {Object.keys(files).length} source files
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function DeliverModal() {
  const { deliverOpen, setDeliverOpen } = useStudio();
  return (
    <AnimatePresence>
      {deliverOpen && <DeliverDialog onClose={() => setDeliverOpen(false)} />}
    </AnimatePresence>
  );
}
