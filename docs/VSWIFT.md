# `.vswift` bundle format (v1)

A `.vswift` file is a **ZIP archive** containing a compiled userscript — the
distribution format for sharing scripts without requiring the consumer to have
a Swift toolchain.

## Layout

```
hello.vswift  (zip)
├── userscript.json                          ← manifest, REQUIRED at root
├── bin/<platform-key>/<executable>          ← one or more binaries, REQUIRED
│   ├── bin/x86_64-unknown-linux-gnu/HelloUserscript
│   └── bin/aarch64-apple-darwin/HelloUserscript
└── assets/**                                ← optional payload files
```

### `userscript.json` manifest (formatVersion 1)

```json
{
  "formatVersion": 1,
  "name": "hello-userscript",
  "version": "1.0.0",
  "binaries": {
    "x86_64-unknown-linux-gnu": "bin/x86_64-unknown-linux-gnu/HelloUserscript",
    "aarch64-apple-darwin": "bin/aarch64-apple-darwin/HelloUserscript",
    "universal": "bin/universal/HelloUserscript"
  },
  "assets": "assets"
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `formatVersion` | int | must equal `1`; anything else is rejected |
| `name` | string | `[\w.-]+`, used for install dir names |
| `version` | string | free-form, non-empty |
| `binaries` | object | map of platform key → archive-relative path; every referenced path must exist in the archive; paths are validated against traversal |
| `assets` | string? | optional archive-relative directory copied verbatim to the extraction dir |

## Platform keys

The host tries keys most-specific → least:

| Host | Order tried |
| --- | --- |
| Linux x64 | `x86_64-unknown-linux-gnu`, `x86_64-linux`, `linux-x64`, `universal` |
| macOS arm64 | `aarch64-apple-darwin`, `aarch64-macos`, `macos-arm64`, `universal` |
| Windows x64 | `x86_64-pc-windows-msvc`, `x86_64-windows`, `windows-x64`, `universal` |

`universal` is the fallback for scripts that are truly portable (e.g. a
shell-wrapper). A bundle with no matching key fails to load with a clear error
listing the keys it does provide.

## Packing

`vswift` is the packager CLI, built from `swift-userscript` (`swift build
--product vswift`):

```sh
# build + pack for the host platform
vswift pack examples/hello --product HelloUserscript -o hello.vswift

# embed extra prebuilt binaries for other platforms (cross-compile them
# yourself first, e.g. `swift build --triple <triple>` or a swift-sdk)
vswift pack examples/hello --product HelloUserscript \
    --binary aarch64-apple-darwin=/path/to/darwin/HelloUserscript \
    -o hello.vswift

# inspect an existing bundle
vswift info hello.vswift
```

Archives written by `vswift` store entries uncompressed (method 0); the host
extractor also accepts deflate (method 8) so `zip`-produced bundles work too.

## Loading & security

**Discovery:** the host scans `swiftUserscripts.bundleGlob` (default
`**/*.vswift`) in the workspace, plus bundles persisted under the extension's
`globalStorage/vswift-installed/` directory from previous installs.

**Install command:** *"Swift Userscripts: Install .vswift Bundle"* opens a file
picker, validates + extracts to `globalStorage/vswift-installed/`, and reloads.

**Extraction** goes to `globalStorage/vswift-cache/<name>-<version>-<sha256-12>/`
(content-keyed: a changed archive re-extracts, an unchanged one reuses). All
defenses are enforced in `extension/src/zip.ts`:

- absolute paths, `C:\`-style drive paths, `..` segments, and backslash
  traversal are rejected per entry
- symlink entries are rejected
- encrypted entries rejected; only store/deflate methods accepted
- decompressed size verified against the central directory
- caps: ≤1024 entries, ≤512 MB expanded
- manifest-referenced binaries verified present post-extraction, `chmod 0755`

**Important:** a `.vswift` binary still runs as a full-privilege native
process — the format adds *integrity and path safety*, not a sandbox. Only
install bundles from sources you trust.

## Lifecycle inside the host

1. `.vswift` found → `inspectBundle()` validates manifest (no extraction yet)
2. `loadBundle()` extracts to cache dir, selects platform binary
3. host spawns the binary and runs the standard `initialize` handshake —
   a bundle speaks exactly the same protocol as a source-built script
