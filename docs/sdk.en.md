# Klyrics lyric engine SDK

From **2.0.0.9**, Klyrics can act as a **lyric data engine** inside foobar2000: other native components and JS panels can read lyrics that Klyrics has already parsed, aligned, and translated.

Two surfaces:

1. **C++ SDK** (Windows / macOS): `sdk/klyrics_api.h`
2. **COM / ActiveX** (Windows only): ProgID `Klyrics.Engine`, for JScript Panel 3, Spider Monkey Panel, and similar hosts

中文：[sdk.md](sdk.md). Header: [sdk/klyrics_api.h](../sdk/klyrics_api.h).

---

## Rules

- Times are seconds (`double`).
- Strings are UTF-8. COM converts them to JS `String`.
- Do **not** `delete` / `free` a `klyrics_result*` or its `const char*`. Pointers become invalid on the next lyric update — copy what you need inside the callback.
- Keep the two push events separate: `on_lyrics_loaded` means lyrics are ready; `on_lyrics_updated` means the current line changed.

Official GUIDs:

| Interface | GUID |
| --- | --- |
| `klyrics_api` | `{3E8A6C41-9B17-4F2D-A8E5-1C70D4B9E263}` |
| `klyrics_callback` | `{7B14D9E2-5C38-4A61-9F20-8E4D6A1C0B75}` |
| COM `Klyrics.Engine` | `{A91C4E70-2D58-4B13-8E6A-5F30C7D1B849}` |

---

## C++ SDK

Include the foobar2000 SDK first, then:

```cpp
#include <foobar2000.h>
#include "klyrics_api.h"
```

`klyrics_line_t`: `start_time`, `duration`, `text`, `translation`.

`klyrics_result`:

- `get_line_count()`
- `get_line(index, out_line)`
- `get_raw_lrc()`
- `get_line_index(time_sec)`: last line with `start_time <= time_sec`. Empty lyrics return `0`; before the first line returns `get_line_count()` (not a valid index)
- `get_source_path()`: UTF-8 path of the lyric file. Empty for embedded / tag lyrics, or when nothing was saved to disk

`query_lyrics(p_track, out_result)`: empty `p_track` queries the current track; a non-empty handle succeeds only if it is the now-playing track. If Klyrics is not loaded, `static_api_ptr_t<klyrics_api>` fails — catch that or enumerate services.

### PUSH: two separate events

Implement `klyrics_callback` and register it with `service_factory_single_t`.

1. `on_lyrics_loaded(track, line_count, file_path)`: lyrics loaded. `file_path` is `""` for embedded lyrics or when nothing was saved to disk.
2. `on_lyrics_updated(track, result, line_index)`: current line on a line change. The same line is not pushed again. An invalid `line_index` equals `get_line_count()`.

Use PULL for the full lyric body. Do not treat the load event as “here is the entire document”.

```cpp
class my_lyrics_sink : public klyrics_callback {
public:
    void on_lyrics_loaded(
        metadb_handle_ptr p_track,
        size_t line_count,
        const char* file_path
    ) override {
        console::formatter() << "klyrics loaded: " << line_count
                             << " lines, file=" << (file_path ? file_path : "");
    }

    void on_lyrics_updated(
        metadb_handle_ptr p_track,
        const klyrics_result* p_result,
        size_t line_index
    ) override {
        if (p_result == nullptr || line_index >= p_result->get_line_count()) {
            return;
        }
        klyrics_line_t line{};
        if (p_result->get_line(line_index, line)) {
            console::formatter() << "klyrics: " << line.text;
        }
    }
};

static service_factory_single_t<my_lyrics_sink> g_my_lyrics_sink;
```

### PULL: query on demand

```cpp
static_api_ptr_t<klyrics_api> api;
klyrics_result* result = nullptr;
if (api->query_lyrics(metadb_handle_ptr(), result) && result != nullptr) {
    const char* lrc = result->get_raw_lrc();
    (void)lrc;
}
```

---

## COM (Windows only)

Before the UI starts, Klyrics writes `HKEY_CURRENT_USER\Software\Classes` so JScript Panel can create `ActiveXObject("Klyrics.Engine")` with no admin elevation. Registration is removed on quit. If another running foobar2000 already owns the ProgID, that registration is left alone.

| | |
| --- | --- |
| ProgID | `Klyrics.Engine` |
| CLSID | `{A91C4E70-2D58-4B13-8E6A-5F30C7D1B849}` |

Methods: `GetLineCount()`, `GetLineTime(index)`, `GetLineText(index)`, `GetLineTranslation(index)`, `GetLineIndex(time)`, `GetLyricPath()`.

- `GetLineIndex(time)`: playback position in seconds → 0-based line index. `-1` if there are no lyrics or the position is before the first line.
- `GetLyricPath()`: lyric file path. `""` for embedded lyrics or when nothing was saved to disk.

Two pushes:

- `SetOnLyricsLoaded(fn)` / `OnLyricsLoaded = fn` → `fn(count, path)`
- `SetOnLyricsUpdated(fn)` / `OnLyricsUpdated = fn` → `fn(index, time, text, trans)`. `index === -1` when there is no current line.

Keep the engine on a global variable, or the garbage collector will drop the callback. JScript Panel 3 has no `on_init`; create the engine and bind callbacks at the top of the script.

### Pull demo

```
function on_mouse_lbtn_up(x, y) {
    try {
        var klyrics = new ActiveXObject("Klyrics.Engine");
        var count = klyrics.GetLineCount();
        console.log("Klyrics line count: " + count);
        if (count > 0) {
            var time = klyrics.GetLineTime(0);
            var text = klyrics.GetLineText(0);
            var trans = klyrics.GetLineTranslation(0);
            console.log("First line: [" + time + "] " + text + " (" + trans + ")");
        }
    } catch (e) {
        console.log("COM failed; Klyrics may not be loaded: " + e.message);
    }
}
```

### Push demo

```
function RGB(r, g, b) {
    return 0xff000000 | (r << 16) | (g << 8) | b;
}

var g_klyrics = null;
var g_index = -1;
var g_time = 0;
var g_text = "";
var g_trans = "";
var g_count = 0;
var g_path = "";

function on_klyrics_loaded(count, path) {
    g_count = count;
    g_path = path || "";
    console.log("on_klyrics_loaded count=" + count + " path=" + g_path);
    window.Repaint();
}

function on_klyrics_updated(index, time, text, trans) {
    g_index = index;
    g_time = time;
    g_text = text || "";
    g_trans = trans || "";
    console.log("on_klyrics_updated index=" + index + " time=" + time + " text=" + g_text + " trans=" + g_trans);
    window.Repaint();
}

function bind_klyrics() {
    if (g_klyrics) {
        return true;
    }
    try {
        g_klyrics = new ActiveXObject("Klyrics.Engine");
        g_klyrics.SetOnLyricsLoaded(on_klyrics_loaded);
        g_klyrics.SetOnLyricsUpdated(on_klyrics_updated);
        console.log("Klyrics ready");
        return true;
    } catch (e) {
        console.log("Klyrics COM: " + e.message);
        return false;
    }
}

if (!bind_klyrics()) {
    var g_tries = 0;
    var g_timer = window.SetInterval(function () {
        g_tries++;
        if (bind_klyrics() || g_tries >= 50) {
            window.ClearInterval(g_timer);
        }
    }, 100);
}

var g_font = JSON.stringify({Name: "Segoe UI", Size: 16});
var g_font_hi = JSON.stringify({Name: "Segoe UI", Size: 22, Weight: 700});

function on_paint(gr) {
    var w = window.Width;
    var h = window.Height;
    gr.Clear(RGB(20, 20, 26));
    if (g_index < 0 || !g_text) {
        gr.WriteText("Waiting for line push…", g_font, RGB(160, 160, 160), 10, 10, w - 20, 24);
        return;
    }
    gr.WriteText(g_text, g_font_hi, RGB(255, 220, 80), 10, 12, w - 20, 28);
    if (g_trans) {
        gr.WriteText(g_trans, g_font, RGB(180, 180, 190), 10, 44, w - 20, 24);
    }
}
```
