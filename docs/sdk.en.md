# Klyrics lyric engine SDK

From **2.0.0.9**, Klyrics can act as a **lyric data engine** inside foobar2000: other native components and JS panels can read lyrics that Klyrics has already parsed, aligned, and translated. This release also adds **service commands**: silent search, windows, lyric layers, save, preference pages, and show/lock for desktop, float, and taskbar lyrics.

The three surfaces share one implementation. Writes and UI work are marshaled to the main thread.

1. **C++ SDK** (Windows / macOS): `sdk/klyrics_api.h`
2. **COM / ActiveX** (Windows only): ProgID `Klyrics.Engine`, for JScript Panel 3, Spider Monkey Panel, and similar hosts
3. **Local WebSocket** (Windows / macOS): binds `127.0.0.1` only, default port **9999**

中文：[sdk.md](sdk.md). Header: [sdk/klyrics_api.h](../sdk/klyrics_api.h).

---

## Rules

- Times are seconds (`double`).
- Strings are UTF-8. COM converts them to JS `String`.
- Do **not** `delete` / `free` a `klyrics_result*` or its `const char*`. Pointers become invalid on the next lyric update — copy what you need inside the callback.
- Keep the three push events separate: `on_lyrics_loaded` means lyrics are ready; `on_lyrics_updated` means the current line changed; `on_config_changed` means panel style / lyric layers changed.
- `search_lyrics` only means a silent AutoBest search **has been started**. A later load push reports the result. There is no API that returns an unused LRC for an arbitrary track that is not now playing.
- Visibility getters report whether the **window is actually up**, not just the saved setting.
- macOS has no taskbar lyrics: `set_taskbar_*` is a no-op and `taskbar_visible` is always `false`.

Line-index rules (C++ differs from COM / the line-change push):

| Case | C++ `get_line_index` / `on_lyrics_updated` | COM `GetLineIndex` / `OnLyricsUpdated` | WS `get_line_index` | WS `lyrics_updated` |
| --- | --- | --- | --- | --- |
| Valid current line | `0 … count-1` | `0 … count-1` | `0 … count-1` | `0 … count-1` |
| Empty / before first line | `get_line_count()` (not a valid index) | `-1` | Same as C++ (returns the count) | `-1` |

Official GUIDs:

| Interface | GUID |
| --- | --- |
| `klyrics_api` | `{3E8A6C41-9B17-4F2D-A8E5-1C70D4B9E263}` |
| `klyrics_callback` | `{7B14D9E2-5C38-4A61-9F20-8E4D6A1C0B75}` |
| COM `Klyrics.Engine` | `{A91C4E70-2D58-4B13-8E6A-5F30C7D1B849}` |

---

## Surface map

C++ and WebSocket use snake_case. COM uses PascalCase. Semantics match.

| Capability | C++ / WebSocket | COM |
| --- | --- | --- |
| Always search | `set_always_search` / `always_search` | `SetAlwaysSearch` / `AlwaysSearch` |
| Silent search | `search_lyrics` | `SearchLyrics` |
| Search picker | `show_search_window` | `ShowSearchWindow` |
| Lyric editor | `show_edit_window` | `ShowEditWindow` |
| Lyric layers | `set_lyric_layers` / `lyric_layers` | `SetLyricLayers` / `GetLyricLayers` (alias `LyricLayers`) |
| Save by current rules | `save_lyrics` | `SaveLyrics` |
| Open a preferences page | `show_preferences` | `ShowPreferences` |
| Desktop lyrics | `set_desktop_visible` / `set_desktop_locked` / `desktop_visible` | `SetDesktopVisible` / `SetDesktopLocked` / `DesktopVisible` |
| Float lyrics | `set_float_visible` / `set_float_locked` / `float_visible` | `SetFloatVisible` / `SetFloatLocked` / `FloatVisible` |
| Taskbar lyrics | `set_taskbar_visible` / `set_taskbar_locked` / `taskbar_visible` | `SetTaskbarVisible` / `SetTaskbarLocked` / `TaskbarVisible` |
| Panel template style | `get_panel_style_json` / WS `get_panel_style` | `GetPanelStyle` |
| Seek / playback clock | `seek` / `playback_position` / `playback_length` | `Seek` / `GetPlaybackPosition` / `GetPlaybackLength` |

Read-only lyrics (existing PULL):

| Capability | C++ `klyrics_result` | COM | WebSocket |
| --- | --- | --- | --- |
| Line count | `get_line_count()` | `GetLineCount()` | `get_line_count` |
| One line | `get_line(index, out)` | `GetLineTime` / `GetLineText` / `GetLineTranslation` | `get_line` |
| Raw LRC | `get_raw_lrc()` | `GetRawLrc()` | `get_raw_lrc` |
| Position → index | `get_line_index(time)` | `GetLineIndex(time)` | `get_line_index` |
| Lyric file path | `get_source_path()` | `GetLyricPath()` | `get_source_path` |

---

## Shared constants

### Lyric layers (bitmask)

`set_lyric_layers` / `lyric_layers` are a bitwise OR. Bits above the low 4 are dropped. A result of `0` falls back to original (`2`).

| Bit | Value | Meaning |
| --- | --- | --- |
| Ruby | `1` | Furigana |
| Original | `2` | Original text |
| Translation | `4` | Translation |
| Romaji | `8` | Romaji |

Example: original + translation = `6`. All four layers = `15` (factory default).

### Preference page short names

`show_preferences(page_id)` accepts a short name or a `{GUID}` (braces and hyphens optional). An empty string or `about` opens the root About page. An unknown name that is also not a valid GUID fails.

| Short name | Page |
| --- | --- |
| `about` | About (root) |
| `language` | Language |
| `translate` | Translate |
| `theme` | Theme |
| `artwork` | Artwork |
| `privacy` | Updates (includes the WebSocket toggle) |
| `panel` | Panel template |
| `panel.fx` | Panel template → Effects |
| `desktop` | Desktop |
| `desktop.fx` | Desktop → Effects |
| `float` | Float |
| `float.fx` | Float → Effects |
| `taskbar` | Taskbar (Windows only) |
| `taskbar.fx` | Taskbar → Effects |
| `search` | Search |
| `search.save` | Search → Save lyrics |
| `search.paths` | Search → Extra folders |
| `search.sources` | Search → Sources |
| `search.filter` | Search → Filter |

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

Service commands are appended on the same `klyrics_api`. Older callers that only use `query_lyrics` are unaffected. There is no second service GUID.

### Service commands

```cpp
static_api_ptr_t<klyrics_api> api;

api->set_always_search(true);
const bool always = api->always_search();

// Empty fields fall back to the now-playing tags. true only means the search started.
const bool started = api->search_lyrics("Title", "Artist", "Album");
api->show_search_window();
api->show_edit_window();

api->set_lyric_layers(2u | 4u); // original + translation
const std::uint32_t layers = api->lyric_layers();

const bool saved = api->save_lyrics();
const bool opened = api->show_preferences("desktop.fx");

api->set_desktop_visible(true);
api->set_desktop_locked(true);
const bool desk = api->desktop_visible();

api->seek(12.5);
const double pos = api->playback_position();
const double len = api->playback_length();
```

| Method | Args / return | Notes |
| --- | --- | --- |
| `set_always_search(bool)` / `always_search()` | `bool` | Search and download even when no lyric UI is shown. Maps to Preferences “Always search lyrics” (`search_without_ui`). Use this when you consume Klyrics as an engine and do not draw lyrics yourself. |
| `search_lyrics(title, artist, album)` | UTF-8, may be `nullptr` / `""`; `bool` | Silent AutoBest, applied to the **current track**. Empty fields are filled from now-playing tags. Returns `false` (and does not start a search) if all three are still empty after that. |
| `show_search_window()` | none | Opens the existing lyric-picker dialog for the current track (Interactive). |
| `show_edit_window()` | none | Opens the lyric editor. |
| `set_lyric_layers(mask)` / `lyric_layers()` | `uint32_t` | See the bitmask above. |
| `save_lyrics()` | `bool` | Saves using the current Search save rule (do not save / tags / song folder / custom folder). `false` on failure. |
| `show_preferences(page_id)` | short name or `{GUID}`; `bool` | Opens that preferences page. Unknown page → `false`. |
| `set_desktop_visible(on)` / `set_desktop_locked(on)` / `desktop_visible()` | `bool` | Show writes the setting and actually opens/closes the window. `desktop_visible()` is the live window state. Float and taskbar work the same way. |
| `get_panel_style_json()` | `const char*` | Panel-template style as UTF-8 JSON. Field names match theme export: `font_family`, `font_weight`, `font_size`, `italic`, `text`, `highlight`, `passed`, `bg`, `bg_mode` (`theme`/`color`/`transparent`/`image`), `stroke`, `scroll_mode` (`line`/`smooth`), `fade`, `fade_lines`, `karaoke`, `current_scale`, `line_spacing`, `wrap`, `lyric_fx`. The pointer becomes invalid on the next call to this method. |
| `seek(time_sec)` | `double`; `bool` | Seek to that second. Returns `false` if the current track cannot seek. |
| `playback_position()` | `double` | Current playback position in seconds. `0` when nothing is playing. |
| `playback_length()` | `double` | Current track length in seconds. `0` if unknown. |

### PUSH: two separate events

Implement `klyrics_callback` and register it with `service_factory_single_t`.

1. `on_lyrics_loaded(track, line_count, file_path)`: lyrics loaded. `file_path` is `""` for embedded lyrics or when nothing was saved to disk.
2. `on_lyrics_updated(track, result, line_index)`: current line on a line change. The same line is not pushed again. An invalid `line_index` equals `get_line_count()`.
3. `on_config_changed(style_json)`: panel template or lyric layers changed. `style_json` matches `get_panel_style_json()`. Default empty implementation; old components need not override.

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

Before the UI starts, Klyrics writes `HKEY_CURRENT_USER\Software\Classes` so JScript Panel can create `ActiveXObject("Klyrics.Engine")` with no admin elevation. Registration is removed on quit. If another running foobar2000 already owns the ProgID, that registration is left alone. The DLL embeds a type library (`GetTypeInfo` / `IProvideClassInfo2`) because JSplitter 3.8+ queries it while constructing `ActiveXObject`.

| | |
| --- | --- |
| ProgID | `Klyrics.Engine` |
| CLSID | `{A91C4E70-2D58-4B13-8E6A-5F30C7D1B849}` |

Keep the engine on a global variable, or the garbage collector will drop the callback. JScript Panel 3 has no `on_init`; create the engine and bind callbacks at the top of the script.

Paste [`github/sdk/klyrics_com.js`](../sdk/klyrics_com.js) into JScript Panel 3 or JSplitter. On startup it writes `ok` / `FAIL` for every COM member. Methods that would open a window or write a file (`SearchLyrics`, `ShowSearchWindow`, `ShowEditWindow`, `SaveLyrics`) are existence-checked only. JSP3 uses `gr.WriteText`; JSplitter / SMP use `gr.GdiDrawText`.

### JSplitter / Spider Monkey Panel

JSplitter 3.8+ reads the type library when constructing `ActiveXObject`. It exposes **INVOKE_FUNC** members as JS functions; properties use a separate get/set path. Names are case-sensitive and must match the PascalCase table below.

| Usage | JSplitter | Avoid |
| --- | --- | --- |
| Methods | `k.GetLineCount()`, `k.DesktopVisible()`, `k.LyricLayers()` | `k.GetLineCount` or `k.DesktopVisible` without `()` (you get the function; `if (k.DesktopVisible)` is always true) |
| `AlwaysSearch` | `k.AlwaysSearch` / `k.AlwaysSearch = true` | `k.AlwaysSearch()` |
| Callbacks | `k.OnLyricsUpdated = on_line` or `k.SetOnLyricsUpdated(on_line)` | `on_line.bind(this)` (the JSplitter wrapper often type-mismatches) |
| Clear callback | `k.OnLyricsUpdated = null` or `k.SetOnLyricsUpdated(null)` | — |
| Optional args | `k.SearchLyrics()` and `k.ShowPreferences()` are valid; missing args are empty strings | — |

`GetLyricLayers()` and `LyricLayers()` are both methods and return the current layer mask.

### Read-only methods

| Method | Returns | Notes |
| --- | --- | --- |
| `GetLineCount()` | `int` | Current line count; `0` when empty |
| `GetLineTime(index)` | `double` | Line start in seconds; `0` if out of range |
| `GetLineText(index)` | `string` | Original text; `""` if out of range |
| `GetLineTranslation(index)` | `string` | Translation; `""` if missing or out of range |
| `GetLineIndex(time)` | `int` | Playback position in seconds → 0-based index. `-1` if empty or before the first line |
| `GetLyricPath()` | `string` | Lyric file path. `""` for embedded lyrics or when nothing was saved to disk |
| `GetRawLrc()` | `string` | Full raw LRC |

### Service commands

`AlwaysSearch` can be read/written as a property, or you can call `SetAlwaysSearch(on)`.

| Method | JS signature | Returns | Notes |
| --- | --- | --- | --- |
| `SetAlwaysSearch` / `AlwaysSearch` | `SetAlwaysSearch(on)` / `AlwaysSearch = on` | current `bool` | Same as C++ “always search” |
| `SearchLyrics` | `SearchLyrics(title, artist, album)` | `bool` | Silent AutoBest. Missing args are empty strings and fall back to the current track |
| `ShowSearchWindow` | `ShowSearchWindow()` | `true` | Opens the picker |
| `ShowEditWindow` | `ShowEditWindow()` | `true` | Opens the editor |
| `SetLyricLayers` | `SetLyricLayers(mask)` | mask after write | Bitmask as above |
| `GetLyricLayers` / `LyricLayers` | `GetLyricLayers()` / `LyricLayers()` | `int` | Current layers |
| `SaveLyrics` | `SaveLyrics()` | `bool` | Save using the current rule |
| `ShowPreferences` | `ShowPreferences(pageId)` | `bool` | Short name or `{GUID}` |
| `SetDesktopVisible` | `SetDesktopVisible(on)` | whether the window is up | Desktop visibility |
| `SetDesktopLocked` | `SetDesktopLocked(on)` | `true` | Desktop lock |
| `DesktopVisible` | `DesktopVisible()` | `bool` | Desktop is up |
| `SetFloatVisible` / `SetFloatLocked` / `FloatVisible` | same | same | Float |
| `SetTaskbarVisible` / `SetTaskbarLocked` / `TaskbarVisible` | same | same | Taskbar |
| `GetPanelStyle` | `GetPanelStyle()` | `string` (JSON) | Panel-template style; same fields as C++ / WebSocket |
| `Seek` | `Seek(time)` | `bool` | Seek to that second |
| `GetPlaybackPosition` | `GetPlaybackPosition()` | `double` | Current playback position (seconds) |
| `GetPlaybackLength` | `GetPlaybackLength()` | `double` | Current track length (seconds) |

```
var k = new ActiveXObject("Klyrics.Engine");
k.AlwaysSearch = true;
k.SearchLyrics("", "", "");          // all empty = search the current track
k.ShowSearchWindow();
k.SetLyricLayers(6);                 // original + translation
k.SaveLyrics();
k.ShowPreferences("search.sources");
k.SetDesktopVisible(true);
k.SetDesktopLocked(true);
k.Seek(12.5);
var pos = k.GetPlaybackPosition();
var len = k.GetPlaybackLength();
```

### Three pushes

- `SetOnLyricsLoaded(fn)` / `OnLyricsLoaded = fn` → `fn(count, path)`
- `SetOnLyricsUpdated(fn)` / `OnLyricsUpdated = fn` → `fn(index, time, text, trans)`. `index === -1` when there is no current line.
- `SetOnConfigChanged(fn)` / `OnConfigChanged = fn` → `fn(styleJson, layers)`. Fired when panel appearance or lyric language changes.

### Panel sample

The full script is [`github/sdk/klyrics_com.js`](../sdk/klyrics_com.js): create the engine, probe every member, bind the three pushes, and paint the current line.

---

## Local WebSocket

Windows and macOS. Binds `127.0.0.1` only. Enabled by default, port **9999**. Toggle it or change the port (`1`–`65535`; invalid values fall back to 9999) under **Tools → Klyrics → Updates**. Changes apply as soon as you click Apply. If the port is in use, the console logs `WebSocket bind 127.0.0.1:<port> failed` and the component stays up.

Protocol: RFC 6455 text frames, one JSON object per frame. The client sends a command; the server replies once. Load / line-change events are **pushed** on their own; they are not replies to a command.

- Commands must include `"cmd"`.
- Success: `{"ok":true, …}`. Failure: `{"ok":false,"error":"…"}`.
- Pushes use `"event"` and have no `"ok"`.
- Boolean arguments use `"on"`. If omitted on a `set_*` command, the value defaults to `true`.

```
ws://127.0.0.1:9999
```

### Read-only commands

| Command | Request | Success |
| --- | --- | --- |
| `get_line_count` | `{"cmd":"get_line_count"}` | `{"ok":true,"count":12}` |
| `get_line` | `{"cmd":"get_line","index":3}` | `{"ok":true,"start_time":12.5,"duration":0,"text":"…","translation":"…"}` |
| `get_raw_lrc` | `{"cmd":"get_raw_lrc"}` | `{"ok":true,"lrc":"…"}` |
| `get_line_index` | `{"cmd":"get_line_index","time":12.5}` | `{"ok":true,"index":3}` (invalid = line count, same as C++) |
| `get_source_path` | `{"cmd":"get_source_path"}` | `{"ok":true,"path":"…"}` |

When there are no lyrics: `count` / `index` are `0`, `lrc` / `path` are `""`. `get_line` out of range: `{"ok":false,"error":"bad index"}`.

### Service commands

| Command | Request | Success |
| --- | --- | --- |
| `set_always_search` | `{"cmd":"set_always_search","on":true}` | `{"ok":true}` |
| `always_search` | `{"cmd":"always_search"}` | `{"ok":true,"on":true}` |
| `search_lyrics` | `{"cmd":"search_lyrics","title":"…","artist":"…","album":"…"}` | `{"ok":true}`; still empty after fallback → `empty query` |
| `show_search_window` | `{"cmd":"show_search_window"}` | `{"ok":true}` |
| `show_edit_window` | `{"cmd":"show_edit_window"}` | `{"ok":true}` |
| `set_lyric_layers` | `{"cmd":"set_lyric_layers","layers":6}` | `{"ok":true}` |
| `lyric_layers` | `{"cmd":"lyric_layers"}` | `{"ok":true,"layers":6}` |
| `save_lyrics` | `{"cmd":"save_lyrics"}` | `{"ok":true}` or `save failed` |
| `show_preferences` | `{"cmd":"show_preferences","page_id":"desktop.fx"}` | `{"ok":true}` or `unknown page` |
| `set_desktop_visible` | `{"cmd":"set_desktop_visible","on":true}` | `{"ok":true}` |
| `set_desktop_locked` | `{"cmd":"set_desktop_locked","on":true}` | `{"ok":true}` |
| `desktop_visible` | `{"cmd":"desktop_visible"}` | `{"ok":true,"on":true}` |
| `set_float_visible` / `set_float_locked` / `float_visible` | same | same |
| `set_taskbar_visible` / `set_taskbar_locked` / `taskbar_visible` | same | same (always `false` on macOS) |
| `get_panel_style` | `{"cmd":"get_panel_style"}` | `{"ok":true,"style":{…}}` (same fields as theme export) |
| `seek` | `{"cmd":"seek","time":12.5}` | `{"ok":true}`; cannot seek → `seek failed` |
| `playback_position` | `{"cmd":"playback_position"}` | `{"ok":true,"time":12.5}` |
| `playback_length` | `{"cmd":"playback_length"}` | `{"ok":true,"length":180}` |

`title` / `artist` / `album` / `page_id` may be omitted (treated as `""`). All-empty `search_lyrics` falls back to the current track.

Other errors: `{"ok":false,"error":"missing cmd"}`, `{"ok":false,"error":"unknown cmd"}`.

### Pushes

Sent automatically after connect. No subscribe step.

```
{"event":"lyrics_loaded","count":12,"path":"D:\\lyrics\\song.lrc"}
{"event":"lyrics_updated","index":3,"time":12.5,"text":"original","trans":"translation"}
{"event":"config_changed","layers":15,"style":{"font_size":14,"bg_mode":"color",...}}
```

`lyrics_updated.index` matches COM: `-1` when there is no current line. `text` / `trans` / `path` may be empty.

### Example

```js
const ws = new WebSocket("ws://127.0.0.1:9999");
ws.onmessage = (ev) => console.log(ev.data);
ws.onopen = () => {
    ws.send(JSON.stringify({ cmd: "get_line_count" }));
    ws.send(JSON.stringify({ cmd: "get_panel_style" }));
    ws.send(JSON.stringify({ cmd: "search_lyrics", title: "", artist: "", album: "" }));
    ws.send(JSON.stringify({ cmd: "set_desktop_visible", on: true }));
    ws.send(JSON.stringify({ cmd: "show_preferences", page_id: "desktop.fx" }));
    ws.send(JSON.stringify({ cmd: "seek", time: 12.5 }));
};
```

### Browser canvas demo

A minimal drawing sample ships with the repo (custom color / transparent background and line-change scroll only; no effects):

- [sdk/klyrics_client.js](../sdk/klyrics_client.js): `Klyrics.createClient({ url, onStatus, onChange })` — WebSocket layer only, no DOM / canvas; holds lyrics, style, scroll, and playback state
- [sdk/klyrics.js](../sdk/klyrics.js): `Klyrics.mount(canvas, { width, height, url })` — paints from the client; drag to seek, context menu mirrors the panel (only items with a live API)
- [sdk/klyrics.html](../sdk/klyrics.html): open in a browser; load `klyrics_client.js` before `klyrics.js`; start foobar2000 and enable the local WebSocket first

```js
// Interface only — bring your own renderer:
const client = Klyrics.createClient({
  url: "ws://127.0.0.1:9999",
  onChange: () => drawMyLyrics(client),
});

// Or use the built-in canvas demo:
const panel = Klyrics.mount(document.getElementById("lyric"), {
  width: 420,
  height: 560,
  url: "ws://127.0.0.1:9999",
});
```
