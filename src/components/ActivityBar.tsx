import { Bot, FolderTree, Hammer, KeyRound, Search } from 'lucide-react';
import { useStudio, type ActivityView } from '../lib/studio';

const ITEMS: { id: ActivityView; label: string; Icon: typeof FolderTree }[] = [
  { id: 'explorer', label: 'Explorer', Icon: FolderTree },
  { id: 'search', label: 'Search', Icon: Search },
  { id: 'build', label: 'Build', Icon: Hammer },
  { id: 'keys', label: 'Signing keys', Icon: KeyRound },
  { id: 'assistant', label: 'OpenCode', Icon: Bot },
];

export function ActivityBar() {
  const { activity, setActivity, problems, apps } = useStudio();

  return (
    <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-[var(--border)] bg-[var(--bg-1)] py-2">
      {ITEMS.map(({ id, label, Icon }) => {
        const active = activity === id;
        return (
          <button
            key={id}
            onClick={() => setActivity(id)}
            title={label}
            className={`relative grid h-11 w-11 place-items-center rounded-xl transition-colors ${
              active ? 'text-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {active && (
              <span className="absolute left-[-6px] top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-[var(--accent)]" />
            )}
            <Icon size={19} strokeWidth={active ? 2.2 : 1.8} />
            {id === 'build' && problems.some((p) => p.severity === 'error') && (
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[var(--err)]" />
            )}
            {id === 'assistant' && apps.length > 0 && null}
          </button>
        );
      })}
    </nav>
  );
}
