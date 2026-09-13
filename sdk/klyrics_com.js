// klyrics_com.js — JScript Panel 3 / JSplitter / SMP sample.
// Paste into the panel script. Call COM methods with parentheses.
// Startup writes ok/FAIL lines to the console so host mismatches show up immediately.
// Docs: github/docs/sdk.md

function RGB(r, g, b) {
    return 0xff000000 | (r << 16) | (g << 8) | b;
}

function log(msg) {
    try {
        console.log(msg);
    } catch (ignored) {}
}

function check(name, ok, extra) {
    log((ok ? "ok  " : "FAIL") + " " + name + (extra !== undefined && extra !== "" ? " " + extra : ""));
}

function isBool(v) {
    return v === true || v === false;
}

function isNum(v) {
    return typeof v === "number" && isFinite(v);
}

function isStr(v) {
    return typeof v === "string";
}

function methodExists(engine, name) {
    try {
        var t = typeof engine[name];
        return t === "function" || t === "unknown";
    } catch (e) {
        return false;
    }
}

var g_klyrics = null;
var g_index = -1;
var g_time = 0;
var g_text = "";
var g_trans = "";
var g_count = 0;
var g_path = "";
var g_style = "";
var g_layers = 0;

function on_klyrics_loaded(count, path) {
    g_count = count;
    g_path = path || "";
    log("on_klyrics_loaded count=" + count + " path=" + g_path);
    window.Repaint();
}

function on_klyrics_updated(index, time, text, trans) {
    g_index = index;
    g_time = time;
    g_text = text || "";
    g_trans = trans || "";
    log("on_klyrics_updated index=" + index + " time=" + time + " text=" + g_text);
    window.Repaint();
}

function on_klyrics_config(styleJson, layers) {
    g_style = styleJson || "";
    g_layers = layers;
    log("on_klyrics_config layers=" + layers);
    window.Repaint();
}

function check_klyrics(engine) {
    var methods = [
        "GetLineCount",
        "GetLineTime",
        "GetLineText",
        "GetLineTranslation",
        "GetLineIndex",
        "GetLyricPath",
        "GetRawLrc",
        "SetOnLyricsUpdated",
        "SetOnLyricsLoaded",
        "SetOnConfigChanged",
        "SetAlwaysSearch",
        "SearchLyrics",
        // "ShowSearchWindow",
        // "ShowEditWindow",
        "SetLyricLayers",
        "GetLyricLayers",
        "LyricLayers",
        "SaveLyrics",
        // "ShowPreferences",
        "SetDesktopVisible",
        "SetDesktopLocked",
        "DesktopVisible",
        "SetFloatVisible",
        "SetFloatLocked",
        "FloatVisible",
        "SetTaskbarVisible",
        "SetTaskbarLocked",
        "TaskbarVisible",
        "GetPanelStyle",
        "Seek",
        "GetPlaybackPosition",
        "GetPlaybackLength"
    ];
    var i;
    for (i = 0; i < methods.length; i++) {
        check(methods[i], methodExists(engine, methods[i]));
    }

    function run(name, fn) {
        try {
            return fn();
        } catch (e) {
            check(name, false, e.message);
            return undefined;
        }
    }

    var count = run("GetLineCount()", function () {
        var n = engine.GetLineCount();
        check("GetLineCount()", isNum(n) && n >= 0, String(n));
        return n;
    });
    if (count === undefined) {
        count = 0;
    }

    run("GetLineTime", function () {
        var t = engine.GetLineTime(0);
        check("GetLineTime(0)", isNum(t) && (count > 0 ? t >= 0 : t === 0), String(t));
    });
    run("GetLineText", function () {
        var s = engine.GetLineText(0);
        check("GetLineText(0)", isStr(s), count > 0 ? s : '""');
    });
    run("GetLineTranslation", function () {
        var s = engine.GetLineTranslation(0);
        check("GetLineTranslation(0)", isStr(s));
    });
    run("GetLineIndex", function () {
        var idx = engine.GetLineIndex(0);
        check("GetLineIndex(0)", isNum(idx) && idx >= -1, String(idx));
    });
    run("GetLyricPath", function () {
        check("GetLyricPath()", isStr(engine.GetLyricPath()), engine.GetLyricPath());
    });
    run("GetRawLrc", function () {
        var lrc = engine.GetRawLrc();
        check("GetRawLrc()", isStr(lrc), "len=" + lrc.length);
    });
    run("GetPanelStyle", function () {
        var json = engine.GetPanelStyle();
        check("GetPanelStyle()", isStr(json) && json.length > 0 && json.charAt(0) === "{", "len=" + json.length);
        g_style = json;
    });

    run("GetPlaybackPosition", function () {
        var pos = engine.GetPlaybackPosition();
        check("GetPlaybackPosition()", isNum(pos) && pos >= 0, String(pos));
    });
    run("GetPlaybackLength", function () {
        var len = engine.GetPlaybackLength();
        check("GetPlaybackLength()", isNum(len) && len >= 0, String(len));
    });

    var layers = run("GetLyricLayers", function () {
        var mask = engine.GetLyricLayers();
        check("GetLyricLayers()", isNum(mask) && mask > 0, String(mask));
        return mask;
    });
    run("LyricLayers", function () {
        var alias = engine.LyricLayers();
        check("LyricLayers()", isNum(alias) && alias === layers, String(alias));
    });
    if (isNum(layers)) {
        run("SetLyricLayers", function () {
            var now = engine.SetLyricLayers(layers);
            check("SetLyricLayers(current)", now === layers, String(now));
            g_layers = now;
        });
    }

    var always = run("AlwaysSearch get", function () {
        var on = engine.AlwaysSearch;
        check("AlwaysSearch", isBool(on), String(on));
        return on;
    });
    if (isBool(always)) {
        run("SetAlwaysSearch", function () {
            var now = engine.SetAlwaysSearch(always);
            check("SetAlwaysSearch(current)", isBool(now) && now === always, String(now));
        });
        run("AlwaysSearch put", function () {
            engine.AlwaysSearch = always;
            check("AlwaysSearch =", engine.AlwaysSearch === always, String(engine.AlwaysSearch));
        });
    }

    run("DesktopVisible", function () {
        var on = engine.DesktopVisible();
        check("DesktopVisible()", isBool(on), String(on));
        if (isBool(on)) {
            var now = engine.SetDesktopVisible(on);
            check("SetDesktopVisible(current)", isBool(now), String(now));
        }
    });
    run("FloatVisible", function () {
        var on = engine.FloatVisible();
        check("FloatVisible()", isBool(on), String(on));
        if (isBool(on)) {
            var now = engine.SetFloatVisible(on);
            check("SetFloatVisible(current)", isBool(now), String(now));
        }
    });
    run("TaskbarVisible", function () {
        var on = engine.TaskbarVisible();
        check("TaskbarVisible()", isBool(on), String(on));
        if (isBool(on)) {
            var now = engine.SetTaskbarVisible(on);
            check("SetTaskbarVisible(current)", isBool(now), String(now));
        }
    });

    run("ShowPreferences bad", function () {
        check("ShowPreferences(bad)", engine.ShowPreferences("__klyrics_no_such_page__") === false);
    });
    run("Seek", function () {
        var pos = engine.GetPlaybackPosition();
        var ok = engine.Seek(pos);
        check("Seek(current)", isBool(ok), String(ok));
    });

    run("OnLyricsUpdated =", function () {
        engine.OnLyricsUpdated = on_klyrics_updated;
        check("OnLyricsUpdated =", true);
    });
    run("SetOnLyricsUpdated", function () {
        engine.SetOnLyricsUpdated(on_klyrics_updated);
        check("SetOnLyricsUpdated()", true);
    });
    run("OnLyricsLoaded =", function () {
        engine.OnLyricsLoaded = on_klyrics_loaded;
        check("OnLyricsLoaded =", true);
    });
    run("SetOnLyricsLoaded", function () {
        engine.SetOnLyricsLoaded(on_klyrics_loaded);
        check("SetOnLyricsLoaded()", true);
    });
    run("OnConfigChanged =", function () {
        engine.OnConfigChanged = on_klyrics_config;
        check("OnConfigChanged =", true);
    });
    run("SetOnConfigChanged", function () {
        engine.SetOnConfigChanged(on_klyrics_config);
        check("SetOnConfigChanged()", true);
    });
}

function bind_klyrics() {
    if (g_klyrics) {
        return true;
    }
    try {
        g_klyrics = new ActiveXObject("Klyrics.Engine");
        log("Klyrics.Engine created");
        check_klyrics(g_klyrics);
        return true;
    } catch (e) {
        log("Klyrics FAIL: " + e.message);
        g_klyrics = null;
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

var g_jsp3 = typeof gdi === "undefined" || !gdi.Font;
var g_font = g_jsp3
    ? JSON.stringify({Name: "Segoe UI", Size: 16})
    : gdi.Font("Segoe UI", 16, 0);
var g_font_hi = g_jsp3
    ? JSON.stringify({Name: "Segoe UI", Size: 22, Weight: 700})
    : gdi.Font("Segoe UI", 22, 1);

function draw_text(gr, text, font, color, x, y, w, h) {
    if (g_jsp3) {
        gr.WriteText(text, font, color, x, y, w, h);
        return;
    }
    gr.GdiDrawText(text, font, color, x, y, w, h, 0);
}

function on_paint(gr) {
    var w = window.Width;
    var h = window.Height;
    if (g_jsp3) {
        gr.Clear(RGB(20, 20, 26));
    } else {
        gr.FillSolidRect(0, 0, w, h, RGB(20, 20, 26));
    }

    if (!g_klyrics) {
        draw_text(gr, "Klyrics.Engine 未就绪", g_font, RGB(160, 160, 160), 10, 10, w - 20, 24);
        return;
    }
    if (g_index < 0 || !g_text) {
        draw_text(gr, "等待切行推送…  count=" + g_count, g_font, RGB(160, 160, 160), 10, 10, w - 20, 24);
        if (g_path) {
            draw_text(gr, g_path, g_font, RGB(120, 120, 130), 10, 38, w - 20, 24);
        }
        return;
    }
    draw_text(gr, g_text, g_font_hi, RGB(255, 220, 80), 10, 12, w - 20, 28);
    if (g_trans) {
        draw_text(gr, g_trans, g_font, RGB(180, 180, 190), 10, 44, w - 20, 24);
    }
}
