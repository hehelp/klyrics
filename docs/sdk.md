# Klyrics 歌词服务 SDK

自 **2.0.0.9** 起，Klyrics 可作为 foobar2000 里的**歌词数据引擎**：其他原生组件和 JS 面板可以读取已经解析、对齐、翻译后的歌词。自本次起再提供**服务命令**：静默搜词、开窗口、改图层、保存、打开偏好页，以及桌面 / 浮窗 / 任务栏的显示与锁定。

三套入口共用同一套实现；写配置、开窗口都会切到主线程。

1. **C++ SDK**（Windows / macOS）：`sdk/klyrics_api.h`
2. **COM / ActiveX**（仅 Windows）：ProgID `Klyrics.Engine`，给 JScript Panel 3、Spider Monkey Panel 等用
3. **本机 WebSocket**（Windows / macOS）：只绑 `127.0.0.1`，默认端口 **9999**

English: [sdk.en.md](sdk.en.md)。头文件：[sdk/klyrics_api.h](../sdk/klyrics_api.h)。

---

## 约定

- 时间单位一律是秒（`double`）。
- 字符串是 UTF-8。COM 侧会转成 JS 的 `String`。
- `klyrics_result*` 和其中的 `const char*` **不要** `delete` / `free`。指针在下一次歌词更新后失效，回调里立刻拷走需要的数据。
- 三个推送不要混：`on_lyrics_loaded` 是加载成功；`on_lyrics_updated` 是切行推当前行；`on_config_changed` 是面板外观 / 图层配置已改。
- `search_lyrics` 只表示**已经发起**静默 AutoBest，真正搜到后才会再走加载推送。不会为「任意一首未在播的歌」单独返回一份不应用的 LRC。
- 查询「窗口是否显示」看的是**窗口是否真的在**，不是只读配置项。
- macOS 没有任务栏歌词：`set_taskbar_*` 空操作，`taskbar_visible` 恒为 `false`。

行号语义（C++ 与 COM / 切行推送不同）：

| 场景 | C++ `get_line_index` / `on_lyrics_updated` | COM `GetLineIndex` / `OnLyricsUpdated` | WS `get_line_index` | WS `lyrics_updated` |
| --- | --- | --- | --- | --- |
| 有效当前行 | `0 … count-1` | `0 … count-1` | `0 … count-1` | `0 … count-1` |
| 无歌词 / 早于首行 | `get_line_count()`（不是有效下标） | `-1` | 与 C++ 相同（返回行数） | `-1` |

正式 GUID：

| 接口 | GUID |
| --- | --- |
| `klyrics_api` | `{3E8A6C41-9B17-4F2D-A8E5-1C70D4B9E263}` |
| `klyrics_callback` | `{7B14D9E2-5C38-4A61-9F20-8E4D6A1C0B75}` |
| COM `Klyrics.Engine` | `{A91C4E70-2D58-4B13-8E6A-5F30C7D1B849}` |

---

## 三套出口对照

命令名：C++ / WebSocket 用蛇形；COM 用 PascalCase。语义相同。

| 能力 | C++ / WebSocket | COM |
| --- | --- | --- |
| 总是搜索 | `set_always_search` / `always_search` | `SetAlwaysSearch` / `AlwaysSearch` |
| 静默搜词 | `search_lyrics` | `SearchLyrics` |
| 选歌词窗 | `show_search_window` | `ShowSearchWindow` |
| 编辑歌词窗 | `show_edit_window` | `ShowEditWindow` |
| 歌词图层 | `set_lyric_layers` / `lyric_layers` | `SetLyricLayers` / `GetLyricLayers`（别名 `LyricLayers`） |
| 按当前规则保存 | `save_lyrics` | `SaveLyrics` |
| 打开偏好页 | `show_preferences` | `ShowPreferences` |
| 桌面歌词 | `set_desktop_visible` / `set_desktop_locked` / `desktop_visible` | `SetDesktopVisible` / `SetDesktopLocked` / `DesktopVisible` |
| 浮窗歌词 | `set_float_visible` / `set_float_locked` / `float_visible` | `SetFloatVisible` / `SetFloatLocked` / `FloatVisible` |
| 任务栏歌词 | `set_taskbar_visible` / `set_taskbar_locked` / `taskbar_visible` | `SetTaskbarVisible` / `SetTaskbarLocked` / `TaskbarVisible` |
| 面板模板样式 | `get_panel_style_json` / WS `get_panel_style` | `GetPanelStyle` |
| 跳转进度 | `seek` / `playback_position` / `playback_length` | `Seek` / `GetPlaybackPosition` / `GetPlaybackLength` |

只读歌词（原有 PULL）：

| 能力 | C++ `klyrics_result` | COM | WebSocket |
| --- | --- | --- | --- |
| 行数 | `get_line_count()` | `GetLineCount()` | `get_line_count` |
| 一行 | `get_line(index, out)` | `GetLineTime` / `GetLineText` / `GetLineTranslation` | `get_line` |
| 原文 LRC | `get_raw_lrc()` | `GetRawLrc()` | `get_raw_lrc` |
| 进度 → 行号 | `get_line_index(time)` | `GetLineIndex(time)` | `get_line_index` |
| 歌词文件路径 | `get_source_path()` | `GetLyricPath()` | `get_source_path` |

---

## 共享常量

### 歌词图层（bitmask）

`set_lyric_layers` / `lyric_layers` 用按位或。超出低 4 位的位会被丢掉；若结果为 `0`，回退为原文（`2`）。

| 位 | 值 | 含义 |
| --- | --- | --- |
| Ruby | `1` | 注音 |
| Original | `2` | 原文 |
| Translation | `4` | 译文 |
| Romaji | `8` | 罗马音 |

例：原文 + 译文 = `6`；四层全开 = `15`（出厂默认）。

### 偏好页短名

`show_preferences(page_id)` 接受短名或 `{GUID}`（可带或不带花括号、连字符）。空字符串或 `about` 打开根页（关于）。未知短名且又不是合法 GUID 时返回失败。

| 短名 | 页 |
| --- | --- |
| `about` | 关于（根页） |
| `language` | 语言 |
| `translate` | 翻译 |
| `theme` | 主题 |
| `artwork` | 图片 |
| `privacy` | 更新（含 WebSocket 开关） |
| `panel` | 面板模板 |
| `panel.fx` | 面板模板 → 效果 |
| `desktop` | 桌面 |
| `desktop.fx` | 桌面 → 效果 |
| `float` | 浮窗 |
| `float.fx` | 浮窗 → 效果 |
| `taskbar` | 任务栏（仅 Windows） |
| `taskbar.fx` | 任务栏 → 效果 |
| `search` | 搜索 |
| `search.save` | 搜索 → 保存歌词 |
| `search.paths` | 搜索 → 额外目录 |
| `search.sources` | 搜索 → 搜索源 |
| `search.filter` | 搜索 → 过滤器 |

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

服务命令追加在同一 `klyrics_api` 末尾，旧组件只调 `query_lyrics` 不受影响。不另开第二个 service。

### 服务命令

```cpp
static_api_ptr_t<klyrics_api> api;

api->set_always_search(true);
const bool always = api->always_search();

// 空字段用当前曲补齐。返回 true 只表示已发起搜索。
const bool started = api->search_lyrics("标题", "歌手", "专辑");
api->show_search_window();
api->show_edit_window();

api->set_lyric_layers(2u | 4u); // 原文 + 译文
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

| 方法 | 参数 / 返回 | 说明 |
| --- | --- | --- |
| `set_always_search(bool)` / `always_search()` | 读写 `bool` | 新曲即使没有任何歌词窗口，也自动搜索并下载。对应偏好「总是搜索歌词」（`search_without_ui`）。作为歌词引擎、自己不画词时，用这个打开后台搜词。 |
| `search_lyrics(title, artist, album)` | UTF-8，可为 `nullptr` / `""`；`bool` | 无窗口 AutoBest，结果应用到**当前曲**。某一字段为空则用当前曲标签补齐。三个字段补齐后仍全空则返回 `false`，不发起搜索。 |
| `show_search_window()` | 无 | 打开现有「选歌词」窗（当前曲，Interactive）。 |
| `show_edit_window()` | 无 | 打开歌词编辑窗。 |
| `set_lyric_layers(mask)` / `lyric_layers()` | `uint32_t` | 见上方 bitmask。 |
| `save_lyrics()` | `bool` | 按当前搜索保存规则落盘（不自动保存 / 标签 / 歌曲目录 / 指定目录）。失败返回 `false`。 |
| `show_preferences(page_id)` | 短名或 `{GUID}`；`bool` | 打开对应偏好页。未知页返回 `false`。 |
| `set_desktop_visible(on)` / `set_desktop_locked(on)` / `desktop_visible()` | `bool` | 显示会同时写配置并真正开/关窗口。`desktop_visible()` 看窗口在不在。浮窗、任务栏同理。 |
| `get_panel_style_json()` | `const char*` | 面板模板样式 JSON（UTF-8）。字段名与主题导出一致：`font_family`、`font_weight`、`font_size`、`italic`、`text`、`highlight`、`passed`、`bg`、`bg_mode`（`theme`/`color`/`transparent`/`image`）、`stroke`、`scroll_mode`（`line`/`smooth`）、`fade`、`fade_lines`、`karaoke`、`current_scale`、`line_spacing`、`wrap`、`lyric_fx`。指针下次调用本方法后失效。 |
| `seek(time_sec)` | `double`；`bool` | 跳到指定秒。当前曲不能 seek 时返回 `false`。 |
| `playback_position()` | `double` | 当前播放位置（秒）。无播放为 `0`。 |
| `playback_length()` | `double` | 当前曲时长（秒）。未知为 `0`。 |

### PUSH：两个独立事件

实现 `klyrics_callback` 并用 `service_factory_single_t` 注册。

1. `on_lyrics_loaded(track, line_count, file_path)`：歌词加载成功。内嵌 / 未落盘时 `file_path` 为 `""`。
2. `on_lyrics_updated(track, result, line_index)`：切到新行，推当前行。同一行不重复推。`line_index` 无效时等于 `get_line_count()`。
3. `on_config_changed(style_json)`：面板模板或歌词图层改了。`style_json` 与 `get_panel_style_json()` 相同；有默认空实现，旧组件可不覆盖。

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

组件在 UI 起来之前写入当前用户 `HKEY_CURRENT_USER\Software\Classes`，JScript Panel 加载时就能 `ActiveXObject("Klyrics.Engine")`。不需要管理员提权。退出时清理注册。另一份仍在运行的 foobar 占用同一 ProgID 时，不覆盖对方的注册表。DLL 内嵌类型库（`GetTypeInfo` / `IProvideClassInfo2`），JSplitter 3.8+ 在构造 `ActiveXObject` 时会要这份信息。

| | |
| --- | --- |
| ProgID | `Klyrics.Engine` |
| CLSID | `{A91C4E70-2D58-4B13-8E6A-5F30C7D1B849}` |

对象必须挂在全局变量上，否则被回收后推送会停。JScript Panel 3 没有 `on_init`，创建引擎和挂回调写在脚本顶层。

把 [`github/sdk/klyrics_com.js`](../sdk/klyrics_com.js) 整段贴进 JScript Panel 3 或 JSplitter。启动时会在控制台自检全部 COM 接口（`ok` / `FAIL`）。会打开窗口或落盘的方法（`SearchLyrics`、`ShowSearchWindow`、`ShowEditWindow`、`SaveLyrics`）只检查名字在不在，不真正调用。JSP3 走 `gr.WriteText`；JSplitter / SMP 走 `gr.GdiDrawText`。

### JSplitter / Spider Monkey Panel

JSplitter 3.8+ 在 `new ActiveXObject` 时解析类型库，只把 **INVOKE_FUNC** 挂成 JS 函数；属性走另一套 get/set。JS 名字大小写敏感，必须与下表 PascalCase 一致。

| 用法 | JSplitter | 不要写成 |
| --- | --- | --- |
| 方法 | `k.GetLineCount()`、`k.DesktopVisible()`、`k.LyricLayers()` | `k.GetLineCount`、`k.DesktopVisible`（拿到的是函数，`if (k.DesktopVisible)` 恒为真） |
| `AlwaysSearch` | `k.AlwaysSearch` / `k.AlwaysSearch = true` | `k.AlwaysSearch()` |
| 挂回调 | `k.OnLyricsUpdated = on_line` 或 `k.SetOnLyricsUpdated(on_line)` | `on_line.bind(this)`（JSplitter 包装后容易类型不匹配） |
| 清回调 | `k.OnLyricsUpdated = null` 或 `k.SetOnLyricsUpdated(null)` | — |
| 可选参数 | `k.SearchLyrics()`、`k.ShowPreferences()` 合法，缺的参数当空串 | — |

`GetLyricLayers()` 与 `LyricLayers()` 都是方法，返回当前图层。

### 只读方法

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `GetLineCount()` | `int` | 当前行数；无歌词为 `0` |
| `GetLineTime(index)` | `double` | 该行起始秒；越界为 `0` |
| `GetLineText(index)` | `string` | 原文；越界为 `""` |
| `GetLineTranslation(index)` | `string` | 译文；越界 / 无译文为 `""` |
| `GetLineIndex(time)` | `int` | 播放进度（秒）→ 行号（从 0）。无歌词或早于首行返回 `-1` |
| `GetLyricPath()` | `string` | 歌词文件路径。内嵌 / 未保存到文件时为 `""` |
| `GetRawLrc()` | `string` | 完整原始 LRC |

### 服务命令

`AlwaysSearch` 可当属性读写，也可调用 `SetAlwaysSearch(on)`。

| 方法 | JS 签名 | 返回 | 说明 |
| --- | --- | --- | --- |
| `SetAlwaysSearch` / `AlwaysSearch` | `SetAlwaysSearch(on)` / `AlwaysSearch = on` | 当前值 `bool` | 同 C++「总是搜索」 |
| `SearchLyrics` | `SearchLyrics(title, artist, album)` | `bool` | 静默 AutoBest。缺的参数当空串，用当前曲补齐 |
| `ShowSearchWindow` | `ShowSearchWindow()` | `true` | 打开选歌词窗 |
| `ShowEditWindow` | `ShowEditWindow()` | `true` | 打开编辑窗 |
| `SetLyricLayers` | `SetLyricLayers(mask)` | 写入后的 mask | bitmask 同上 |
| `GetLyricLayers` / `LyricLayers` | `GetLyricLayers()` / `LyricLayers()` | `int` | 当前图层 |
| `SaveLyrics` | `SaveLyrics()` | `bool` | 按当前保存规则落盘 |
| `ShowPreferences` | `ShowPreferences(pageId)` | `bool` | 短名或 `{GUID}` |
| `SetDesktopVisible` | `SetDesktopVisible(on)` | 窗口是否真的在 | 桌面显示 |
| `SetDesktopLocked` | `SetDesktopLocked(on)` | `true` | 桌面锁定 |
| `DesktopVisible` | `DesktopVisible()` | `bool` | 桌面是否在 |
| `SetFloatVisible` / `SetFloatLocked` / `FloatVisible` | 同上 | 同上 | 浮窗 |
| `SetTaskbarVisible` / `SetTaskbarLocked` / `TaskbarVisible` | 同上 | 同上 | 任务栏 |
| `GetPanelStyle` | `GetPanelStyle()` | `string`（JSON） | 面板模板样式，字段同 C++ / WebSocket |
| `Seek` | `Seek(time)` | `bool` | 跳到指定秒 |
| `GetPlaybackPosition` | `GetPlaybackPosition()` | `double` | 当前播放位置（秒） |
| `GetPlaybackLength` | `GetPlaybackLength()` | `double` | 当前曲时长（秒） |

```
var k = new ActiveXObject("Klyrics.Engine");
k.AlwaysSearch = true;
k.SearchLyrics("", "", "");          // 三个空 = 按当前曲搜
k.ShowSearchWindow();
k.SetLyricLayers(6);                 // 原文 + 译文
k.SaveLyrics();
k.ShowPreferences("search.sources");
k.SetDesktopVisible(true);
k.SetDesktopLocked(true);
k.Seek(12.5);
var pos = k.GetPlaybackPosition();
var len = k.GetPlaybackLength();
```

### 三个推送

- `SetOnLyricsLoaded(fn)` / `OnLyricsLoaded = fn` → `fn(count, path)`
- `SetOnLyricsUpdated(fn)` / `OnLyricsUpdated = fn` → `fn(index, time, text, trans)`。无当前行时 `index === -1`
- `SetOnConfigChanged(fn)` / `OnConfigChanged = fn` → `fn(styleJson, layers)`。偏好里改面板外观或歌词语言时推。

### 面板示例

完整脚本见 [`github/sdk/klyrics_com.js`](../sdk/klyrics_com.js)：创建引擎、自检全部接口、挂三个推送、画当前行。

---

## WebSocket（本机）

Windows / macOS。只绑 `127.0.0.1`，出厂**开启**，端口 **9999**。偏好 **工具 → 快乐歌词 → 更新** 可关，或改端口（`1`–`65535`，非法值回退 9999）。点「应用」后立刻重绑。端口被占用时控制台打 `WebSocket bind 127.0.0.1:<port> failed`，组件不崩。

协议：RFC 6455 文本帧，一条 JSON 一条。客户端发命令，服务端回一条应答。加载 / 切行会**主动推**事件，不是对应某条命令的应答。

- 命令必须带 `"cmd"`。
- 应答成功：`{"ok":true, …}`；失败：`{"ok":false,"error":"…"}`。
- 推送带 `"event"`，没有 `"ok"`。
- 布尔参数键名是 `"on"`；省略时默认 `true`（只对 `set_*` 生效）。

```
ws://127.0.0.1:9999
```

### 只读命令

| 命令 | 请求 | 成功应答 |
| --- | --- | --- |
| `get_line_count` | `{"cmd":"get_line_count"}` | `{"ok":true,"count":12}` |
| `get_line` | `{"cmd":"get_line","index":3}` | `{"ok":true,"start_time":12.5,"duration":0,"text":"…","translation":"…"}` |
| `get_raw_lrc` | `{"cmd":"get_raw_lrc"}` | `{"ok":true,"lrc":"…"}` |
| `get_line_index` | `{"cmd":"get_line_index","time":12.5}` | `{"ok":true,"index":3}`（无效时为行数，与 C++ 相同） |
| `get_source_path` | `{"cmd":"get_source_path"}` | `{"ok":true,"path":"…"}` |

无歌词时：`count` / `index` 为 `0`，`lrc` / `path` 为 `""`。`get_line` 越界：`{"ok":false,"error":"bad index"}`。

### 服务命令

| 命令 | 请求 | 成功应答 |
| --- | --- | --- |
| `set_always_search` | `{"cmd":"set_always_search","on":true}` | `{"ok":true}` |
| `always_search` | `{"cmd":"always_search"}` | `{"ok":true,"on":true}` |
| `search_lyrics` | `{"cmd":"search_lyrics","title":"…","artist":"…","album":"…"}` | `{"ok":true}`；补齐后仍空则 `empty query` |
| `show_search_window` | `{"cmd":"show_search_window"}` | `{"ok":true}` |
| `show_edit_window` | `{"cmd":"show_edit_window"}` | `{"ok":true}` |
| `set_lyric_layers` | `{"cmd":"set_lyric_layers","layers":6}` | `{"ok":true}` |
| `lyric_layers` | `{"cmd":"lyric_layers"}` | `{"ok":true,"layers":6}` |
| `save_lyrics` | `{"cmd":"save_lyrics"}` | `{"ok":true}` 或 `save failed` |
| `show_preferences` | `{"cmd":"show_preferences","page_id":"desktop.fx"}` | `{"ok":true}` 或 `unknown page` |
| `set_desktop_visible` | `{"cmd":"set_desktop_visible","on":true}` | `{"ok":true}` |
| `set_desktop_locked` | `{"cmd":"set_desktop_locked","on":true}` | `{"ok":true}` |
| `desktop_visible` | `{"cmd":"desktop_visible"}` | `{"ok":true,"on":true}` |
| `set_float_visible` / `set_float_locked` / `float_visible` | 同上 | 同上 |
| `set_taskbar_visible` / `set_taskbar_locked` / `taskbar_visible` | 同上 | 同上（macOS 查询恒为 `false`） |
| `get_panel_style` | `{"cmd":"get_panel_style"}` | `{"ok":true,"style":{…}}`（字段同主题导出） |
| `seek` | `{"cmd":"seek","time":12.5}` | `{"ok":true}`；不能跳则 `seek failed` |
| `playback_position` | `{"cmd":"playback_position"}` | `{"ok":true,"time":12.5}` |
| `playback_length` | `{"cmd":"playback_length"}` | `{"ok":true,"length":180}` |

`title` / `artist` / `album` / `page_id` 都可省略，当空串。`search_lyrics` 三个都空时用当前曲补齐。

其他错误：`{"ok":false,"error":"missing cmd"}`、`{"ok":false,"error":"unknown cmd"}`。

### 推送

连接后自动收，不必订阅。

```
{"event":"lyrics_loaded","count":12,"path":"D:\\lyrics\\song.lrc"}
{"event":"lyrics_updated","index":3,"time":12.5,"text":"原文","trans":"译文"}
{"event":"config_changed","layers":15,"style":{"font_size":14,"bg_mode":"color",...}}
```

`lyrics_updated` 的 `index` 与 COM 相同：无当前行为 `-1`。`text` / `trans` / `path` 可能是空串。

### 示例

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

### 浏览器画布 Demo

仓库自带简化绘制示例（只实现自定义色 / 透明背景与切行滚动，不实现特效）：

- [sdk/klyrics_client.js](../sdk/klyrics_client.js)：`Klyrics.createClient({ url, onStatus, onChange })` — WebSocket 接口层，无 DOM / canvas；维护歌词、样式、滚动、播放状态
- [sdk/klyrics.js](../sdk/klyrics.js)：`Klyrics.mount(canvas, { width, height, url })` — 用 client 状态在 canvas 上绘制；拖拽调进度、右键菜单对齐面板（仅已实现接口的项）
- [sdk/klyrics.html](../sdk/klyrics.html)：用浏览器打开；先加载 `klyrics_client.js` 再加载 `klyrics.js`；先启动 foobar2000 并启用本机 WebSocket

```js
// 只要接口、自己画 UI：
const client = Klyrics.createClient({
  url: "ws://127.0.0.1:9999",
  onChange: () => drawMyLyrics(client),
});

// 或直接用自带 canvas Demo：
const panel = Klyrics.mount(document.getElementById("lyric"), {
  width: 420,
  height: 560,
  url: "ws://127.0.0.1:9999",
});
```
