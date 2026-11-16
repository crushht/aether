/**
 * Static triage for an artifact a person attached or pasted.
 *
 * This runs in the browser-wide Node runtime, with no external tools: magic
 * bytes, PE/ELF/Mach-O headers, ZIP listings, entropy, printable strings and
 * indicators. That is enough to answer "what is this, is it packed, what does
 * it talk to" before anyone opens it. Nothing here executes the sample.
 *
 * Pure functions only — the route adds hashes; the regression harness loads
 * this file directly.
 */

export type FormatKind = 'executable' | 'archive' | 'document' | 'image' | 'media' | 'text' | 'binary';

export interface FormatGuess {
  id: string;
  label: string;
  kind: FormatKind;
  detail?: string;
}

const ascii = (bytes: Uint8Array, offset: number, length: number): string => {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[offset + index];
    if (byte === undefined) break;
    out += String.fromCharCode(byte);
  }
  return out;
};

const u16 = (bytes: Uint8Array, offset: number, little = true): number => {
  const a = bytes[offset] ?? 0;
  const b = bytes[offset + 1] ?? 0;
  return little ? a | (b << 8) : (a << 8) | b;
};

const u32 = (bytes: Uint8Array, offset: number, little = true): number => {
  const a = bytes[offset] ?? 0;
  const b = bytes[offset + 1] ?? 0;
  const c = bytes[offset + 2] ?? 0;
  const d = bytes[offset + 3] ?? 0;
  return little ? (a | (b << 8) | (c << 16) | (d << 24)) >>> 0 : ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
};

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  signature.every((value, index) => bytes[offset + index] === value);

const containsAscii = (bytes: Uint8Array, needle: string, window = 4096): boolean => {
  const target = needle;
  const limit = Math.min(bytes.length, window);
  let tail = '';
  for (let index = 0; index < limit; index += 1) {
    const byte = bytes[index];
    tail += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '\u0000';
    if (tail.length > target.length) tail = tail.slice(-target.length);
    if (tail === target) return true;
  }
  return false;
};

/* ----------------------------------------------------------------- format */

const PE_MACHINES: Record<number, string> = {
  0x014c: 'x86 (32-bit)',
  0x8664: 'x64',
  0x01c0: 'ARM',
  0x01c4: 'ARMv7',
  0xaa64: 'ARM64',
  0x0200: 'Itanium',
};

const ELF_MACHINES: Record<number, string> = {
  0x03: 'x86',
  0x28: 'ARM',
  0x3e: 'x64',
  0xb7: 'ARM64',
  0xf3: 'RISC-V',
  0x08: 'MIPS',
};

const MACHO_CPUS: Record<number, string> = {
  7: 'x86',
  0x01000007: 'x64',
  12: 'ARM',
  0x0100000c: 'ARM64',
  18: 'PowerPC',
};

/** Big-endian look from a byte window: handy for Mach-O's swapped magic. */
export function sniffFormat(bytes: Uint8Array): FormatGuess {
  if (!bytes.length) return { id: 'empty', label: 'Empty file', kind: 'binary' };

  if (startsWith(bytes, [0x4d, 0x5a])) {
    const peOffset = u32(bytes, 0x3c, true);
    if (peOffset > 0 && peOffset + 4 < bytes.length && ascii(bytes, peOffset, 4) === 'PE\u0000\u0000') {
      const machine = u16(bytes, peOffset + 4, true);
      const characteristics = u16(bytes, peOffset + 22, true);
      const dll = (characteristics & 0x2000) !== 0;
      return {
        id: 'pe',
        label: dll ? 'Windows DLL (PE)' : 'Windows executable (PE)',
        kind: 'executable',
        detail: PE_MACHINES[machine] ?? `machine 0x${machine.toString(16)}`,
      };
    }
    return { id: 'mz', label: 'DOS executable (MZ)', kind: 'executable' };
  }
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) {
    const bits = bytes[4] === 2 ? 64 : 32;
    const little = bytes[5] !== 2;
    const machine = u16(bytes, 18, little);
    return {
      id: 'elf',
      label: `ELF ${bits}-bit`,
      kind: 'executable',
      detail: ELF_MACHINES[machine] ?? `machine 0x${machine.toString(16)}`,
    };
  }
  if (startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe]) && (bytes[4] ?? 0) < 0x50) {
    return { id: 'macho', label: 'Mach-O (universal)', kind: 'executable' };
  }
  if (startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf])) {
    return { id: 'macho', label: 'Mach-O 32-bit', kind: 'executable', detail: MACHO_CPUS[u32(bytes, 4, true) >>> 0] };
  }
  if (startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe])) {
    return { id: 'macho', label: 'Mach-O 64-bit', kind: 'executable', detail: MACHO_CPUS[u32(bytes, 4, true)] };
  }
  if (startsWith(bytes, [0xce, 0xfa, 0xed, 0xfe])) {
    return { id: 'macho', label: 'Mach-O 32-bit (LE)', kind: 'executable', detail: MACHO_CPUS[u32(bytes, 4, true)] };
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    const window = 65_536;
    if (containsAscii(bytes, 'AndroidManifest.xml', window)) return { id: 'apk', label: 'Android package (APK)', kind: 'archive' };
    if (containsAscii(bytes, 'classes.dex', window)) return { id: 'zip-dex', label: 'ZIP with DEX bytecode', kind: 'archive' };
    if (containsAscii(bytes, 'META-INF/MANIFEST.MF', window)) return { id: 'jar', label: 'Java archive (JAR)', kind: 'archive' };
    if (containsAscii(bytes, '[Content_Types].xml', window)) return { id: 'ooxml', label: 'Office Open XML', kind: 'document' };
    if (containsAscii(bytes, 'word/document.xml', window)) return { id: 'docx', label: 'Word document (DOCX)', kind: 'document' };
    if (containsAscii(bytes, 'xl/workbook.xml', window)) return { id: 'xlsx', label: 'Excel workbook (XLSX)', kind: 'document' };
    if (containsAscii(bytes, 'ppt/presentation.xml', window)) return { id: 'pptx', label: 'PowerPoint deck (PPTX)', kind: 'document' };
    return { id: 'zip', label: 'ZIP archive', kind: 'archive' };
  }
  if (startsWith(bytes, [0x1f, 0x8b])) return { id: 'gzip', label: 'GZIP archive', kind: 'archive' };
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { id: '7z', label: '7-Zip archive', kind: 'archive' };
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21])) return { id: 'rar', label: 'RAR archive', kind: 'archive' };
  if (startsWith(bytes, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return { id: 'xz', label: 'XZ archive', kind: 'archive' };
  if (startsWith(bytes, [0x28, 0xb5, 0x2f, 0xfd])) return { id: 'zstd', label: 'Zstandard stream', kind: 'archive' };
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return { id: 'ole', label: 'OLE compound file (DOC/XLS/MSI)', kind: 'document' };
  if (ascii(bytes, 0, 5) === '%PDF-') return { id: 'pdf', label: 'PDF document', kind: 'document' };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { id: 'png', label: 'PNG image', kind: 'image' };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { id: 'jpeg', label: 'JPEG image', kind: 'image' };
  if (ascii(bytes, 0, 4) === 'GIF8') return { id: 'gif', label: 'GIF image', kind: 'image' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return { id: 'webp', label: 'WebP image', kind: 'image' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return { id: 'wav', label: 'WAV audio', kind: 'media' };
  if (ascii(bytes, 0, 4) === 'OggS') return { id: 'ogg', label: 'Ogg media', kind: 'media' };
  if (ascii(bytes, 0, 3) === 'ID3') return { id: 'mp3', label: 'MP3 audio', kind: 'media' };
  if (ascii(bytes, 0, 4) === 'fLaC') return { id: 'flac', label: 'FLAC audio', kind: 'media' };
  if (ascii(bytes, 0, 4) === 'SQLi') return { id: 'sqlite', label: 'SQLite database', kind: 'document' };
  if (ascii(bytes, 0, 2) === '#!') return { id: 'script', label: 'Script (shebang)', kind: 'text', detail: ascii(bytes, 2, 40).split('\n')[0].trim() };
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return { id: 'text', label: 'UTF-8 text (BOM)', kind: 'text' };

  // No magic matched: text or opaque bytes?
  const probe = bytes.subarray(0, Math.min(bytes.length, 4096));
  let printable = 0;
  for (const byte of probe) {
    if (byte === 0) return { id: 'binary', label: 'Binary data', kind: 'binary' };
    if (byte >= 0x20 || byte === 9 || byte === 10 || byte === 13) printable += 1;
  }
  if (printable / probe.length > 0.92) {
    const head = ascii(bytes, 0, 200).trimStart();
    if (head.startsWith('{') || head.startsWith('[')) return { id: 'json', label: 'JSON text', kind: 'text' };
    if (/^<(!doctype|html|\?xml)/i.test(head)) return { id: 'markup', label: 'Markup (HTML/XML)', kind: 'text' };
    return { id: 'text', label: 'Text', kind: 'text' };
  }
  return { id: 'binary', label: 'Binary data', kind: 'binary' };
}

/* --------------------------------------------------------------- structure */

export interface PeSection {
  name: string;
  virtualSize: number;
  rawSize: number;
  entropy: number;
}

export interface PeInfo {
  machine: string;
  timestamp: string;
  subsystem: string;
  dll: boolean;
  sections: PeSection[];
}

export interface ElfInfo {
  bits: 32 | 64;
  endian: 'little' | 'big';
  machine: string;
  entry: string;
}

export interface MachoInfo {
  bits: 32 | 64;
  cpu: string;
  filetype: string;
}

export interface ZipEntry {
  name: string;
  size: number;
  compressed: number;
}

const SUBSYSTEMS: Record<number, string> = {
  1: 'native',
  2: 'GUI',
  3: 'console',
  9: 'Windows CE',
  10: 'EFI application',
};

/** Sections, machine and build stamp — a packed sample shows up as one huge high-entropy section. */
export function readPe(bytes: Uint8Array): PeInfo | null {
  if (!startsWith(bytes, [0x4d, 0x5a])) return null;
  const peOffset = u32(bytes, 0x3c, true);
  if (!peOffset || peOffset + 24 >= bytes.length) return null;
  if (ascii(bytes, peOffset, 4) !== 'PE\u0000\u0000') return null;
  const machine = u16(bytes, peOffset + 4, true);
  const sectionCount = u16(bytes, peOffset + 6, true);
  const stamp = u32(bytes, peOffset + 8, true);
  const optionalSize = u16(bytes, peOffset + 20, true);
  const characteristics = u16(bytes, peOffset + 22, true);
  const optional = peOffset + 24;
  const subsystem = u16(bytes, optional + 68, true);
  const sectionTable = optional + optionalSize;
  const sections: PeSection[] = [];
  for (let index = 0; index < Math.min(sectionCount, 40); index += 1) {
    const at = sectionTable + index * 40;
    if (at + 40 > bytes.length) break;
    const name = ascii(bytes, at, 8).replace(/\u0000+$/, '');
    const virtualSize = u32(bytes, at + 8, true);
    const rawSize = u32(bytes, at + 16, true);
    const rawPointer = u32(bytes, at + 20, true);
    const body = bytes.subarray(rawPointer, rawPointer + rawSize);
    sections.push({ name, virtualSize, rawSize, entropy: shannonEntropy(body) });
  }
  return {
    machine: PE_MACHINES[machine] ?? `machine 0x${machine.toString(16)}`,
    timestamp: stamp ? new Date(stamp * 1000).toISOString().slice(0, 10) : 'unknown',
    subsystem: SUBSYSTEMS[subsystem] ?? `subsystem ${subsystem}`,
    dll: (characteristics & 0x2000) !== 0,
    sections,
  };
}

export function readElf(bytes: Uint8Array): ElfInfo | null {
  if (!startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return null;
  const bits = bytes[4] === 2 ? 64 : 32;
  const little = bytes[5] !== 2;
  const machine = u16(bytes, 18, little);
  const entry = bits === 64 ? u32(bytes, 24, little) + u32(bytes, 28, little) * 2 ** 32 : u32(bytes, 24, little);
  return {
    bits,
    endian: little ? 'little' : 'big',
    machine: ELF_MACHINES[machine] ?? `machine 0x${machine.toString(16)}`,
    entry: `0x${Math.max(0, entry).toString(16)}`,
  };
}

const MACHO_FILETYPES: Record<number, string> = {
  1: 'object',
  2: 'executable',
  6: 'dynamic library',
  8: 'bundle',
};

export function readMacho(bytes: Uint8Array): MachoInfo | null {
  const head = ascii(bytes, 0, 4);
  if (!['\u00fe\u00ed\u00fa\u00ce', '\u00fe\u00ed\u00fa\u00cf', '\u00cf\u00fa\u00ed\u00fe', '\u00ce\u00fa\u00ed\u00fe'].includes(head)) return null;
  const reversed = head === '\u00fe\u00ed\u00fa\u00ce' || head === '\u00fe\u00ed\u00fa\u00cf';
  const bits = head === '\u00fe\u00ed\u00fa\u00cf' || head === '\u00cf\u00fa\u00ed\u00fe' ? 64 : 32;
  const cpu = u32(bytes, 4, !reversed);
  const filetype = u32(bytes, 12, !reversed);
  return { bits, cpu: MACHO_CPUS[cpu] ?? `cpu 0x${cpu.toString(16)}`, filetype: MACHO_FILETYPES[filetype] ?? `type ${filetype}` };
}

/**
 * ZIP central directory listing. Works for APK/JAR/OOXML too, which is where
 * "what is inside this thing" usually starts. Falls back to a signature scan
 * when the archive is truncated or streamed without an end record.
 */
export function readZipEntries(bytes: Uint8Array, limit = 40): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 65_558);
  for (let index = bytes.length - 22; index >= floor; index -= 1) {
    if (u32(bytes, index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }

  if (eocd >= 0) {
    const count = u16(bytes, eocd + 10, true);
    let cursor = u32(bytes, eocd + 16, true);
    for (let index = 0; index < Math.min(count, limit); index += 1) {
      if (u32(bytes, cursor, true) !== 0x02014b50) break;
      const nameLength = u16(bytes, cursor + 28, true);
      const extraLength = u16(bytes, cursor + 30, true);
      const commentLength = u16(bytes, cursor + 32, true);
      const compressed = u32(bytes, cursor + 20, true);
      const size = u32(bytes, cursor + 24, true);
      if (cursor + 46 + nameLength > bytes.length) break;
      entries.push({ name: ascii(bytes, cursor + 46, nameLength), size, compressed });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    if (entries.length) return entries;
  }

  // no usable end record: list the local file headers we can see
  for (let index = 0; index + 30 < bytes.length && entries.length < limit; index += 1) {
    if (u32(bytes, index, true) !== 0x04034b50) continue;
    const nameLength = u16(bytes, index + 26, true);
    const extraLength = u16(bytes, index + 28, true);
    if (!nameLength || index + 30 + nameLength > bytes.length) continue;
    const name = ascii(bytes, index + 30, nameLength);
    if (!/^[\x20-\x7e]{1,200}$/.test(name)) continue;
    entries.push({ name, size: u32(bytes, index + 22, true), compressed: u32(bytes, index + 18, true) });
    index += 29 + nameLength + extraLength;
  }
  return entries;
}

/* ------------------------------------------------------------------ content */

/** Shannon entropy over the first `limit` bytes: ~8 means packed or encrypted. */
export function shannonEntropy(bytes: Uint8Array, limit = 262_144): number {
  const slice = bytes.length > limit ? bytes.subarray(0, limit) : bytes;
  if (!slice.length) return 0;
  const counts = new Uint32Array(256);
  for (const byte of slice) counts[byte] += 1;
  let entropy = 0;
  for (const count of counts) {
    if (!count) continue;
    const p = count / slice.length;
    entropy -= p * Math.log2(p);
  }
  return Math.round(entropy * 1000) / 1000;
}

const PRINTABLE = /[\x20-\x7e\t]/;

/** Printable ASCII runs, the classic `strings` view. */
export function extractStrings(bytes: Uint8Array, minLength = 5, limit = 160): string[] {
  const out: string[] = [];
  let run = '';
  for (const byte of bytes) {
    const char = String.fromCharCode(byte);
    if (PRINTABLE.test(char)) {
      run += char;
    } else {
      if (run.length >= minLength) out.push(run);
      run = '';
      if (out.length >= limit) return out;
    }
  }
  if (run.length >= minLength) out.push(run);
  return out.slice(0, limit);
}

/** UTF-16LE runs — where a Windows binary keeps most of its text. */
export function extractWideStrings(bytes: Uint8Array, minLength = 5, limit = 80): string[] {
  const out: string[] = [];
  let run = '';
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const low = bytes[index];
    const high = bytes[index + 1];
    const char = high === 0 ? String.fromCharCode(low) : '';
    if (char && PRINTABLE.test(char)) {
      run += char;
    } else {
      if (run.length >= minLength) out.push(run);
      run = '';
      if (out.length >= limit) return out;
    }
  }
  if (run.length >= minLength) out.push(run);
  return out.slice(0, limit);
}

export type IndicatorKind = 'url' | 'ip' | 'domain' | 'email' | 'path' | 'registry' | 'api' | 'command' | 'base64' | 'hex';

export interface Indicator {
  kind: IndicatorKind;
  value: string;
}

const RULES: { kind: IndicatorKind; pattern: RegExp }[] = [
  { kind: 'url', pattern: /\bhttps?:\/\/[^\s"'<>]{4,200}/i },
  { kind: 'email', pattern: /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i },
  { kind: 'ip', pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/ },
  { kind: 'registry', pattern: /\b(?:HKLM|HKCU|HKCR|HKEY_[A-Z_]+)\\[^\s"']{3,120}/i },
  { kind: 'path', pattern: /\b[A-Za-z]:\\(?:[^\\\s"']+\\){1,6}[^\\\s"']{1,60}/ },
  { kind: 'domain', pattern: /\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|cn|ru|top|xyz|info|biz|me|co)\b/i },
  { kind: 'api', pattern: /\b(?:VirtualAlloc(?:Ex)?|VirtualProtect|CreateRemoteThread|WriteProcessMemory|LoadLibrary[AW]?|GetProcAddress|WinHttpOpen|InternetOpen[AW]?|URLDownloadToFile[AW]?|ShellExecute[AW]?|CreateProcess[AW]?|NtUnmapViewOfSection|SetWindowsHookEx[AW]?|RegSetValueEx[AW]?|CryptEncrypt)\b/ },
  { kind: 'command', pattern: /\b(?:powershell(?:\.exe)?\s+-[a-z]{1,4}|cmd(?:\.exe)?\s+\/c|schtasks\s+\/create|reg\s+add|wmic\s+process\s+call|curl\s+-[a-zA-Z]*[oO]|wget\s+http|chmod\s+\+x|nc\s+-e)\b/i },
  { kind: 'base64', pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/ },
  { kind: 'hex', pattern: /\b(?:[0-9a-f]{2}){16,}\b/i },
];

/** First match per rule per string, de-duplicated and capped. */
export function findIndicators(strings: string[], perKind = 8): Indicator[] {
  const seen = new Set<string>();
  const out: Indicator[] = [];
  const counts = new Map<IndicatorKind, number>();
  for (const value of strings) {
    for (const rule of RULES) {
      const used = counts.get(rule.kind) ?? 0;
      if (used >= perKind) continue;
      const match = rule.pattern.exec(value);
      if (!match) continue;
      const hit = match[0].slice(0, 200);
      if (seen.has(`${rule.kind}:${hit}`)) continue;
      seen.add(`${rule.kind}:${hit}`);
      counts.set(rule.kind, used + 1);
      out.push({ kind: rule.kind, value: hit });
    }
  }
  return out;
}

export interface DecodedBlob {
  kind: 'base64' | 'hex';
  bytes: number;
  format: string;
}

/** A base64 or hex blob that decodes to something with a known magic is a payload, not text. */
export function decodeEmbedded(text: string): DecodedBlob[] {
  const found: DecodedBlob[] = [];
  const base64 = /\b[A-Za-z0-9+/]{24,}={0,2}\b/g;
  let match: RegExpExecArray | null;
  while ((match = base64.exec(text)) && found.length < 4) {
    try {
      const buffer = Buffer.from(match[0], 'base64');
      if (buffer.length < 16) continue;
      const guess = sniffFormat(new Uint8Array(buffer));
      if (guess.id !== 'binary' && guess.id !== 'text') {
        found.push({ kind: 'base64', bytes: buffer.length, format: guess.label });
      }
    } catch {
      /* not base64 after all */
    }
  }
  const hex = /\b(?:[0-9a-fA-F]{2}){24,}\b/g;
  while ((match = hex.exec(text)) && found.length < 6) {
    const buffer = Buffer.from(match[0], 'hex');
    if (buffer.length < 16) continue;
    const guess = sniffFormat(new Uint8Array(buffer));
    if (guess.id !== 'binary' && guess.id !== 'text') found.push({ kind: 'hex', bytes: buffer.length, format: guess.label });
  }
  return found;
}

export function hexPreview(bytes: Uint8Array, limit = 128): string[] {
  const lines: string[] = [];
  const end = Math.min(bytes.length, limit);
  for (let offset = 0; offset < end; offset += 16) {
    const chunk = bytes.subarray(offset, Math.min(offset + 16, end));
    const hex = [...chunk].map((byte) => byte.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const text = [...chunk].map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex}  ${text}`);
  }
  return lines;
}

export interface ArtifactReport {
  name: string;
  size: number;
  format: FormatGuess;
  entropy: number;
  packed: boolean;
  pe?: PeInfo;
  elf?: ElfInfo;
  macho?: MachoInfo;
  zip?: ZipEntry[];
  strings: string[];
  wide: string[];
  indicators: Indicator[];
  embedded: DecodedBlob[];
  hex: string[];
  notes: string[];
}

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * One report for the agent: what it is, whether it is packed, and the strings
 * worth a human's attention. Never throws on malformed input.
 */
export function inspectArtifact(input: Uint8Array, name = 'artifact'): ArtifactReport {
  const bytes = input.length > MAX_BYTES ? input.subarray(0, MAX_BYTES) : input;
  const format = sniffFormat(bytes);
  const entropy = shannonEntropy(bytes);
  const strings = format.kind === 'text' ? [] : extractStrings(bytes);
  const wide = format.kind === 'text' ? [] : extractWideStrings(bytes);
  const indicators = findIndicators(
    format.kind === 'text' ? ascii(bytes, 0, Math.min(bytes.length, 200_000)).split(/\r?\n/) : [...strings, ...wide],
  );
  const embedded = decodeEmbedded(asciiText(bytes));
  const pe = readPe(bytes) ?? undefined;
  const elf = readElf(bytes) ?? undefined;
  const macho = readMacho(bytes) ?? undefined;
  const zip = format.kind === 'archive' ? readZipEntries(bytes) : [];

  const notes: string[] = [];
  if (entropy >= 7.2 && format.kind !== 'image' && format.kind !== 'media') {
    notes.push('Entropy is near the maximum — packed, encrypted or compressed payload.');
  }
  for (const section of pe?.sections ?? []) {
    if (section.entropy >= 7.2 && section.rawSize > 4096) {
      notes.push(`PE section ${section.name || '(unnamed)'} is high entropy (${section.entropy}) — a common packer/Crypter signature.`);
    }
  }
  if (embedded.length) notes.push('An encoded blob inside decodes to a recognised file format — unwrap it before judging the sample.');
  if (indicators.some((item) => item.kind === 'command')) notes.push('Command strings are present; treat the sample as an execution chain, not data.');
  if (format.id === 'apk' && zip.length) {
    const dex = zip.filter((entry) => /\.dex$/.test(entry.name)).length;
    if (dex) notes.push(`APK carries ${dex} DEX file(s) — smali/Java decompilation is the next step.`);
  }
  if (!notes.length) notes.push('Nothing anomalous in the static pass; behaviour still needs a sandbox.');

  return {
    name,
    size: input.length,
    format,
    entropy,
    packed: entropy >= 7.2,
    ...(pe ? { pe } : {}),
    ...(elf ? { elf } : {}),
    ...(macho ? { macho } : {}),
    ...(zip.length ? { zip } : {}),
    strings: strings.slice(0, 80),
    wide: wide.slice(0, 40),
    indicators,
    embedded,
    hex: hexPreview(bytes, 96),
    notes,
  };
}

function asciiText(bytes: Uint8Array): string {
  return bytes.length > 200_000 ? ascii(bytes, 0, 200_000) : ascii(bytes, 0, bytes.length);
}
