#!/usr/bin/env node
// .vswift bundle tests: manifest validation, platform selection, extraction
// defenses, and an end-to-end pack→inspect→load using the real `vswift` tool.
//
// Usage: node test/vswift.test.mjs [vswift-binary]
//   default: ../swift-userscript/.build/debug/vswift

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const vswiftBin =
  process.argv[2] ?? path.join(root, "swift-userscript/.build/debug/vswift");
const outDir = (m) => path.join(root, "extension/out", m);
const vswiftMod = await import(outDir("vswift.js"));
const { parseManifest, selectBinaryKey, loadBundle, inspectBundle } =
  vswiftMod.default ?? vswiftMod;
const zipMod = await import(outDir("zip.js"));
const { extractZip } = zipMod.default ?? zipMod;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vswift-test-"));
let failures = 0;
function check(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failures++;
  } else {
    console.log(`ok: ${label}`);
  }
}
function rejects(fn, label) {
  try {
    fn();
  } catch {
    console.log(`ok: ${label}`);
    return;
  }
  console.error(`FAIL: ${label} (did not throw)`);
  failures++;
}

// ---------- manifest validation ----------
const good = parseManifest(JSON.stringify({
  formatVersion: 1,
  name: "x",
  version: "1.0.0",
  binaries: { universal: "bin/universal/x" },
}));
check(good.name === "x", "valid manifest parses");

rejects(() => parseManifest("{"), "malformed JSON rejected");
rejects(
  () => parseManifest(JSON.stringify({ formatVersion: 99, name: "x", version: "1", binaries: {} })),
  "wrong formatVersion rejected",
);
rejects(
  () => parseManifest(JSON.stringify({ formatVersion: 1, name: "../x", version: "1", binaries: {} })),
  "bad name rejected",
);
rejects(
  () =>
    parseManifest(JSON.stringify({
      formatVersion: 1, name: "x", version: "1",
      binaries: { universal: "../escape" },
    })),
  "traversal in binaries path rejected",
);

// ---------- platform selection ----------
const m = {
  binaries: {
    "x86_64-unknown-linux-gnu": "bin/x86_64-unknown-linux-gnu/x",
    "aarch64-apple-darwin": "bin/aarch64-apple-darwin/x",
    universal: "bin/universal/x",
  },
};
check(
  selectBinaryKey(m, "linux", "x64") === "x86_64-unknown-linux-gnu",
  "linux/x64 picks exact triple",
);
check(
  selectBinaryKey(m, "darwin", "arm64") === "aarch64-apple-darwin",
  "darwin/arm64 picks exact triple",
);
check(
  selectBinaryKey(m, "win32", "x64") === "universal",
  "win32/x64 falls back to universal",
);
check(
  selectBinaryKey({ binaries: { "aarch64-apple-darwin": "b" } }, "linux", "x64") === null,
  "missing platform → null",
);

// ---------- malicious archive rejection ----------
// Hand-craft minimal zips (store method) with evil entries.
function makeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const data = e.data;
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, name, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(3 << 8 | 20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(((e.unixMode ?? 0o644) << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, name]));
    offset += 30 + name.length + data.length;
  }
  const cdStart = offset;
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const manifestJson = JSON.stringify({
  formatVersion: 1, name: "x", version: "1",
  binaries: { universal: "bin/u/x" },
});

// zip-slip: ../ traversal
{
  const f = path.join(tmp, "evil1.vswift");
  fs.writeFileSync(f, makeZip([
    { name: "userscript.json", data: Buffer.from(manifestJson) },
    { name: "../../pwned", data: Buffer.from("x"), unixMode: 0o755 },
  ]));
  rejects(() => loadBundle(f, path.join(tmp, "c1")), "zip-slip ../ rejected");
  check(!fs.existsSync(path.join(tmp, "pwned")), "nothing escaped dest dir");
}
// absolute path entry
{
  const f = path.join(tmp, "evil2.vswift");
  fs.writeFileSync(f, makeZip([
    { name: "userscript.json", data: Buffer.from(manifestJson) },
    { name: "/abs/path", data: Buffer.from("x") },
  ]));
  rejects(() => loadBundle(f, path.join(tmp, "c2")), "absolute-path entry rejected");
}
// symlink entry
{
  const f = path.join(tmp, "evil3.vswift");
  fs.writeFileSync(f, makeZip([
    { name: "userscript.json", data: Buffer.from(manifestJson) },
    { name: "link", data: Buffer.from("x"), unixMode: 0o120777 },
  ]));
  rejects(() => loadBundle(f, path.join(tmp, "c3")), "symlink entry rejected");
}
// manifest referencing missing binary
{
  const f = path.join(tmp, "evil4.vswift");
  fs.writeFileSync(f, makeZip([
    { name: "userscript.json", data: Buffer.from(manifestJson) },
  ]));
  rejects(() => loadBundle(f, path.join(tmp, "c4")), "manifest pointing at missing binary rejected");
}
// deflate-compressed entry still extracts (host reader handles method 8)
{
  const deflated = zlib.deflateRawSync(Buffer.from(manifestJson));
  const f = path.join(tmp, "deflated.vswift");
  const name = Buffer.from("userscript.json");
  const data = deflated;
  const crc = crc32(Buffer.from(manifestJson));
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8); // method 8
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(manifestJson.length, 22);
  lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(3 << 8 | 20, 4);
  cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(manifestJson.length, 24); cd.writeUInt16LE(name.length, 28);
  cd.writeUInt32LE(0o644 << 16, 38); cd.writeUInt32LE(0, 42);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  const cdBuf = Buffer.concat([cd, name]);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(30 + name.length + data.length, 16);
  fs.writeFileSync(f, Buffer.concat([lh, name, data, cdBuf, eocd]));
  const parsed = inspectBundle(f);
  check(parsed.name === "x", "deflate-compressed manifest entry readable");
}

// ---------- end-to-end: vswift pack → host inspect → loadBundle ----------
if (fs.existsSync(vswiftBin)) {
  const bundle = path.join(tmp, "hello.vswift");
  execFileSync(vswiftBin, [
    "pack", path.join(root, "examples/hello"),
    "--product", "HelloUserscript",
    "-o", bundle,
  ], { stdio: "inherit" });
  check(fs.existsSync(bundle), "vswift pack produces .vswift");

  const info = execFileSync(vswiftBin, ["info", bundle], { encoding: "utf8" });
  check(info.includes("userscript.json"), "vswift info lists manifest");
  check(/bin\//.test(info), "vswift info lists binary entry");

  const manifest = inspectBundle(bundle);
  check(manifest.name === "hello", `bundle manifest name (${manifest.name})`);
  check(Object.keys(manifest.binaries).length >= 1, "bundle declares >=1 platform binary");

  const loaded = loadBundle(bundle, path.join(tmp, "cache"));
  check(fs.existsSync(loaded.binaryPath), `loadBundle resolves binary (${loaded.binaryPath})`);
  check(
    (fs.statSync(loaded.binaryPath).mode & 0o111) !== 0,
    "extracted binary is executable",
  );

  // loaded bundle actually speaks the protocol
  const { spawnSync } = await import("node:child_process");
  const probe = spawnSync(loaded.binaryPath, ["--stdio"], {
    input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n",
    encoding: "utf8",
    timeout: 10000,
  });
  check(
    probe.stdout.includes('"hello-userscript"'),
    "extracted binary responds to initialize",
  );
} else {
  console.log(`skip: vswift binary not found at ${vswiftBin} (tool e2e skipped)`);
}

fs.rmSync(tmp, { recursive: true, force: true });
if (failures) {
  console.error(`vswift tests: ${failures} failure(s)`);
  process.exit(1);
}
console.log("vswift: all checks passed");
