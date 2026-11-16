import { inflateSync } from 'node:zlib';

/**
 * Dependency-free PDF text fallback.
 *
 * Most text PDFs draw glyphs with `Tj` / `TJ` inside FlateDecode streams. We
 * inflate every stream, pull the string operands and decode the common escapes.
 * Scanned pages and CID-keyed fonts (most CJK PDFs) yield little or nothing —
 * the caller says so instead of pretending.
 */

const MAX_CHARS = 120_000;

const LITERAL = /\((?:\\.|[^\\()])*\)/g;

const ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  '(': '(',
  ')': ')',
  '\\': '\\',
};

function decodeLiteral(token: string) {
  const body = token.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = body[(i += 1)];
    if (next === undefined) break;
    if (ESCAPES[next]) out += ESCAPES[next];
    else if (/[0-7]/.test(next)) {
      let oct = next;
      while (oct.length < 3 && /[0-7]/.test(body[i + 1] ?? '')) oct += body[(i += 1)];
      out += String.fromCharCode(Number.parseInt(oct, 8));
    } else out += next;
  }
  return out;
}

function decodeHex(token: string) {
  const hex = token.slice(1, -1).replace(/\s+/g, '');
  if (hex.length < 2 || hex.length % 2 !== 0) return '';
  const bytes = Buffer.from(hex, 'hex');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = Buffer.from(bytes.subarray(2));
    for (let i = 0; i + 1 < body.length; i += 2) {
      const swap = body[i];
      body[i] = body[i + 1];
      body[i + 1] = swap;
    }
    return body.toString('utf16le');
  }
  return bytes.toString('latin1');
}

function textFromContent(content: string) {
  const parts: string[] = [];
  for (const match of content.matchAll(/\[((?:.|\n)*?)\]\s*TJ/g)) {
    const inner = match[1];
    for (const literal of inner.match(LITERAL) ?? []) parts.push(decodeLiteral(literal));
    for (const hex of inner.match(/<[0-9a-fA-F\s]+>/g) ?? []) parts.push(decodeHex(hex));
  }
  for (const match of content.matchAll(/\((?:\\.|[^\\()])*\)\s*(?:Tj|'|")/g)) {
    const literal = match[0].match(LITERAL)?.[0];
    if (literal) parts.push(decodeLiteral(literal));
  }
  for (const match of content.matchAll(/<([0-9a-fA-F\s]{4,})>\s*Tj/g)) {
    parts.push(decodeHex(`<${match[1]}>`));
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export interface PdfText {
  text: string;
  chars: number;
  truncated: boolean;
  streams: number;
}

export function extractPdfText(buffer: Buffer): PdfText {
  const raw = buffer.toString('latin1');
  const pieces: string[] = [];
  let streams = 0;
  const stream = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;

  while ((match = stream.exec(raw))) {
    const data = Buffer.from(match[1], 'latin1');
    let content = '';
    try {
      content = inflateSync(data).toString('latin1');
    } catch {
      content = data.toString('latin1');
    }
    streams += 1;
    if (/Tj|TJ/.test(content)) {
      const text = textFromContent(content);
      if (text) pieces.push(text);
    }
  }

  const text = pieces.join('\n').replace(/[ \t]+/g, ' ').trim();
  return {
    text: text.slice(0, MAX_CHARS),
    chars: text.length,
    truncated: text.length > MAX_CHARS,
    streams,
  };
}
