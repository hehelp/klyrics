# Klyrics 社区脚本编写指南

欢迎参与构建 Klyrics 插件生态！通过编写简单的 `.js` 脚本，您可以轻松为插件扩展自定义的歌词或图片数据源。

(注：为了追求极致性能，核心源如 `lrclib`、`kugou`、`qq` 和 `netease` 已通过 C++ 原生实现，无法被脚本覆盖。)

Klyrics 内置了轻量级的 QuickJS 引擎。脚本的职责非常纯粹：拼装 URL、解析 JSON 以及执行正则匹配。**为了保证运行帧率与绝对安全，所有的网络请求、哈希计算与 AES / DES / 3DES 加解密都已桥接至 C++ 底层，请务必直接调用原生** `Klyrics.`* **API**，切勿引入如 `md5.js` 或 `crypto.js` 这样臃肿的外部依赖。站点专用解密用 `Klyrics.decrypt(data, "krc"|"qrc")`，不要在脚本里重写酷狗 XOR 或腾讯 QRC 算法。

## 1. 脚本部署与目录规范

32 位与 64 位的 foobar2000 共享同一份数据目录（位于 `user-components` 同级文件夹中）：

- **Windows**: `%APPDATA%\foobar2000-v2\klyrics-data\scripts\`
- **macOS**: `~/Library/foobar2000-v2/klyrics-data/scripts/`

**基本规则：**

- **一源一文件**：文件名可自定义，但每个 `.js` 文件仅承载一个歌词源。
- **安全沙盒**：引擎禁用了 `require` 与 `import`，并且禁止执行从网络动态拉取的代码。
- **生效机制**：编辑脚本后，请**重启 foobar2000**（或重新进入“设置 → 搜索 / 图片”触发扫盘）。记得在对应设置页把新源移到“使用中”。

## 2. 极简骨架结构

一个合规的歌词脚本仅需三部分：全局元数据、`search` 函数以及 `fetch` 函数。

JavaScript

```
var klyrics_source = {
  id: "js:mysite",       // 必须以 js: 开头。请保持稳定，随意更改会导致用户设置失效
  name: "我的歌词站",     // 将展示在设置页与搜索面板中
  kind: "lyric",         // 歌词源用 lyric；图片源用 art，见第 6 节
  version: 1
};

function search(query) {
  return []; // 在此返回候选列表
}

function fetch(fetch_url, query) {
  return { synced: "", plain: "", tlyric: "" }; // 在此返回最终抓取的歌词文本
}
```

提示：宿主采用极速文本扫描来读取元数据。请将 `id`、`name` 等字段写成纯字符串字面量，不要使用变量拼接。

## 3. 认识 `query` 对象

宿主会在调用时传入一个 `query` 对象，包含当前播放曲目的核心信息：


| **字段**     | **类型** | **含义说明**         |
| ---------- | ------ | ---------------- |
| `title`    | string | 曲目名称             |
| `artist`   | string | 歌手名称             |
| `album`    | string | 专辑名称             |
| `duration` | number | 音轨时长（秒），未知时为 `0` |
| `path`     | string | 本地文件路径（可能为空）     |


## 4. 核心逻辑：`search` 与 `fetch`

### `search(query)` → 候选数组

返回搜索结果列表。宿主会自动为每条记录注入当前脚本的 `id`，您无需手动设置。


| **字段**                       | **含义说明**                            |
| ---------------------------- | ----------------------------------- |
| `title` / `artist` / `album` | 用于 UI 列表展示与匹配度打分。                   |
| `fetch_url`                  | 核心钥匙：供 `fetch` 阶段使用（如歌曲 ID、Hash 值）。 |
| `image_url`                  | （可选）封面 URL。具体的二进制下载与图片解码由 C++ 接管。   |
| `synced` / `plain`           | 逐字/时间轴歌词 与 纯文本歌词，均可留空。              |


**开发建议：**

- **宁缺毋滥**：只返回最匹配的几条结果（宿主上限为 32 条）。
- **提前排雷**：如果某些站点存在“有歌名但没歌词（404）”的通病，建议在 `search` 阶段就进行一次轻量级探活，剔除无效结果，避免用户点击后扑空。

### `fetch(fetch_url, query)` → 歌词对象

当用户选中某条结果（或系统自动命中）时触发。

JavaScript

```
return {
  synced: "...",   // 强烈建议优先返回带时间轴的 LRC
  plain: "...",    // 无时间轴的兜底文本
  tlyric: "..."    // （可选）翻译文本，宿主会自动进行优雅的双语排版
};
```

提示：如果两者皆为空，宿主将拦截并提示“搜索失败”。如果您在代码中 `throw new Error(...)`，错误原因也会直观地展示给用户。

## 5. 原生 Klyrics API 参考

为了保障性能，脚本运行环境没有开放文件读写权限。请统一使用全局 `Klyrics` 命名空间。

### 5.1 极速网络请求：`Klyrics.http(opt)`

该请求是**同步阻塞**的，但它运行在独立的后台 Worker 线程中，**绝对不会卡顿 foobar2000 的音频播放或 UI 渲染**。它自带取消支持与超时控制（约 26 秒）。

JavaScript

```
var res = Klyrics.http({
  method: "GET",                    // 默认 GET
  url: "https://example.com/api",
  headers: {                        // 缺省状态下，宿主会自动伪装为桌面版 Chrome
    "Referer": "https://example.com/"
  }
});
```

提示：非 2xx 的 HTTP 状态码不会导致脚本抛错，请自行查验 `res.status`[cite: 2]。用户手动取消搜索时，会抛出含 `aborted` 的异常[cite: 2]。

### 5.2 密码学与编码支持

原生 C++ 提供的算法库，性能零损耗。**所有加密哈希函数的输入均按 UTF-8 字节处理**[cite: 2]。

- **哈希运算 (返回小写 Hex)**：`Klyrics.md5(s)`、`Klyrics.sha256(s)` 以及对应的 HMAC 系列方法[cite: 2]。
- **基础编码**：支持 `urlEncode`、`base64` 与 `hex` 的相互转换[cite: 2]。

**AES / DES / 3DES 加解密：**

JavaScript

```
// 轻松搞定各种大厂的加密返回体
var plain = Klyrics.aesDecrypt(json.lyric, "0123456789abcdef0123456789abcdef", {
  mode: "ecb", // 或 "cbc"
  encoding: "hex", // 密钥与数据格式支持 "hex", "base64", "utf8", "raw"
  iv: "" // CBC 模式需提供 16 字节的 IV
});

// DES 密钥 8 字节；3DES 16 或 24 字节。QRC 一类站点常用 3DES-ECB 且可能没有 PKCS7
var raw = Klyrics.des3Decrypt(json.lyric, key24, {
  mode: "ecb",
  encoding: "base64",
  padding: "none" // 默认 "pkcs7"
});
```

**Zlib 解压（逐字歌词常用）：**

不少站点的逐字 / KRC / QRC 正文是 **zlib 压缩**（有时是 gzip 或裸 deflate），不是 `.zip` 文件。解密或 Base64 解码之后，用宿主解压，不要自带 `pako.js`。

JavaScript

```
// 已经是原始压缩字节（例如刚 base64Decode / 异或完）
var text = Klyrics.inflate(bytes);

// JSON 里是 Base64 或 hex 压缩包
var text = Klyrics.inflate(json.content, { encoding: "base64" });
var text = Klyrics.inflate(json.hex, { encoding: "hex", format: "zlib" });
```

**站点解密：** `Klyrics.decrypt(data, type, opt)`。`encoding` 与 `inflate` 相同。

- `"krc"`：跳过 4 字节头、固定密钥 XOR、zlib。酷狗 Base64 正文用 `{ encoding: "base64" }`。
- `"qrc"`：腾讯非标准 3DES（固定密钥）+ zlib。QQ 接口的 hex 正文用 `{ encoding: "hex" }`。不要自己在脚本里重写这套算法。

解出来若是 KRC / QRC 字戳，脚本再转成 Enhanced LRC 放进 `synced`。仓库示例：`scripts/netease-yrc.js`、`scripts/kugou-krc.js`、`scripts/qq-qrc.js`（不覆盖内置网易 / 酷狗 / QQ 逐行源）。

## 6. 图片脚本：`searchArt`

图片源与歌词源放在同一目录，但 `kind` 必须是 `"art"`，并且只导出 `searchArt`（不要 `search` / `fetch`）。脚本只回 URL，二进制下载仍由 C++ 完成。

```
var klyrics_source = {
  id: "js:my-art",
  name: "我的封面站",
  kind: "art",
  version: 1
};

function searchArt(query) {
  return [{
    url: "https://example.com/cover.jpg",
    thumb_url: "",          // 可空，空则预览用 url
    kind: "album",          // album | artist
    artist: query.artist,
    album: query.album,
    title: query.title,
    headers: [              // 可空或省略：下图不附加额外头
      { name: "Referer", value: "https://example.com/" }
    ]
  }];
}
```

`headers` 只用于 C++ 下载图片（预览和采用同一套）。空数组或没有这个字段，表示不需要 Referer / Cookie 等。单项用 `{ name, value }`（`key` 也可当名字）。不要在脚本里自己拉图片二进制。

启用位置：设置 → 图片 → 把脚本从「可用」移到「使用中」。自动搜图与面板「搜索图片」都会按列表顺序调用。仓库示例：`scripts/deezerart.js`。

出厂搜索源顺序：网易云逐字 → 酷狗逐字 → QQ 逐字 → LRCLIB → 酷狗 → QQ → 网易云。已保存过源列表的用户：新脚本会出现在「可用」，自己移到「使用中」并排到内置逐行源前面。

