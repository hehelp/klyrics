#pragma once

// Klyrics 对外 SDK。第三方组件只需包含本头文件。
// 使用前请先包含 foobar2000 SDK（#include <foobar2000.h>）。
// 自 2.0.0.9 起提供。说明见仓库 docs/sdk.md / docs/sdk.en.md。

// ============================================================================
// 1. 结构化歌词数据包 (ABI 极致安全设计)
// ============================================================================
#pragma pack(push, 8)
struct klyrics_line_t {
    double start_time; // 行起始时间 (单位：秒，双精度)
    double duration; // 行持续时间 (单位：秒，为逐字歌词预留，未知则为 0)
    const char* text; // 歌词原文 (UTF-8，外部绝对禁止 delete/free)
    const char* translation; // 翻译文本 (UTF-8，无翻译时返回 nullptr 或 "")
};
#pragma pack(pop)

class NOVTABLE klyrics_result {
public:
    virtual size_t get_line_count() const = 0;

    // 一次性获取指定行的所有安全数据
    virtual bool get_line(size_t index, klyrics_line_t& out_line) const = 0;

    // 获取原始 LRC 完整文本 (给需要自己解析的降级方案)
    virtual const char* get_raw_lrc() const = 0;

    // 播放进度（秒）对应的行号：最后一行 start_time <= time_sec。
    // 无歌词返回 0；早于首行返回 get_line_count()（不是有效下标）。
    virtual size_t get_line_index(double time_sec) const = 0;

    // 当前歌词文件的 UTF-8 路径。内嵌歌词、标签歌词或未保存到文件时为空字符串。
    virtual const char* get_source_path() const = 0;
};

// ============================================================================
// 2. PUSH 模式：加载成功 + 切行推送当前行
// ============================================================================
// {7B14D9E2-5C38-4A61-9F20-8E4D6A1C0B75}
static const GUID guid_klyrics_callback =
    {0x7b14d9e2, 0x5c38, 0x4a61, {0x9f, 0x20, 0x8e, 0x4d, 0x6a, 0x1c, 0x0b, 0x75}};

class NOVTABLE klyrics_callback : public service_base {
    FB2K_MAKE_SERVICE_INTERFACE_ENTRYPOINT(klyrics_callback);

public:
    // 播放切到新行时调用。line_index 无效（无歌词 / 早于首行）时等于 get_line_count()。
    virtual void on_lyrics_updated(
        metadb_handle_ptr p_track,
        const klyrics_result* p_result,
        size_t line_index
    ) = 0;

    // 歌词加载成功时调用。file_path 为 UTF-8 本地路径；内嵌 / 未落盘时为 ""。
    virtual void on_lyrics_loaded(
        metadb_handle_ptr p_track,
        size_t line_count,
        const char* file_path
    ) = 0;
};

// ============================================================================
// 3. PULL 模式：主动查询当前歌词
// ============================================================================
// {3E8A6C41-9B17-4F2D-A8E5-1C70D4B9E263}
static const GUID guid_klyrics_api =
    {0x3e8a6c41, 0x9b17, 0x4f2d, {0xa8, 0xe5, 0x1c, 0x70, 0xd4, 0xb9, 0xe2, 0x63}};

class NOVTABLE klyrics_api : public service_base {
    FB2K_MAKE_SERVICE_INTERFACE_ENTRYPOINT(klyrics_api);

public:
    // p_track 为空则查当前曲；指针由 Klyrics 托管，禁止 delete，歌词更新后失效。
    virtual bool query_lyrics(metadb_handle_ptr p_track, klyrics_result*& out_result) = 0;
};

// COM / ActiveX：ProgID = Klyrics.Engine
// {A91C4E70-2D58-4B13-8E6A-5F30C7D1B849}
static const GUID guid_klyrics_engine =
    {0xa91c4e70, 0x2d58, 0x4b13, {0x8e, 0x6a, 0x5f, 0x30, 0xc7, 0xd1, 0xb8, 0x49}};

#if defined(_MSC_VER)
#define KLYRICS_GUID_DEF __declspec(selectany)
#elif defined(__GNUC__)
#define KLYRICS_GUID_DEF __attribute__((weak))
#else
#define KLYRICS_GUID_DEF
#endif

KLYRICS_GUID_DEF const GUID klyrics_api::class_guid = guid_klyrics_api;
KLYRICS_GUID_DEF const GUID klyrics_callback::class_guid = guid_klyrics_callback;
