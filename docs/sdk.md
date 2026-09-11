# Klyrics 歌词服务 SDK

自 **2.0.0.9** 起，Klyrics 可作为 foobar2000 里的**歌词数据引擎**：其他原生组件和 JS 面板可以读取已经解析、对齐、翻译后的歌词。

两套入口：

1. **C++ SDK**（Windows / macOS）：`sdk/klyrics_api.h`
2. **COM / ActiveX**（仅 Windows）：ProgID `Klyrics.Engine`，给 JScript Panel 3、Spider Monkey Panel 等用

English: [sdk.en.md](sdk.en.md)。头文件：[sdk/klyrics_api.h](../sdk/klyrics_api.h)。

---

## 约定

- 时间单位一律是秒（`double`）。
- 字符串是 UTF-8。COM 侧会转成 JS 的 `String`。
- `klyrics_result*` 和其中的 `const char*` **不要** `delete` / `free`。指针在下一次歌词更新后失效，回调里立刻拷走需要的数据。
- 两个推送不要混：`on_lyrics_loaded` 是加载成功；`on_lyrics_updated` 是切行推当前行。

正式 GUID：

| 接口 | GUID |
| --- | --- |
| `klyrics_api` | `{3E8A6C41-9B17-4F2D-A8E5-1C70D4B9E263}` |
| `klyrics_callback` | `{7B14D9E2-5C38-4A61-9F20-8E4D6A1C0B75}` |
| COM `Klyrics.Engine` | `{A91C4E70-2D58-4B13-8E6A-5F30C7D1B849}` |

---

## C++ SDK

工程里先包含 foobar2000 SDK，再：

```cpp
#include <foobar2000.h>
#include "klyrics_api.h"
```

`klyrics_line_t`：`start_time`、`duration`、`text`、`translation`。

`klyrics_result`：

- `get_line_count()`
- `get_line(index, out_line)`
- `get_raw_lrc()`
- `get_line_index(time_sec)`：最后一行 `start_time <= time_sec`。无歌词返回 `0`；早于首行返回 `get_line_count()`（不是有效下标）
- `get_source_path()`：本地歌词文件 UTF-8 路径。内嵌 / 标签 / 未保存到文件时为 `""`

`query_lyrics(p_track, out_result)`：`p_track` 为空则查当前曲；传入曲目时只有它就是正在播放的那首才成功。Klyrics 未加载时 `static_api_ptr_t<klyrics_api>` 会失败，请捕获或改用枚举。

### PUSH：两个独立事件

实现 `klyrics_callback` 并用 `service_factory_single_t` 注册。

1. `on_lyrics_loaded(track, line_count, file_path)`：歌词加载成功。内嵌 / 未落盘时 `file_path` 为 `""`。
2. `on_lyrics_updated(track, result, line_index)`：切到新行，推当前行。同一行不重复推。`line_index` 无效时等于 `get_line_count()`。

整份歌词正文用 PULL，不要等一次「加载回调」当全文。

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

### PULL：主动查询

```cpp
static_api_ptr_t<klyrics_api> api;
klyrics_result* result = nullptr;
if (api->query_lyrics(metadb_handle_ptr(), result) && result != nullptr) {
    const char* lrc = result->get_raw_lrc();
    (void)lrc;
}
```

---

## COM（仅 Windows）

组件在 UI 起来之前写入当前用户 `HKEY_CURRENT_USER\Software\Classes`，JScript Panel 加载时就能 `ActiveXObject("Klyrics.Engine")`。不需要管理员提权。退出时清理注册。另一份仍在运行的 foobar 占用同一 ProgID 时，不覆盖对方的注册表。

| | |
| --- | --- |
| ProgID | `Klyrics.Engine` |
| CLSID | `{A91C4E70-2D58-4B13-8E6A-5F30C7D1B849}` |

方法：`GetLineCount()`、`GetLineTime(index)`、`GetLineText(index)`、`GetLineTranslation(index)`、`GetLineIndex(time)`、`GetLyricPath()`。

- `GetLineIndex(time)`：播放进度（秒）→ 行号（从 0）。无歌词或早于首行返回 `-1`。
- `GetLyricPath()`：歌词文件路径。内嵌 / 未保存到文件时返回 `""`。

两个推送：

- `SetOnLyricsLoaded(fn)` / `OnLyricsLoaded = fn` → `fn(count, path)`
- `SetOnLyricsUpdated(fn)` / `OnLyricsUpdated = fn` → `fn(index, time, text, trans)`。无当前行时 `index === -1`

对象必须挂在全局变量上，否则被回收后推送会停。JScript Panel 3 没有 `on_init`，创建引擎和挂回调写在脚本顶层。

### 拉取 Demo

```
function on_mouse_lbtn_up(x, y) {
    try {
        var klyrics = new ActiveXObject("Klyrics.Engine");
        var count = klyrics.GetLineCount();
        console.log("Klyrics 当前包含歌词行数: " + count);
        if (count > 0) {
            var time = klyrics.GetLineTime(0);
            var text = klyrics.GetLineText(0);
            var trans = klyrics.GetLineTranslation(0);
            console.log("首行测试: [" + time + "] " + text + " (" + trans + ")");
        }
    } catch (e) {
        console.log("COM 调用出错，Klyrics 可能未加载: " + e.message);
    }
}
```

### 推送 Demo

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
        console.log("Klyrics 初始化成功");
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
        gr.WriteText("等待切行推送…", g_font, RGB(160, 160, 160), 10, 10, w - 20, 24);
        return;
    }
    gr.WriteText(g_text, g_font_hi, RGB(255, 220, 80), 10, 12, w - 20, 28);
    if (g_trans) {
        gr.WriteText(g_trans, g_font, RGB(180, 180, 190), 10, 44, w - 20, 24);
    }
}
```
