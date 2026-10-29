import { useState } from 'react';
import { KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { useStudio } from '../lib/studio';

function KeyCard({
  variant,
  title,
  hint,
}: {
  variant: 'debug' | 'release';
  title: string;
  hint: string;
}) {
  const { keys, generateKey } = useStudio();
  const [busy, setBusy] = useState(false);
  const [showPem, setShowPem] = useState(false);
  const key = keys[variant];

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-2)] p-3">
      <div className="flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--accent)]/15">
          <KeyRound size={14} className="text-[var(--accent)]" />
        </div>
        <div className="leading-tight">
          <div className="text-[12.5px] font-semibold text-[var(--text)]">{title}</div>
          <div className="text-[10.5px] text-[var(--muted)]">{hint}</div>
        </div>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await generateKey(variant);
            setBusy(false);
          }}
          className="ml-auto flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[10.5px] text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-40"
        >
          <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
          {key ? 'Regenerate' : 'Generate'}
        </button>
      </div>

      {key ? (
        <div className="mt-2.5 space-y-1 font-mono text-[10.5px] text-[var(--muted)]">
          <div>alias: <span className="text-[var(--accent)]">{key.alias}</span></div>
          <div>store pass: <span className="text-[var(--text)]">{key.storePassword}</span></div>
          <div>subject: <span className="text-[var(--text)]">{key.subject}</span></div>
          <div className="break-all">sha256: {key.fingerprintSha256}</div>
          <div>created: {new Date(key.createdAt).toLocaleDateString()}</div>
          <button onClick={() => setShowPem((v) => !v)} className="text-[10px] text-[var(--accent)] hover:underline">
            {showPem ? 'hide' : 'show'} private key (PKCS#8)
          </button>
          {showPem && (
            <pre className="mt-1 max-h-28 overflow-auto rounded-md bg-[#070a0e] p-2 text-[9.5px] leading-relaxed text-[#9ece6a]">
              {key.privateKeyPem}
            </pre>
          )}
        </div>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
          Not generated yet. The studio creates the key automatically before the first build and stores it in
          <span className="font-mono"> keystore/</span>.
        </p>
      )}
    </div>
  );
}

export function KeysPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
        Signing keys
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
        <KeyCard variant="debug" title="Debug key" hint="alias androiddebugkey · password android" />
        <KeyCard variant="release" title="Release key" hint="alias forge-release · RSA 2048" />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-2)] p-3 text-[11px] leading-relaxed text-[var(--muted)]">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--text)]">
            <ShieldCheck size={13} className="text-[var(--accent)]" /> How signing works here
          </div>
          Keys are generated with the WebCrypto API (RSASSA-PKCS1-v1_5, SHA-256). Every APK is signed with a real v1
          (JAR) signature: <span className="font-mono">META-INF/MANIFEST.MF</span>,{' '}
          <span className="font-mono">CERT.SF</span> and a PKCS#7 <span className="font-mono">CERT.RSA</span>. The key is
          exported as PKCS#8 PEM and shipped in the delivery bundle — convert it to a JKS with{' '}
          <span className="font-mono text-[var(--accent)]">keytool -importkeystore</span> for Android Studio.
        </div>
      </div>
    </div>
  );
}
