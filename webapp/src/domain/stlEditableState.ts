/**
 * Optional Build It Live edit data in a conventional binary STL.
 * Vertex positions, triangle count, per-triangle attributes and file length
 * are left untouched: only the lowest four bits of floating-point *normals*
 * carry the checked metadata. Slicers can still read ordinary STL geometry.
 * This data is a convenience for reopening ORIGINAL exported files, not a
 * replacement for the full-fidelity .BIL project (camera, revisions, etc.).
 */
export type StlEditBlock = { x: number; y: number; z: number; type: 'standard' | 'support'; color?: string };
export type StlEditState = {
  gridWidth: number;
  gridDepth: number;
  blocks: StlEditBlock[];
  surfaceMode: 'voxel' | 'soft1';
  smoothingStrength: number;
  smoothEdgeProfile?: 'classic' | 'rounded';
  colorsExact: boolean;
};

const PREFIX = 'BIL5:';
const DEFAULT_COLOR = '#e93222';

function checksum(data: Uint8Array, end: number): number {
  let crc = 0xffff;
  for (let i = 0; i < end; i++) {
    crc ^= data[i] << 8;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xffff) : ((crc << 1) & 0xffff);
  }
  return crc;
}

function validBlock(block: StlEditBlock, w: number, d: number): boolean {
  return [block.x, block.y, block.z].every(Number.isInteger) && block.x >= 0 && block.x < w && block.x < 16 &&
    block.y >= 0 && block.y < d && block.y < 16 && block.z >= 0 && block.z < 16;
}

function colorOf(block: StlEditBlock): string {
  return /^#[0-9a-f]{6}$/i.test(String(block.color ?? '')) ? String(block.color).toLowerCase() : DEFAULT_COLOR;
}

function encodeState(state: StlEditState, withColors: boolean): Uint8Array | null {
  const { gridWidth: w, gridDepth: d, blocks } = state;
  if (![w, d].every(v => Number.isInteger(v) && v >= 1 && v <= 16) || blocks.length > 65535) return null;
  if (blocks.some(b => !validBlock(b, w, d))) return null;
  const colors = withColors ? [...new Set(blocks.filter(b => b.type !== 'support').map(colorOf))] : [];
  if (colors.length > 8) return null;
  // BIL5: 8-byte header, two bytes per cell, optional palette, CRC16.
  const bytes = new Uint8Array(10 + blocks.length * 2 + colors.length * 3);
  bytes[0] = 0x42;
  bytes[1] = 0x35;
  bytes[2] = w;
  bytes[3] = d;
  bytes[4] = (state.surfaceMode === 'soft1' ? 1 : 0) | ((Math.min(31, Math.max(0, state.smoothingStrength | 0)) & 31) << 1) | (state.smoothEdgeProfile === 'rounded' ? 0x40 : 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(5, blocks.length, true);
  bytes[7] = colors.length;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const paletteIndex = b.type === 'support' || !colors.length ? 0 : colors.indexOf(colorOf(b));
    const packed = b.x | (b.y << 4) | (b.z << 8) | ((b.type === 'support' ? 1 : 0) << 12) | (paletteIndex << 13);
    view.setUint16(8 + i * 2, packed, true);
  }
  let offset = 8 + blocks.length * 2;
  for (const hex of colors) {
    bytes[offset++] = Number.parseInt(hex.slice(1, 3), 16);
    bytes[offset++] = Number.parseInt(hex.slice(3, 5), 16);
    bytes[offset++] = Number.parseInt(hex.slice(5, 7), 16);
  }
  view.setUint16(bytes.length - 2, checksum(bytes, bytes.length - 2), true);
  return bytes;
}

function decodeState(bytes: Uint8Array): StlEditState | null {
  if (bytes.length < 10 || bytes[0] !== 0x42 || bytes[1] !== 0x35) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = bytes[2], d = bytes[3], count = view.getUint16(5, true), paletteLength = bytes[7];
  if (w < 1 || d < 1 || w > 16 || d > 16 || paletteLength > 8 ||
      bytes.length !== 10 + 2 * count + 3 * paletteLength ||
      view.getUint16(bytes.length - 2, true) !== checksum(bytes, bytes.length - 2)) return null;
  const palette: string[] = [];
  const start = 8 + count * 2;
  for (let i = 0; i < paletteLength; i++) {
    palette.push('#' + [...bytes.subarray(start + i * 3, start + i * 3 + 3)].map(v => v.toString(16).padStart(2, '0')).join(''));
  }
  const blocks: StlEditBlock[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const packed = view.getUint16(8 + i * 2, true);
    const x = packed & 15, y = (packed >> 4) & 15, z = (packed >> 8) & 15;
    const support = Boolean(packed & 4096);
    const paletteIndex = (packed >> 13) & 7;
    if (x >= w || y >= d || (palette.length && !support && paletteIndex >= palette.length)) return null;
    const key = `${x}/${y}/${z}`;
    if (seen.has(key)) return null;
    seen.add(key);
    blocks.push({ x, y, z, type: support ? 'support' : 'standard', ...(support || !palette.length ? {} : { color: palette[paletteIndex] }) });
  }
  return {
    gridWidth: w, gridDepth: d, blocks,
    surfaceMode: (bytes[4] & 1) ? 'soft1' : 'voxel',
    smoothingStrength: (bytes[4] >> 1) & 31,
    smoothEdgeProfile: (bytes[4] & 0x40) ? 'rounded' : 'classic',
    colorsExact: palette.length > 0 || blocks.every(b => b.type === 'support'),
  };
}

function binBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

/** Returns null when the model cannot fit into a single STL's available normals. */
export function embedEditableStateInStl(input: ArrayBuffer | ArrayBufferView, state: StlEditState): {
  buffer: ArrayBuffer;
  triangleCount: number;
  colorsExact: boolean;
} | null {
  const source = binBytes(input);
  if (source.byteLength < 84) return null;
  const inputView = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const triangleCount = inputView.getUint32(80, true);
  if (triangleCount < 1 || source.byteLength !== 84 + triangleCount * 50) return null;
  const capacity = Math.floor(triangleCount * 3 / 2);
  let payload = encodeState(state, true);
  const colorsExact = !!payload && payload.length <= capacity;
  if (!colorsExact) payload = encodeState(state, false);
  if (!payload || payload.length > capacity) return null;
  const output = new Uint8Array(source);
  const view = new DataView(output.buffer);
  // Every normal is 3 floats. Alter only four lowest bits of each normal;
  // all vertices and topology stay byte-identical.
  for (let i = 0; i < payload.length * 2; i++) {
    const value = payload[Math.floor(i / 2)];
    const nibble = i % 2 ? value >> 4 : value & 15;
    const offset = 84 + Math.floor(i / 3) * 50 + (i % 3) * 4;
    view.setUint32(offset, (view.getUint32(offset, true) & 0xfffffff0) | nibble, true);
  }
  output.fill(0, 0, 80);
  output.set(new TextEncoder().encode(`${PREFIX}${payload.length.toString(36).toUpperCase()}`), 0);
  return { buffer: output.buffer, triangleCount, colorsExact };
}

/** Rejects damaged/truncated files via CRC rather than returning a wrong model. */
export function readEditableStateFromStl(buffer: ArrayBuffer): StlEditState | null {
  if (buffer.byteLength < 84) return null;
  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);
  if (buffer.byteLength !== 84 + triangleCount * 50 || triangleCount < 1) return null;
  const header = new TextDecoder().decode(new Uint8Array(buffer, 0, 80)).replace(/\0/g, '');
  const match = header.match(/^BIL5:([0-9A-Z]+)/);
  if (!match) return null;
  const length = Number.parseInt(match[1], 36);
  if (!Number.isSafeInteger(length) || length < 10 || length * 2 > triangleCount * 3) return null;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length * 2; i++) {
    const offset = 84 + Math.floor(i / 3) * 50 + (i % 3) * 4;
    const nibble = view.getUint32(offset, true) & 15;
    bytes[Math.floor(i / 2)] |= i % 2 ? nibble << 4 : nibble;
  }
  return decodeState(bytes);
}
