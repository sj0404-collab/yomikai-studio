export type FileMap = Record<string, string>;

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

const DATA_URI_RE = /^data:([^;,]+)?;base64,/;

export function isBinaryPath(path: string): boolean {
  return /\.(png|jpg|jpeg|webp|gif|mp3|mp4|ogg|wav|woff2)$/i.test(path);
}

export function mimeForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'wav':
      return 'audio/wav';
    case 'mp3':
      return 'audio/mpeg';
    case 'ogg':
      return 'audio/ogg';
    case 'mp4':
      return 'video/mp4';
    case 'woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

export function isDataUri(content: string | undefined): boolean {
  return Boolean(content && DATA_URI_RE.test(content));
}

export function encodeBinaryDataUri(bytes: Uint8Array, path: string): string {
  const mime = mimeForPath(path);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export function decodeFileBytes(content: string): Uint8Array {
  const match = DATA_URI_RE.exec(content);
  if (!match) {
    return new TextEncoder().encode(content);
  }
  const b64 = content.slice(match[0].length);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function listPaths(files: FileMap): string[] {
  return Object.keys(files).sort();
}

export function buildTree(files: FileMap, root = ''): TreeNode[] {
  const rootNode: TreeNode = { name: root || 'root', path: root, type: 'dir', children: [] };
  const dirs = new Map<string, TreeNode>();
  dirs.set('', rootNode);

  const ensureDir = (path: string): TreeNode => {
    if (dirs.has(path)) return dirs.get(path)!;
    const parent = ensureDir(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
    const node: TreeNode = {
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      type: 'dir',
      children: [],
    };
    parent.children!.push(node);
    dirs.set(path, node);
    return node;
  };

  for (const path of Object.keys(files).sort()) {
    const idx = path.lastIndexOf('/');
    const dir = idx >= 0 ? path.slice(0, idx) : '';
    const parent = ensureDir(dir);
    parent.children!.push({ name: path.slice(idx + 1), path, type: 'file' });
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => {
      if (n.children) sort(n.children);
    });
  };
  sort(rootNode.children!);
  return rootNode.children!;
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function dirName(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? '' : path.slice(0, idx);
}

export function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\//, '');
}

export function languageFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (path.endsWith('.kts')) return 'kotlin';
  switch (ext) {
    case 'kt':
    case 'kts':
      return 'kotlin';
    case 'java':
      return 'java';
    case 'js':
    case 'mjs':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'json':
      return 'json';
    case 'xml':
      return 'xml';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'md':
      return 'markdown';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'sh':
      return 'shell';
    case 'properties':
      return 'ini';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif':
      return 'img';
    case 'wav':
    case 'mp3':
    case 'ogg':
      return 'audio';
    default:
      return 'plaintext';
  }
}

export function countLines(text: string): number {
  if (isDataUri(text)) return 1;
  return text.split('\n').length;
}

export const FILE_ICONS: Record<string, string> = {
  kt: 'K',
  kts: 'K',
  java: 'J',
  js: 'JS',
  json: '{}',
  xml: 'X',
  html: '<>',
  css: '#',
  md: 'M',
  properties: 'P',
  yaml: 'Y',
  yml: 'Y',
  gradle: 'G',
  png: 'IMG',
  jpg: 'IMG',
  jpeg: 'IMG',
  webp: 'IMG',
  wav: 'AUD',
  mp3: 'AUD',
  ogg: 'AUD',
};
