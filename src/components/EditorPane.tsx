import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/java/register';
import 'monaco-editor/languages/definitions/kotlin/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/typescript/register';
import 'monaco-editor/languages/definitions/xml/register';
import 'monaco-editor/languages/definitions/yaml/register';
import 'monaco-editor/languages/definitions/shell/register';
import 'monaco-editor/languages/definitions/markdown/register';
import 'monaco-editor/languages/definitions/ini/register';
import 'monaco-editor/editor/contrib/find/browser/findController';
import 'monaco-editor/editor/contrib/folding/browser/folding';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController';
import 'monaco-editor/editor/contrib/comment/browser/comment';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor';
import 'monaco-editor/editor/contrib/format/browser/formatActions';
import 'monaco-editor/editor/contrib/indentation/browser/indentation';
import 'monaco-editor/editor/contrib/documentSymbols/browser/documentSymbols';
import 'monaco-editor/editor/contrib/smartSelect/browser/smartSelect';
import 'monaco-editor/editor/contrib/anchorSelect/browser/anchorSelect';
import 'monaco-editor/editor/contrib/caretOperations/browser/transpose';
import 'monaco-editor/editor/contrib/links/browser/links';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import { X } from 'lucide-react';
import { useStudio } from '../lib/studio';
import { formatSize } from '../lib/project';
import { decodeFileBytes, isDataUri, languageFor, mimeForPath } from '../lib/vfs';

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

let themeDefined = false;
function defineTheme() {
  if (themeDefined) return;
  themeDefined = true;
  monaco.editor.defineTheme('apkforge', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '62748a', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c792ea' },
      { token: 'string', foreground: '9ece6a' },
      { token: 'number', foreground: 'ff9e64' },
      { token: 'type', foreground: '7dcfff' },
      { token: 'tag', foreground: 'f7768e' },
      { token: 'attribute.name', foreground: 'e0af68' },
    ],
    colors: {
      'editor.background': '#0b0f14',
      'editor.foreground': '#d7e0ea',
      'editorLineNumber.foreground': '#39485a',
      'editorLineNumber.activeForeground': '#93a6bb',
      'editor.selectionBackground': '#2a4a6b77',
      'editor.inactiveSelectionBackground': '#2a4a6b44',
      'editor.lineHighlightBackground': '#111823',
      'editorCursor.foreground': '#3ddc84',
      'editorIndentGuide.background1': '#18202b',
      'editorWidget.background': '#121821',
      'editorWidget.border': '#232c38',
      'scrollbarSlider.background': '#2a354380',
      'scrollbarSlider.hoverBackground': '#3a4a6080',
      'editorSuggestWidget.background': '#121821',
      'editorSuggestWidget.border': '#232c38',
    },
  });
}

export function EditorPane() {
  const { files, tabs, activeFile, setFile, openFile, closeTab } = useStudio();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  const currentPath = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;
    defineTheme();
    const editor = monaco.editor.create(containerRef.current, {
      value: '',
      language: 'plaintext',
      theme: 'apkforge',
      automaticLayout: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
      fontLigatures: true,
      lineHeight: 20,
      minimap: { enabled: true, renderCharacters: false, maxColumn: 80 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      renderLineHighlight: 'all',
      padding: { top: 12, bottom: 24 },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      tabSize: 4,
      bracketPairColorization: { enabled: true },
      guides: { indentation: true },
      suggest: { showWords: true },
    });
    editorRef.current = editor;
    editor.onDidChangeModelContent(() => {
      const path = currentPath.current;
      if (!path) return;
      const model = editor.getModel();
      if (!model) return;
      setFile(path, model.getValue());
    });
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeContent = activeFile ? files[activeFile] : undefined;
  const activeIsBinary = isDataUri(activeContent);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!activeFile || activeIsBinary) {
      editor.setModel(null);
      currentPath.current = undefined;
      return;
    }
    let model = models.current.get(activeFile);
    if (!model) {
      model = monaco.editor.createModel(
        files[activeFile] ?? '',
        languageFor(activeFile),
        monaco.Uri.parse(`file:///workspace/${activeFile}`),
      );
      models.current.set(activeFile, model);
    }
    editor.setModel(model);
    currentPath.current = activeFile;
    editor.focus();
  }, [activeFile, activeIsBinary, files]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeFile || activeIsBinary) return;
    const model = models.current.get(activeFile);
    if (!model) return;
    const external = files[activeFile];
    if (external !== undefined && external !== model.getValue()) {
      const position = editor.getPosition();
      model.setValue(external);
      if (position) editor.setPosition(position);
    }
  }, [files, activeFile, activeIsBinary]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-0)]">
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-[var(--border)] bg-[var(--bg-1)]">
        {tabs.map((tab) => (
          <div
            key={tab}
            onClick={() => openFile(tab)}
            className={`group flex items-center gap-2 border-r border-[var(--border)] px-3 text-[12.5px] ${
              activeFile === tab
                ? 'border-t-2 border-t-[var(--accent)] bg-[var(--bg-0)] text-[var(--text)]'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <span className="max-w-[190px] truncate">{tab.split('/').pop()}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab);
              }}
              className="opacity-0 transition-opacity hover:text-[var(--text)] group-hover:opacity-70"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {!tabs.length && (
          <div className="flex items-center px-3 text-[12px] text-[var(--muted)] opacity-70">
            No file open — pick one in the Explorer
          </div>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className={activeIsBinary ? 'hidden h-full w-full' : 'h-full w-full'} />
        {activeFile && activeIsBinary && activeContent && (
          <div className="flex h-full flex-col items-center justify-center gap-4 overflow-auto p-6 text-center">
            {mimeForPath(activeFile).startsWith('image/') && (
              <img
                src={activeContent}
                alt={activeFile}
                className="max-h-[62vh] max-w-full rounded-xl border border-[var(--border)] object-contain shadow-xl"
              />
            )}
            {mimeForPath(activeFile).startsWith('audio/') && (
              <audio src={activeContent} controls className="w-[min(420px,90%)]" />
            )}
            <div className="font-mono text-[11.5px] text-[var(--muted)]">
              {activeFile} · {mimeForPath(activeFile)} · {formatSize(decodeFileBytes(activeContent).length)} (stored uncompressed &amp; 4B aligned in APK)
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
