import { useStudio } from '../lib/studio';

export function StatusBar() {
  const { config, problems, building, apps, buildArtifacts } = useStudio();
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.filter((p) => p.severity === 'warning').length;

  return (
    <footer className="flex h-6 items-center gap-3 border-t border-[var(--border)] bg-[var(--bg-1)] px-3 text-[11px] text-[var(--muted)]">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
        {config.applicationId}
      </span>
      <span className="hidden sm:inline">main*</span>
      <span className="hidden md:inline">UTF-8</span>
      <span className="ml-auto flex items-center gap-3">
        {errors > 0 && <span className="text-[var(--err)]">{errors} errors</span>}
        {warnings > 0 && <span className="text-[var(--warn)]">{warnings} warnings</span>}
        <span className="hidden lg:inline">JDK 17.0.11</span>
        <span className="hidden lg:inline">Gradle 8.7</span>
        <span className="hidden lg:inline">SDK 34</span>
        <span className="hidden xl:inline">{apps.length} apps installed</span>
        <span className="hidden xl:inline">{buildArtifacts.length} artifacts</span>
        <span className="text-[var(--accent)]">wasm64</span>
        <span>{building ? 'building…' : 'ready'}</span>
      </span>
    </footer>
  );
}
