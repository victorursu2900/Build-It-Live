/** Self-contained, standards-compliant, uncompressed ZIP archives.
 * Each archive includes both Builder libraries and individual portable .BIL
 * documents. No CDN, browser plugins, or npm dependencies are required.
 */
export type LibraryProject = {
  id: string; name?: string; savedAt?: string; blocks: Array<{x:number;y:number;z:number;type?:string;color?:string}>;
  gridSize?: number; gridWidth?: number; gridDepth?: number; surfaceMode?: string;
  smoothingStrength?: number; versions?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};
export type LibraryEntry = { mode: 'digital'|'hardware'; project: LibraryProject };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const LIMIT = 150 * 1024 * 1024;
const table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  table[i] = value >>> 0;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function safeName(value: string): string {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55) || 'model';
}
export function projectToBil(project: LibraryProject) {
  return {
    format: 'build-it-live-project', version: 1, app: 'Build It Live',
    savedAt: project.savedAt || new Date().toISOString(), project: { name: project.name || 'Untitled', units: 'mm', physicalBlockMm: 20 },
    workspace: {
      gridSize: project.gridSize || 16, gridWidth: project.gridWidth || 8,
      gridDepth: project.gridDepth || 16, maxHeight: 16, selectedBlockColor: '#e93222',
    },
    model: { blocks: project.blocks }, render: {
      surfaceMode: project.surfaceMode || 'voxel', smoothingStrength: project.smoothingStrength || 3, layerView: 0,
    },
  };
}
export function createStoredZip(files: Array<{path: string; content: string}>): Blob {
  const output: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let size = 0;
  for (const {path, content} of files) {
    if (!path || path.includes('..') || path.startsWith('/')) throw new Error('Invalid backup path');
    const name = encoder.encode(path);
    const data = encoder.encode(content);
    size += data.length;
    if (size > LIMIT || name.length > 65000) throw new Error('Backup is too large');
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true);
    l.setUint16(8, 0, true); l.setUint32(14, crc, true); l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true); l.setUint16(26, name.length, true);
    local.set(name, 30); local.set(data, 30 + name.length);
    output.push(local);
    const dir = new Uint8Array(46 + name.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true); d.setUint32(16, crc, true);
    d.setUint32(20, data.length, true); d.setUint32(24, data.length, true);
    d.setUint16(28, name.length, true); d.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir); offset += local.byteLength;
  }
  if (files.length > 65535) throw new Error('Too many files in backup');
  const directorySize = central.reduce((sum, bytes) => sum + bytes.length, 0);
  const footer = new Uint8Array(22);
  const f = new DataView(footer.buffer);
  f.setUint32(0, 0x06054b50, true); f.setUint16(8, files.length, true);
  f.setUint16(10, files.length, true); f.setUint32(12, directorySize, true);
  f.setUint32(16, offset, true);
  return new Blob([...output, ...central, footer].map(bytes => new Uint8Array(bytes).buffer), { type: 'application/zip' });
}
export function buildLibraryBackup(entries: LibraryEntry[]): Blob {
  const manifest = { format: 'build-it-live-library', version: 1, exportedAt: new Date().toISOString(), entries };
  const files = [{ path: 'library.json', content: JSON.stringify(manifest, null, 2) }];
  const names = new Set<string>();
  for (const {mode, project} of entries) {
    if (mode !== 'digital' && mode !== 'hardware') continue;
    let name = `projects/${mode}/${safeName(project.name || 'model')}-${safeName(project.id)}.bil`;
    for (let n = 2; names.has(name); n++) name = `projects/${mode}/${safeName(project.id)}-${n}.bil`;
    names.add(name);
    files.push({ path: name, content: JSON.stringify(projectToBil(project), null, 2) });
  }
  return createStoredZip(files);
}
export async function readStoredZipManifest(buffer: ArrayBuffer): Promise<LibraryEntry[]> {
  if (buffer.byteLength > LIMIT) throw new Error('Backup exceeds the 150 MB safety limit');
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedLength = view.getUint32(offset + 18, true);
    const originalLength = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (flags & 0x0008) throw new Error('Unsupported ZIP data descriptor');
    if (method !== 0) throw new Error('Unsupported compressed ZIP. Import a Build It Live library backup.');
    if (compressedLength !== originalLength) throw new Error('Invalid ZIP entry length');
    const start = offset + 30 + nameLength + extraLength;
    const end = start + compressedLength;
    if (end > bytes.length) throw new Error('Damaged ZIP archive');
    const path = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    if (path === 'library.json') {
      const data = bytes.subarray(start, end);
      if (crc32(data) !== view.getUint32(offset + 14, true)) throw new Error('Damaged library manifest');
      const manifest = JSON.parse(decoder.decode(data));
      if (manifest?.format !== 'build-it-live-library' || manifest?.version !== 1 || !Array.isArray(manifest.entries)) throw new Error('Not a Build It Live library backup');
      if (manifest.entries.length > 5000) throw new Error('Too many projects in backup');
      return manifest.entries.map((entry: LibraryEntry) => {
        if (!['digital', 'hardware'].includes(entry?.mode) || typeof entry?.project?.id !== 'string' ||
          !Array.isArray(entry?.project?.blocks) || entry.project.blocks.length > 100000) throw new Error('Invalid project in library backup');
        for (const block of entry.project.blocks) {
          if (![block.x, block.y, block.z].every((n) => Number.isInteger(n) && n >= 0 && n < 1000) ||
            !['standard', 'support'].includes(String(block.type))) throw new Error('Invalid block in backup');
        }
        return entry;
      });
    }
    offset = end;
  }
  throw new Error('No library.json manifest found');
}
/** Small SVG thumbnail. A diagram, not a substitute for an exported 3D render. */
export function makeModelThumbnail(blocks: LibraryProject['blocks']): string {
  const clean = blocks.filter(b => b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z));
  if (!clean.length) return `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 106"><rect width="144" height="106" fill="#eeece6"/><text x="72" y="56" text-anchor="middle" font-size="9" fill="#777">EMPTY</text></svg>')}`;
  const maxX = Math.max(...clean.map(b=>b.x)), minX = Math.min(...clean.map(b=>b.x));
  const maxY = Math.max(...clean.map(b=>b.y)), minY = Math.min(...clean.map(b=>b.y));
  const maxZ = Math.max(...clean.map(b=>b.z)), minZ = Math.min(...clean.map(b=>b.z));
  const width = (maxX-minX+maxY-minY+2)*11;
  const height = (maxX-minX+maxY-minY+2)*5.6+(maxZ+1)*13;
  const scale = Math.min(1.7, 120/width, 82/height);
  const cx = 72, cy = 81;
  const shapes = [...clean].sort((a,b)=> (a.x+a.y+a.z)-(b.x+b.y+b.z)).slice(-700).map(b=>{
    const x = cx + ((b.x-minX)-(b.y-minY))*11*scale;
    const y = cy - ((b.x-minX)+(b.y-minY))*5.5*scale - b.z*13*scale;
    const color = b.type === 'support' ? '#c8ccc9' : /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : '#e93222';
    const points = (coords:number[][]) => coords.map(([dx,dy])=>`${(x+dx*scale).toFixed(1)},${(y+dy*scale).toFixed(1)}`).join(' ');
    return `<polygon points="${points([[-11,0],[0,5.5],[0,18.5],[-11,13]])}" fill="#383735" opacity=".55"/><polygon points="${points([[0,5.5],[11,0],[11,13],[0,18.5]])}" fill="${color}" opacity=".72"/><polygon points="${points([[-11,0],[0,-5.5],[11,0],[0,5.5]])}" fill="${color}" stroke="#333" stroke-width=".45"/>`;
  }).join('');
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 106"><rect width="144" height="106" fill="#eeece6"/>${shapes}</svg>`)}`;
}

/** Compare a stored checkpoint with the project's current block layout. */
export function summarizeVersionDifference(current: LibraryProject['blocks'], previous: LibraryProject['blocks']): string {
  const coord = (block: LibraryProject['blocks'][number]) => `${block.x}/${block.y}/${block.z}`;
  const old = new Map(previous.map(block => [coord(block), block]));
  const now = new Map(current.map(block => [coord(block), block]));
  let added = 0, removed = 0, modified = 0;
  for (const [key, block] of now) {
    const past = old.get(key);
    if (!past) added++;
    else if (block.type !== past.type || (block.color || '') !== (past.color || '')) modified++;
  }
  for (const key of old.keys()) if (!now.has(key)) removed++;
  return `VS CURRENT / +${added} ADDED · −${removed} REMOVED · ${modified} CHANGED`;
}
