# Klyrics Community Script Guide

Welcome to the Klyrics ecosystem! You can easily expand the search capabilities by adding your own custom `.js` source scripts.

(Note: Built-in sources like `lrclib`, `kugou`, `qq`, and `netease` are natively implemented in C++ for maximum performance and cannot be overridden.)

Klyrics uses an embedded QuickJS engine. Scripts are designed to be lightweight: their only job is to build URLs, parse JSON, and run regular expressions. **To guarantee optimal performance and security, all network requests, hashing, and AES / DES / 3DES must be routed through the native `Klyrics.*` API.** Please refrain from bundling external libraries like `md5.js` or `crypto.js`. Use `Klyrics.decrypt(data, "krc"|"qrc")` for site-specific bodies; do not reimplement Kugou XOR or Tencent QRC in the script.

## 1. Deployment & Folder Structure

Both 32-bit and 64-bit versions of foobar2000 share the same data folder (located next to `user-components`):

- **Windows**: `%APPDATA%\foobar2000-v2\klyrics-data\scripts\`

- **macOS**: `~/Library/foobar2000-v2/klyrics-data/scripts/`

**Basic Rules:**

- **One file per source**: The filename is up to you, but each `.js` file should represent a single source.

- **Required structure**: The engine only loads files containing a valid `klyrics_source` object, alongside `search` and `fetch` functions.

- **Security boundaries**: `require` and `import` are disabled. Executing remotely downloaded JS is not permitted.

- **Applying changes**: After editing your script, please **restart foobar2000** (or reopen Preferences → Search to trigger a rescan). Don't forget to move your new source to the "In Use" list.

## 2. Minimal Skeleton

A valid lyrics script only needs three components: top-level metadata, a `search` function, and a `fetch` function.

JavaScript

```
var klyrics_source = {
  id: "js:mysite",       // Prefix with "js:". Keep this stable to preserve user preferences.
  name: "My lyrics site", // Displayed in Preferences and search status
  kind: "lyric",         // Currently only "lyric" is supported
  version: 1
};

function search(query) {
  return []; // Return candidates here
}

function fetch(fetch_url, query) {
  return { synced: "", plain: "", tlyric: "" }; // Return final lyrics here
}
```

Pro Tip: The host scans the metadata using a lightweight text parser. Please write the `id`, `name`, `kind`, and `version` as hardcoded literal values, not computed variables.

## 3. The `query` Object

The host passes a `query` object that aligns with the internal `TrackQuery`:

| **Field**  | **Type** | **Description**                                   |
| ---------- | -------- | ------------------------------------------------- |
| `title`    | string   | Track title                                       |
| `artist`   | string   | Artist name                                       |
| `album`    | string   | Album name                                        |
| `duration` | number   | Track duration in seconds (may be `0` if unknown) |
| `path`     | string   | Current local file path (may be empty)            |

## 4. Work Split: `search` vs `fetch`

### `search(query)` → Array

Return an array of candidates. The host will automatically inject your script `id` into the internal `source` field.

| **Field**                    | **Description**                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `title` / `artist` / `album` | Used for UI display, scoring, and saving.                                              |
| `duration`                   | Seconds (use `0` if unknown).                                                          |
| `fetch_url`                  | Your custom key passed to `fetch` later (e.g., a song ID, a hash, or `artist\ttitle`). |
| `image_url`                  | (Optional) URL for the album cover. Actual download is handled by the C++ core.        |
| `synced`                     | Timed LRC or word-level lyrics (can be empty).                                         |
| `plain`                      | Untimed lyrics (can be empty).                                                         |

**Best Practices:**

- Return a concise list (the host truncates at **32** items).

- Returning an empty array simply means "no hits found," not a script failure.

- If a site frequently returns 404s for lyrics despite finding the track, consider doing a lightweight fetch during the `search` phase to filter out dead ends.

### `fetch(fetch_url, query)` → Object

JavaScript

```
return {
  synced: "...",   // Highly recommended if timed lyrics are available
  plain: "...",    // Untimed text fallback
  tlyric: "..."    // (Optional) Translations will be elegantly appended by the host
};
```

Note: Returning empty strings for both `synced` and `plain` triggers a "Search Failed" dialog. Uncaught errors (e.g., `throw new Error(...)`) are gracefully caught and displayed to the user.

## 5. Native Klyrics API Reference

Please use the global `Klyrics` namespace for heavy lifting. File I/O, `eval`, and external config access are intentionally sandboxed.

### 5.1 Networking: `Klyrics.http(opt)`

This method is **synchronous** within the background worker thread (it will never freeze foobar2000's UI or audio playback). It utilizes foobar's native HTTP client with built-in cancel tokens and a ~26s timeout.

JavaScript

```
var res = Klyrics.http({
  method: "GET",                    // Defaults to GET
  url: "https://example.com/api",
  headers: {                        // A standard Chrome UA is sent if omitted
    "Referer": "https://example.com/"
  },
  body: ""                          // Ignored for GET requests
});
// res.status: e.g., 200, 404
// res.text:   response string
```

Tip: Non-2xx HTTP statuses do not throw exceptions—you should handle `res.status` manually. Connection drops or user cancellations will throw an `aborted` error[cite: 1].

### 5.2 Cryptography & Encoding

All hashing and AES / DES / 3DES functions rely on native C++ implementations for zero-overhead execution[cite: 1]. **String inputs are treated as UTF-8 bytes**[cite: 1].

- **Hashing (returns lowercase hex)**: `Klyrics.md5(s)`, `Klyrics.sha1(s)`, `Klyrics.sha256(s)`[cite: 1]. (HMAC variants: `Klyrics.hmacMd5(key, s)`, etc.)[cite: 1].

- **Encoding**: `urlEncode`, `base64Encode`/`base64Decode`, `hexEncode`/`hexDecode`[cite: 1].

**AES / DES / 3DES:**

JavaScript

```
var plain = Klyrics.aesDecrypt(json.lyric, "0123456789abcdef0123456789abcdef", {
  mode: "ecb", // or "cbc"
  encoding: "hex", // "hex", "base64", "utf8", or "raw"
  iv: "" // 16-byte IV required for CBC
});

// DES key: 8 bytes. 3DES key: 16 or 24 bytes. QRC-style bodies often use 3DES-ECB without PKCS7.
var raw = Klyrics.des3Decrypt(json.lyric, key24, {
  mode: "ecb",
  encoding: "base64",
  padding: "none" // default "pkcs7"
});
```

**Zlib inflate (common for word-level lyrics):**

Many sites ship karaoke / KRC / QRC bodies as a **zlib stream** (sometimes gzip or raw deflate)—not a `.zip` archive. After decrypt or Base64 decode, inflate with the host. Do not bundle `pako.js`.

JavaScript

```
// Already raw compressed bytes (e.g. just base64Decoded or XOR'd)
var text = Klyrics.inflate(bytes);

// Compressed blob stored as Base64 or hex in JSON
var text = Klyrics.inflate(json.content, { encoding: "base64" });
var text = Klyrics.inflate(json.hex, { encoding: "hex", format: "zlib" });
```

**Site decrypt:** `Klyrics.decrypt(data, type, opt)`. `encoding` matches `inflate`.

- `"krc"`: skip 4-byte header, XOR, zlib. Kugou's Base64 body uses `{ encoding: "base64" }`.
- `"qrc"`: Tencent's non-standard 3DES (fixed key) + zlib. QQ's hex body uses `{ encoding: "hex" }`. Do not reimplement that cipher in the script.

Convert KRC / QRC word tags to Enhanced LRC and return them in `synced`. Examples: `scripts/netease-yrc.js`, `scripts/kugou-krc.js`, `scripts/qq-qrc.js` (they do not replace the built-in line-LRC sources).

- `encoding`: how to decode the input. Default `raw` (already a byte string). Also `hex` / `base64` / `utf8`.
- `format`: default `auto` (zlib `78 …` or gzip `1f 8b`, otherwise raw deflate). Or set `"zlib"` / `"gzip"` / `"raw"`.
- The return value is always the decompressed raw string (lyrics text, or plaintext for a later AES step).
- To compress: `Klyrics.deflate(text)` writes a zlib wrapper by default; `{ format: "raw" }` is raw deflate. `encoding` applies to the **output**.

## 6. Anti-Patterns (What to Avoid)

To maintain a healthy and secure ecosystem, please avoid the following[cite: 1]:

- 🚫 **Reinventing the wheel**: Do not try to rewrite built-in sources (QQ/NetEase/etc.) via JS[cite: 1]. The C++ native versions will always be faster and more stable[cite: 1].

- 🚫 **Bundling crypto / zip libs**: Do not drop `md5.js` or `pako.js` next to the script. Use `Klyrics.*` for hashes, AES, and zlib.

- 🚫 **UI manipulation**: Do not attempt to render lyrics or download image bytes inside the JS[cite: 1]. Return the `image_url` and let the C++ Direct2D engine handle the beautiful rendering[cite: 1].

(Refer to `klyrics-data\scripts\lyricsovh.js` in the repository for a complete, production-ready example[cite: 1].)
