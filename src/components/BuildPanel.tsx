import { useMemo } from 'react';
import { Download, ExternalLink, Hammer, Package, Play, Trash2, Zap } from 'lucide-react';
import { useStudio } from '../lib/studio';
import { formatSize } from '../lib/project';
import { downloadBlob } from '../lib/deliver';

export function BuildPanel() {
  const { buildArtifacts, buildGradle, buildMaven, building, installApk, config } = useStudio();

  const tasks = useMemo(
    () => [
      { id: 'assembleDebug', label: 'assembleDebug', hint: 'v1+v2 debug APK' },
      { id: 'assembleRelease', label: 'assembleRelease', hint: 'v1+v2 release APK' },
      { id: 'build', label: 'build', hint: 'all APKs + tests + lint' },
      { id: 'test', label: 'test', hint: 'unit test suite' },
      { id: 'lint', label: 'lint', hint: 'android lint' },
      { id: 'clean', label: 'clean', hint: 'wipe build dir' },
    ],
    [],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
        Build
      </div>
      <div className="space-y-1.5 px-2.5">
        {tasks.map((task) => (
          <button
            key={task.id}
            disabled={building}
            onClick={() => void buildGradle(task.id)}
            className="group flex w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] px-2.5 py-2 text-left transition-colors hover:border-[var(--accent)]/60 disabled:opacity-40"
          >
            <Hammer size={13} className="text-[var(--accent)]" />
            <span className="font-mono text-[11.5px] text-[var(--text)]">{task.label}</span>
            <span className="ml-auto text-[10px] text-[var(--muted)]">{task.hint}</span>
          </button>
        ))}
        <button
          disabled={building}
          onClick={() => void buildMaven('package')}
          className="group flex w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] px-2.5 py-2 text-left transition-colors hover:border-[#a371f7]/60 disabled:opacity-40"
        >
          <Package size={13} className="text-[#a371f7]" />
          <span className="font-mono text-[11.5px] text-[var(--text)]">mvn package</span>
          <span className="ml-auto text-[10px] text-[var(--muted)]">maven</span>
        </button>
      </div>

      <div className="mt-4 px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
        Artifacts · {buildArtifacts.length}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 pb-4">
        {!buildArtifacts.length && (
          <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-[11.5px] leading-relaxed text-[var(--muted)]">
            No APK yet. Run <span className="font-mono text-[var(--accent)]">assembleDebug</span> to package{' '}
            <span className="font-mono">{config.applicationId}</span>.
          </p>
        )}
        {buildArtifacts.map((artifact) => (
          <div key={artifact.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-2)] p-2.5">
            <div className="flex items-center gap-2">
              <Package size={13} className="text-[var(--accent)]" />
              <span className="truncate font-mono text-[11px] text-[var(--text)]">{artifact.name}</span>
              <span className="ml-auto rounded bg-black/30 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-[var(--muted)]">
                {artifact.variant}
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[10px] text-[var(--muted)]">
              {formatSize(artifact.size)} · sha256 {artifact.sha256?.slice(0, 12)}…
            </div>
            <div className="mt-2 flex gap-1.5">
              <button
                onClick={() => void installApk(artifact)}
                className="flex flex-1 items-center justify-center gap-1 rounded-md bg-[var(--accent)] px-2 py-1.5 text-[10.5px] font-semibold text-[#06210f]"
              >
                <Play size={11} /> Install
              </button>
              <button
                onClick={() => downloadBlob(artifact.blob, artifact.name)}
                className="flex items-center justify-center gap-1 rounded-md border border-[var(--border)] px-2 py-1.5 text-[10.5px] text-[var(--text)]"
                title="Download APK"
              >
                <Download size={11} />
              </button>
              <button
                onClick={() => window.open('https://appetizer.io/upload', '_blank', 'noopener')}
                className="flex items-center justify-center gap-1 rounded-md border border-[var(--border)] px-2 py-1.5 text-[10.5px] text-[var(--text)]"
                title="Open in appetizer.io"
              >
                <ExternalLink size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--border)] px-3 py-2 text-[10.5px] leading-relaxed text-[var(--muted)]">
        <div className="flex items-center gap-1.5">
          <Zap size={11} className="text-[var(--accent)]" /> AXML · ARSC · DEX 035 · APK Sig v1 + v2
        </div>
        {buildArtifacts.length > 0 && (
          <button
            onClick={() => {
              buildArtifacts.forEach((a) => downloadBlob(a.blob, a.name));
            }}
            className="mt-1.5 flex items-center gap-1 text-[var(--accent)] hover:underline"
          >
            <Download size={11} /> Download all artifacts
          </button>
        )}
        <div className="mt-1 flex items-center gap-1">
          <Trash2 size={11} /> Metadata in <span className="font-mono">app/build/outputs/apk</span>
        </div>
      </div>
    </div>
  );
}
