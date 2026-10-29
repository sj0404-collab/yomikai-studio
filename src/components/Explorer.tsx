import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen, Upload } from 'lucide-react';
import { useStudio } from '../lib/studio';
import { buildTree, encodeBinaryDataUri, fileName, isBinaryPath, languageFor, type TreeNode } from '../lib/vfs';

function TreeRow({
  node,
  depth,
  expanded,
  toggle,
  active,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
  active?: string;
  onOpen: (path: string) => void;
}) {
  const isDir = node.type === 'dir';
  const isOpen = expanded.has(node.path);

  return (
    <>
      <button
        onClick={() => (isDir ? toggle(node.path) : onOpen(node.path))}
        className={`group flex w-full items-center gap-1.5 rounded-md py-[3px] pr-2 text-left text-[12.5px] transition-colors ${
          active === node.path
            ? 'bg-[var(--accent)]/12 text-[var(--text)]'
            : 'text-[var(--muted)] hover:bg-white/[0.04] hover:text-[var(--text)]'
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {isDir ? (
          isOpen ? (
            <ChevronDown size={13} className="shrink-0 opacity-70" />
          ) : (
            <ChevronRight size={13} className="shrink-0 opacity-70" />
          )
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        {isDir ? (
          isOpen ? (
            <FolderOpen size={14} className="shrink-0 text-[#7aa2f7]" />
          ) : (
            <Folder size={14} className="shrink-0 text-[#7aa2f7]" />
          )
        ) : (
          <FileCode2 size={13} className="shrink-0 text-[var(--muted)]" />
        )}
        <span className="truncate">{node.name}</span>
        {!isDir && (
          <span className="ml-auto shrink-0 text-[10px] uppercase opacity-40">{languageFor(node.path)}</span>
        )}
      </button>
      {isDir &&
        isOpen &&
        node.children?.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            active={active}
            onOpen={onOpen}
          />
        ))}
    </>
  );
}

export function Explorer() {
  const { files, activeFile, openFile, tabs, writeFiles, pushTerminal } = useStudio();
  const assetInputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set([
        'app',
        'app/src',
        'app/src/main',
        'app/src/main/java',
        'app/src/main/assets',
        'app/src/main/assets/webapp',
        'app/src/main/assets/webapp/media',
        'app/src/main/res',
        'app/src/test',
      ]),
  );

  const tree = useMemo(() => buildTree(files), [files]);

  const handleAssetUpload = async (fileList: FileList | null) => {
    if (!fileList || !fileList.length) return;
    const patch: Record<string, string> = {};
    for (const file of Array.from(fileList)) {
      const targetPath = `app/src/main/assets/webapp/media/${file.name}`;
      if (isBinaryPath(file.name)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        patch[targetPath] = encodeBinaryDataUri(bytes, file.name);
      } else {
        patch[targetPath] = await file.text();
      }
    }
    writeFiles(patch);
    setExpanded((prev) => new Set([...prev, 'app/src/main/assets/webapp', 'app/src/main/assets/webapp/media']));
    pushTerminal(`Imported ${Object.keys(patch).length} asset(s) into app/src/main/assets/webapp/media/`, 'ok');
  };

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Explorer</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => assetInputRef.current?.click()}
            className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-2)] px-1.5 py-0.5 text-[9.5px] font-medium text-[var(--accent)] hover:border-[var(--accent)]/60"
            title="Import media/binary assets into webapp/media"
          >
            <Upload size={10} /> Assets
          </button>
          <input
            ref={assetInputRef}
            type="file"
            multiple
            accept="image/*,audio/*,.png,.jpg,.jpeg,.webp,.gif,.wav,.mp3,.ogg,.json,.txt"
            className="hidden"
            onChange={(e) => {
              void handleAssetUpload(e.target.files);
              e.target.value = '';
            }}
          />
          <span className="text-[10px] text-[var(--muted)] opacity-60">{Object.keys(files).length} files</span>
        </div>
      </div>

      {tabs.length > 0 && (
        <>
          <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)] opacity-70">
            Open editors
          </div>
          <div className="px-1.5">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => openFile(tab)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-[3px] text-[12.5px] ${
                  activeFile === tab ? 'bg-[var(--accent)]/12 text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                <FileCode2 size={13} />
                <span className="truncate">{fileName(tab)}</span>
                <span className="ml-auto truncate text-[10px] opacity-50">{tab.split('/').slice(-2, -1)[0]}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)] opacity-70">
        ForgeDeck
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {tree.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            toggle={toggle}
            active={activeFile}
            onOpen={openFile}
          />
        ))}
      </div>
    </div>
  );
}
