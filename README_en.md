# Klyrics (foo_klyrics)

A visual lyrics component for foobar2000: an embedded panel, transparent desktop lyrics, and Windows taskbar lyrics. It reads lyrics from the file tags first, then local `.lrc` files, then [LRCLIB](https://lrclib.net), Kugou, QQ Music, and NetEase Cloud Music. Supports line-level karaoke and a timing editor. Chinese display name **快乐歌词**.

File versions: Windows `2.26.8.31`, macOS `2.26.8.31`. Product version `2.0.0.2`. 中文：[README.md](README.md).

This repository hosts **release binaries** and open community JS scripts. The component source is not published. Get the installers from the repo **Releases** page.

## Updates

### 2.0.0.2 (2026-08-31)

- You can place several panels; each can use **This panel appearance** or **Follow global settings**
- Double-click a panel or use **Fullscreen** on the context menu; Esc exits (overlay window, layout unchanged)
- **Enable Klyrics** on the View menu and panel menu is the master switch
- While layout editing, right-click shows foobar’s Cut / Replace menu instead of the component menu
- Floating-window hover now shows a tinted rounded background, toolbar, and corner handles; no seek bar and lyrics are no longer dimmed

## Screenshots

### Windows

![Windows: panel and desktop lyrics](screenshot/win/win.png)

![Embedded panel](screenshot/win/panel-lrc.png)

![Columns UI transparent background](screenshot/win/transparent-background.png)

![Desktop lyrics](screenshot/win/desktop-lrc.png)

![Floating window](screenshot/win/float-win-lrc.png)

![Taskbar lyrics](screenshot/win/taskbar-lrc.png)

![View menu](screenshot/win/view-menu.png)

![Preferences · About](screenshot/win/about.png)

![Components list](screenshot/win/components.png)

### macOS

![macOS: panel, desktop, and floating window](screenshot/macOS/macOS.png)

![Embedded panel](screenshot/macOS/panel-lrc.png)

![Desktop lyrics](screenshot/macOS/desktop-lrc.png)

![Floating window](screenshot/macOS/float-win-lrc.png)

## Supported players

| Item | Requirement |
| --- | --- |
| OS | Windows 10 / 11; macOS 11+ |
| Player | **Windows: foobar2000 2.0+** (32-bit or 64-bit); **Mac: foobar2000 2.6+** |
| UI | Windows: **Default UI** and **Columns UI** can host the panel (CUI needs [Columns UI](https://yuo.be/columns-ui)). macOS uses the player’s own layout |
| Not supported | foobar2000 1.x; Windows components cannot be loaded on Mac and vice versa; no vertical taskbar lyrics; no taskbar lyrics on macOS |

32-bit and 64-bit are two different DLLs. Do not mix them.

| Player | Component file | Install folder |
| --- | --- | --- |
| foobar2000 2.x **32-bit** | `foo_klyrics.dll` | `%APPDATA%\foobar2000-v2\user-components\foo_klyrics\` |
| foobar2000 2.x **64-bit** | `foo_klyrics.dll` | `%APPDATA%\foobar2000-v2\user-components-x64\foo_klyrics\` |
| foobar2000 **Mac** | `foo_klyrics.component` | `~/Library/foobar2000-v2/user-components/` |

## Install

1. Open this repo’s **Releases** page and download the package for your OS.
2. In foobar: **File → Preferences → Components → Install**, then pick the DLL / `.fb2k-component` / `.component`. On Windows, if both bitnesses sit in one folder (or one `.fb2k-component`), Install picks the matching DLL.
3. Or copy the file into the folder above and **restart** foobar2000.

A typical 64-bit Windows path:

```
C:\Users\<name>\AppData\Roaming\foobar2000-v2\user-components-x64\foo_klyrics\foo_klyrics.dll
```

Remove old `foo_klrc` folders or `foo_klrc.dll` / `foo_klrc64.dll` so two copies are not loaded at once.

Add the panel:

| UI | How |
| --- | --- |
| **Default UI (DUI)** | Layout edit mode → insert UI element **Klyrics** (Chinese UI: **快乐歌词**) |
| **Columns UI (CUI)** | Install Columns UI, set the user interface module to Columns UI in Preferences → Display, and restart. Layout edit → add panel → **Panels** → **Klyrics** |

While layout editing is on, a right-click on the lyrics panel shows foobar’s Cut / Replace menu, not the Klyrics menu. You can place several panels; each can have its own **This panel appearance**.

Desktop lyrics, taskbar lyrics, menus, and Preferences do not depend on DUI/CUI. Taskbar lyrics are Windows-only.

## Features

- **Panel**: follow-playback scroll, karaoke highlight, album/artist art, paired bilingual lines. Several panels can each have their own appearance; double-click or the context menu opens fullscreen (Esc exits). **Enable Klyrics** on the View menu / panel menu is the master switch
- **Desktop lyrics**: transparent until hover; horizontal or vertical layout, seek bar, KTV stroke, 3D shadow, image fill
- **Floating window**: borderless; fully transparent until hover shows a tinted background and toolbar (no seek bar)
- **Taskbar lyrics** (Windows only): one line in the free taskbar gap
- **Lyric search**: tags → local `.lrc` → online (LRCLIB / Kugou / QQ / NetEase); manual search can preview before applying
- **Artwork search**: iTunes and others; separate from lyric search
- **Timing editor**: stamp timestamps on lyrics

The View menu group follows the UI language: **快乐歌词** in Chinese, **Klyrics** in English.

### Where lyrics come from

After a track opens, lyrics are looked up in this order. If none hit, enabled sources are searched automatically (best match applied, no dialog):

1. File tags (`[mm:ss]` is treated as LRC, otherwise as plain text)
2. The track’s folder
3. `lyrics/<artist>/` under the save folder
4. Extra paths from Preferences

If the file already has tag lyrics, the next load still prefers the tags. Online results are not written back into the audio file.

### Panel drag

Embedded panel only. A click with no movement is ignored.

| Keys | On release |
| --- | --- |
| None | Seek to the preview time |
| Ctrl | Shift **all** timestamps so the line under the crosshair **starts now** |
| Shift | Same, from that line through the end |

### Editor shortcuts

Active when the editor has focus (do not use Space to stamp).

| | Windows | macOS |
| --- | --- | --- |
| Stamp and go to next line | F8 | Opt+D |
| Re-stamp current line | Shift+F8 | Shift+Opt+D |
| Clear timestamp | F7 | Opt+A |
| Current line ±0.2 s | Ctrl+− / Ctrl++ | Opt+W / Opt+S |

On Mac, F7 / F8 are system media keys and cannot stamp.

## Preferences

**File → Preferences → Display → Klyrics** (Chinese UI: **快乐歌词**)

Language, Search, Artwork, Panel, Floating window, Desktop, and Taskbar (Windows only). On Windows, click **Apply** after changes. On macOS, changes apply immediately.

Default download folder: Windows `%ALLUSERSPROFILE%\Klyrics\download`, macOS `~/Library/Application Support/Klyrics`.

## Community scripts

LRCLIB, Kugou, QQ, and NetEase are built in and cannot be replaced by scripts. Extra lyric or artwork sources can be `.js` files in:

- Windows: `%APPDATA%\foobar2000-v2\klyrics-data\scripts\`
- macOS: `~/Library/foobar2000-v2/klyrics-data/scripts/`

This repo’s [`scripts/`](scripts/) folder has examples: `lyricsovh.js` (lyrics) and `deezerart.js` (covers / artist photos). Copy them in, restart foobar, and move the source to **In use** on the Search or Artwork page.

Writing guide: [Community Script Guide](docs/script-guide.en.md).
