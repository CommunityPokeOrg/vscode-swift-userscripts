// .vswift bundle support: manifest validation, platform binary selection,
// and controlled extraction to a cache/install directory.

import * as fs from "fs";
import * as path from "path";
import { entryData, extractZip, listEntries, safeRelativePath, sha256File } from "./zip";

export const VSWIFT_FORMAT_VERSION = 1;
export const MANIFEST_NAME = "userscript.json";

export interface VswiftManifest {
  formatVersion: number;
  name: string;
  version: string;
  /** Map of platform triple/shorthand → archive-relative binary path. */
  binaries: Record<string, string>;
  /** Optional archive-relative asset directory, copied verbatim. */
  assets?: string;
}

export class VswiftError extends Error {}

/** Ordered platform keys a host should try, most specific → universal. */
export function platformCandidates(platform: string, arch: string): string[] {
  const archMap: Record<string, string> = { x64: "x86_64", arm64: "aarch64" };
  const a = archMap[arch] ?? arch;
  switch (platform) {
    case "linux":
      return [`${a}-unknown-linux-gnu`, `${a}-linux`, `linux-${arch}`, "universal"];
    case "darwin":
      return [`${a}-apple-darwin`, `${a}-macos`, `macos-${arch}`, "universal"];
    case "win32":
      return [`${a}-pc-windows-msvc`, `${a}-windows`, `windows-${arch}`, "universal"];
    default:
      return [`${a}-${platform}`, "universal"];
  }
}

export function selectBinaryKey(
  manifest: VswiftManifest,
  platform = process.platform,
  arch = process.arch,
): string | null {
  for (const key of platformCandidates(platform, arch)) {
    if (manifest.binaries[key]) return key;
  }
  return null;
}

export function parseManifest(raw: string): VswiftManifest {
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch (e) {
    throw new VswiftError(`manifest is not valid JSON: ${e}`);
  }
  if (typeof m !== "object" || m === null) throw new VswiftError("manifest is not an object");
  if (m.formatVersion !== VSWIFT_FORMAT_VERSION) {
    throw new VswiftError(
      `unsupported formatVersion ${m.formatVersion} (expected ${VSWIFT_FORMAT_VERSION})`,
    );
  }
  if (typeof m.name !== "string" || !/^[\w.-]+$/.test(m.name)) {
    throw new VswiftError("manifest.name must be a non-empty [\\w.-] string");
  }
  if (typeof m.version !== "string" || m.version.length === 0) {
    throw new VswiftError("manifest.version must be a non-empty string");
  }
  if (typeof m.binaries !== "object" || m.binaries === null || Array.isArray(m.binaries)) {
    throw new VswiftError("manifest.binaries must be an object of triple → path");
  }
  for (const [triple, p] of Object.entries(m.binaries)) {
    if (typeof p !== "string") throw new VswiftError(`binaries.${triple} must be a path string`);
    safeRelativePath(p); // reuses traversal defense — throws ZipError on bad paths
  }
  if (m.assets !== undefined && typeof m.assets !== "string") {
    throw new VswiftError("manifest.assets must be a string path");
  }
  if (m.assets) safeRelativePath(m.assets);
  return m as VswiftManifest;
}

/** Read and validate the manifest inside a .vswift archive without extracting. */
export function inspectBundle(zipPath: string): VswiftManifest {
  const buf = fs.readFileSync(zipPath);
  const entries = listEntries(buf);
  const manifestEntry = entries.find((e) => safeRelativePath(e.name) === MANIFEST_NAME);
  if (!manifestEntry) {
    throw new VswiftError(`bundle lacks ${MANIFEST_NAME}`);
  }
  return parseManifest(entryData(buf, manifestEntry).toString("utf8"));
}

export interface LoadedBundle {
  manifest: VswiftManifest;
  extractDir: string;
  binaryPath: string;
}

/**
 * Extract `zipPath` under `cacheRoot/<name>-<version>-<sha8>/` and resolve the
 * platform binary. Re-extracts only when the archive content hash changes.
 */
export function loadBundle(
  zipPath: string,
  cacheRoot: string,
  log: (msg: string) => void = () => {},
): LoadedBundle {
  const manifest = inspectBundle(zipPath);
  const hash = sha256File(zipPath).slice(0, 12);
  const extractDir = path.join(cacheRoot, `${manifest.name}-${manifest.version}-${hash}`);

  const marker = path.join(extractDir, ".extracted-ok");
  if (!fs.existsSync(marker)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    const written = extractZip(zipPath, extractDir, {
      onProgress: (e) => log(`extract ${e}`),
    });
    // Everything the manifest references must exist post-extraction.
    for (const p of Object.values(manifest.binaries)) {
      const rel = safeRelativePath(p);
      const bin = path.join(extractDir, rel);
      if (!fs.existsSync(bin)) {
        throw new VswiftError(`manifest references missing binary ${rel}`);
      }
      try {
        fs.chmodSync(bin, 0o755);
      } catch {
        /* chmod unsupported (e.g. Windows) */
      }
    }
    fs.writeFileSync(marker, hash);
    log(`extracted ${written.length} files -> ${extractDir}`);
  }

  const key = selectBinaryKey(manifest);
  if (!key) {
    throw new VswiftError(
      `no binary for ${process.platform}/${process.arch}; bundle provides: ${Object.keys(manifest.binaries).join(", ")}`,
    );
  }
  const binaryPath = path.join(extractDir, safeRelativePath(manifest.binaries[key]));
  if (!fs.existsSync(binaryPath)) {
    throw new VswiftError(`selected binary missing: ${binaryPath}`);
  }
  return { manifest, extractDir, binaryPath };
}
