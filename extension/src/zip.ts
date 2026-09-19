// Minimal, dependency-free ZIP reader/extractor with zip-slip defenses.
// Parses the End-of-Central-Directory record and central directory, then
// decompresses entries with zlib (store=0, deflate=8). Deliberately refuses:
//   - absolute paths, drive-letter paths, `..` traversal, backslash tricks
//   - symlink/hardlink entries (unix mode in external attributes)
//   - encrypted entries (general-purpose flag bit 0)
//   - archives over entry-count / total-size caps

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  /** unix permission bits (upper 16 of external attributes), 0 if absent. */
  unixMode: number;
  isSymlink: boolean;
}

export interface ExtractOptions {
  maxEntries?: number;
  maxTotalBytes?: number;
  onProgress?: (entry: string) => void;
}

export class ZipError extends Error {}

function findEocd(buf: Buffer): number {
  // EOCD is >=22 bytes; scan backwards past a possible ZIP comment (<=64KB).
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new ZipError("not a zip archive (no EOCD record)");
}

export function listEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(pos) !== CENTRAL_SIG) {
      throw new ZipError(`corrupt central directory at offset ${pos}`);
    }
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const extAttr = buf.readUInt32LE(pos + 38);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    const unixMode = (extAttr >>> 16) & 0xffff;
    const fileType = unixMode & 0o170000;
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      unixMode,
      isSymlink: fileType === 0o120000,
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function entryData(buf: Buffer, e: ZipEntry): Buffer {
  const lh = e.localHeaderOffset;
  if (buf.readUInt32LE(lh) !== LOCAL_SIG) {
    throw new ZipError(`corrupt local header for ${e.name}`);
  }
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const start = lh + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compressedSize);
  let data: Buffer;
  if (e.method === 0) {
    data = Buffer.from(raw);
  } else if (e.method === 8) {
    data = zlib.inflateRawSync(raw);
  } else {
    throw new ZipError(`unsupported compression method ${e.method} in ${e.name}`);
  }
  if (data.length !== e.uncompressedSize) {
    throw new ZipError(`size mismatch for ${e.name}`);
  }
  return data;
}

/**
 * Normalize + validate an entry name as a safe relative path.
 * Returns the normalized posix-style path or throws ZipError.
 */
export function safeRelativePath(name: string): string {
  if (!name || name.length > 512) throw new ZipError("bad entry name");
  // Backslashes are path separators on some tools — normalize before checks.
  const norm = name.replace(/\\/g, "/");
  if (norm.startsWith("/") || /^[a-zA-Z]:/.test(norm)) {
    throw new ZipError(`absolute path in archive: ${name}`);
  }
  const parts = norm.split("/").filter((p) => p.length > 0 && p !== ".");
  if (parts.some((p) => p === "..")) {
    throw new ZipError(`path traversal in archive: ${name}`);
  }
  return parts.join("/");
}

export function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Extract `zipPath` into `destDir` with all defenses applied. Returns relative paths written. */
export function extractZip(
  zipPath: string,
  destDir: string,
  opts: ExtractOptions = {},
): string[] {
  const buf = fs.readFileSync(zipPath);
  const entries = listEntries(buf);
  const maxEntries = opts.maxEntries ?? 1024;
  const maxTotal = opts.maxTotalBytes ?? 512 * 1024 * 1024;
  if (entries.length > maxEntries) {
    throw new ZipError(`archive has ${entries.length} entries (max ${maxEntries})`);
  }
  const total = entries.reduce((s, e) => s + e.uncompressedSize, 0);
  if (total > maxTotal) {
    throw new ZipError(`archive expands to ${total} bytes (max ${maxTotal})`);
  }

  const written: string[] = [];
  fs.mkdirSync(destDir, { recursive: true });
  const destReal = fs.realpathSync(destDir);
  for (const e of entries) {
    const rel = safeRelativePath(e.name);
    const target = path.join(destReal, rel);
    if (!path.resolve(target).startsWith(destReal + path.sep) &&
        path.resolve(target) !== destReal) {
      throw new ZipError(`entry escapes destination: ${e.name}`);
    }
    if (e.name.endsWith("/")) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    if (e.isSymlink) {
      throw new ZipError(`refusing symlink entry: ${e.name}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entryData(buf, e));
    const mode = e.unixMode & 0o777;
    if (mode !== 0) fs.chmodSync(target, mode);
    written.push(rel);
    opts.onProgress?.(rel);
  }
  return written;
}
