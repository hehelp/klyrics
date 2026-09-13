/**
 * Klyrics WebSocket 客户端（无 DOM / 无 canvas）
 *
 * 负责连接 foobar2000 本机接口、维护歌词/样式/图层/滚动/播放状态。
 * 绘制层请用 Klyrics.mount() 或自行读取本对象的状态。
 *
 *   const client = Klyrics.createClient({
 *     url: "ws://127.0.0.1:9999",
 *     onStatus: (text) => console.log(text),
 *     onChange: () => repaint(),
 *   });
 *   client.destroy();
 */
(function (root) {
  "use strict";

  const DEFAULT_URL = "ws://127.0.0.1:9999";
  const LINE_CHANGE_MS = 380;
  const CURRENT_SCALE_MS = 260;
  const SEEK_DRAG_SLOP = 6;
  const LAYER_RUBY = 1;
  const LAYER_ORIG = 2;
  const LAYER_TRANS = 4;
  const LAYER_ROMAJI = 8;
  const LAYER_TEXT = LAYER_ORIG | LAYER_TRANS | LAYER_ROMAJI;

  const DEFAULT_STYLE = {
    font_family: "Microsoft YaHei UI, PingFang SC, sans-serif",
    font_weight: 600,
    font_size: 14,
    italic: false,
    text: "#CCCCCC",
    highlight: "#FFDC50",
    passed: "#888888",
    bg: "#1A1A22",
    bg_mode: "color",
    scroll_mode: "line",
    current_scale: 120,
    line_spacing: 4,
    wrap: true,
    fade: false,
    fade_lines: 2,
    karaoke: true,
  };

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function mergeStyle(raw) {
    const s = Object.assign({}, DEFAULT_STYLE, raw || {});
    if (s.stroke && typeof s.stroke === "object") {
      s.stroke_enabled = !!s.stroke.enabled;
      s.stroke_color = s.stroke.color || "#000000";
      s.stroke_width = s.stroke.width || 1;
    }
    return s;
  }

  function easeSmoothstep(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function formatClock(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const total = Math.floor(sec + 1e-4);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function toggleLayer(layers, bit) {
    const next = (layers ^ bit) & 0xf;
    if ((next & LAYER_TEXT) === 0) return layers;
    return next || LAYER_ORIG;
  }

  function KlyricsClient(options) {
    options = options || {};
    this.url = options.url || DEFAULT_URL;
    this.onStatus = typeof options.onStatus === "function" ? options.onStatus : function () {};
    this.onChange = typeof options.onChange === "function" ? options.onChange : function () {};

    this.style = mergeStyle(null);
    this.lines = [];
    this.index = -1;
    this.layers = 0xf;
    this.desktopOn = false;
    this.floatOn = false;
    this.taskbarOn = false;
    this.desktopLocked = false;
    this.floatLocked = false;
    this.taskbarLocked = false;
    this.scrollIndex = 0;
    this.scrollFrom = 0;
    this.scrollTo = 0;
    this.scrollAnim = false;
    this.scrollStartMs = 0;
    this.xfadeCur = -1;
    this.xfadeFrom = -1;
    this.xfadeStartMs = 0;
    this.xfadeAnim = false;
    this.playAnchorWall = 0;
    this.playAnchorSec = 0;
    this.ws = null;
    this._waiters = [];
    this._closed = false;
    this._busy = Promise.resolve();

    this._dragging = false;
    this._dragMoved = false;
    this._dragStartY = 0;
    this._dragLastY = 0;
    this._dragStartScrollY = 0;
    this._dragStartScroll = 0;
    this._dragStartIndex = -1;
    this._dragStartPlayhead = 0;
    this._dragScroll = 0;
    this._dragPreviewPos = 0;
    this._dragLength = 0;

    this._connect();
  }

  KlyricsClient.prototype.destroy = function () {
    this._closed = true;
    this.stopScrollAnim();
    this.cancelDrag(false);
    while (this._waiters.length) {
      this._waiters.shift().reject(new Error("destroyed"));
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
  };

  KlyricsClient.prototype._emitChange = function () {
    this.onChange();
  };

  KlyricsClient.prototype._setStatus = function (text) {
    this.onStatus(text);
  };

  KlyricsClient.prototype._connect = function () {
    const self = this;
    this._setStatus("连接 " + this.url + " …");
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this._setStatus("无法创建: " + e.message);
      this._emitChange();
      return;
    }
    this.ws = ws;

    ws.onopen = function () {
      self._setStatus("已连接，拉取面板样式与歌词…");
      self
        .request({ cmd: "get_panel_style" })
        .then(function (msg) {
          if (msg && msg.style) {
            self.style = mergeStyle(msg.style);
          }
          return self.refreshUiState();
        })
        .then(function () {
          return self.reloadLyrics();
        })
        .then(function () {
          self._setStatus("就绪（拖拽调进度；右键打开菜单）");
          self._emitChange();
        })
        .catch(function (err) {
          self._setStatus(String(err && err.message ? err.message : err));
          self._emitChange();
        });
    };

    ws.onmessage = function (ev) {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }

      if (msg.event === "lyrics_loaded") {
        self.cancelDrag(false);
        self.reloadLyrics().then(function () {
          if (self.index < 0) {
            self.setScrollTarget(0, true);
            self.setScaleTarget(0, true);
          } else {
            self.setScrollTarget(self.index, true);
            self.setScaleTarget(self.index, true);
          }
          self._emitChange();
        });
        return;
      }
      if (msg.event === "config_changed") {
        if (msg.style) {
          self.style = mergeStyle(msg.style);
        }
        if (typeof msg.layers === "number") {
          self.layers = msg.layers | 0;
        }
        self._emitChange();
        return;
      }
      if (msg.event === "lyrics_updated") {
        if (self._dragMoved) {
          const idx = typeof msg.index === "number" ? msg.index : -1;
          if (idx >= 0 && idx < self.lines.length) {
            const line = self.lines[idx];
            if (msg.text != null) line.text = msg.text;
            if (msg.trans != null) line.translation = msg.trans;
            if (msg.time != null) line.start_time = msg.time;
          }
          return;
        }
        const prev = self.index;
        self.index = typeof msg.index === "number" ? msg.index : -1;
        if (self.index >= 0 && self.index < self.lines.length) {
          const line = self.lines[self.index];
          if (msg.text != null) line.text = msg.text;
          if (msg.trans != null) line.translation = msg.trans;
          if (msg.time != null) line.start_time = msg.time;
          self.syncPlayhead(typeof msg.time === "number" ? msg.time : line.start_time || 0);
        }
        const target = self.index >= 0 && self.index < self.lines.length ? self.index : 0;
        const snap = prev < 0 && self.index < 0;
        self.setScrollTarget(target, snap);
        self.setScaleTarget(target, snap);
        self._emitChange();
        return;
      }

      if (self._waiters.length) {
        const waiter = self._waiters.shift();
        if (msg.ok === false) {
          waiter.reject(new Error(msg.error || "命令失败"));
        } else {
          waiter.resolve(msg);
        }
      }
    };

    ws.onerror = function () {
      self._setStatus("WebSocket 错误（确认 foobar2000 已开，且「更新」页启用了本机接口）");
      self._emitChange();
    };

    ws.onclose = function () {
      if (self._closed) return;
      while (self._waiters.length) {
        self._waiters.shift().reject(new Error("连接断开"));
      }
      self._setStatus("已断开，3 秒后重连…");
      self.ws = null;
      self._emitChange();
      setTimeout(function () {
        if (!self._closed) self._connect();
      }, 3000);
    };
  };

  KlyricsClient.prototype.request = function (payload) {
    const self = this;
    this._busy = this._busy
      .catch(function () {})
      .then(function () {
        return new Promise(function (resolve, reject) {
          if (!self.ws || self.ws.readyState !== WebSocket.OPEN) {
            reject(new Error("未连接"));
            return;
          }
          const timer = setTimeout(function () {
            const idx = self._waiters.indexOf(entry);
            if (idx >= 0) self._waiters.splice(idx, 1);
            reject(new Error("超时: " + payload.cmd));
          }, 8000);
          const entry = {
            resolve: function (msg) {
              clearTimeout(timer);
              resolve(msg);
            },
            reject: function (err) {
              clearTimeout(timer);
              reject(err);
            },
          };
          self._waiters.push(entry);
          try {
            self.ws.send(JSON.stringify(payload));
          } catch (e) {
            const idx = self._waiters.indexOf(entry);
            if (idx >= 0) self._waiters.splice(idx, 1);
            clearTimeout(timer);
            reject(e);
          }
        });
      });
    return this._busy;
  };

  KlyricsClient.prototype.refreshUiState = function () {
    const self = this;
    return this.request({ cmd: "lyric_layers" })
      .then(function (msg) {
        self.layers = msg.layers | 0;
        return self.request({ cmd: "desktop_visible" });
      })
      .then(function (msg) {
        self.desktopOn = !!msg.on;
        return self.request({ cmd: "float_visible" });
      })
      .then(function (msg) {
        self.floatOn = !!msg.on;
        return self.request({ cmd: "taskbar_visible" });
      })
      .then(function (msg) {
        self.taskbarOn = !!msg.on;
      });
  };

  KlyricsClient.prototype.reloadLyrics = function () {
    const self = this;
    return this.request({ cmd: "get_line_count" })
      .then(function (msg) {
        const count = msg.count | 0;
        self.lines = new Array(count);
        let chain = Promise.resolve();
        for (let i = 0; i < count; i++) {
          (function (index) {
            chain = chain.then(function () {
              return self.request({ cmd: "get_line", index: index }).then(function (lineMsg) {
                self.lines[index] = {
                  start_time: lineMsg.start_time || 0,
                  duration: lineMsg.duration || 0,
                  text: lineMsg.text || "",
                  translation: lineMsg.translation || "",
                };
              });
            });
          })(i);
        }
        return chain;
      })
      .then(function () {
        if (self.index >= self.lines.length) self.index = -1;
        if (self.index < 0) {
          self.setScrollTarget(0, true);
          self.setScaleTarget(0, true);
        } else {
          self.setScrollTarget(self.index, true);
          self.setScaleTarget(self.index, true);
        }
      });
  };

  KlyricsClient.prototype.stopScrollAnim = function () {
    this.scrollAnim = false;
  };

  KlyricsClient.prototype.syncPlayhead = function (songSec) {
    this.playAnchorWall = performance.now();
    this.playAnchorSec = typeof songSec === "number" ? songSec : 0;
  };

  KlyricsClient.prototype.playheadSec = function () {
    if (this._dragMoved) return this._dragPreviewPos;
    if (!this.playAnchorWall) return 0;
    return this.playAnchorSec + (performance.now() - this.playAnchorWall) / 1000;
  };

  KlyricsClient.prototype.karaokeProgress = function (index) {
    if (index < 0 || index >= this.lines.length) return 0;
    const line = this.lines[index];
    const start = line.start_time || 0;
    let end = start;
    if (line.duration > 0) {
      end = start + line.duration;
    } else if (index + 1 < this.lines.length) {
      end = this.lines[index + 1].start_time || start;
    }
    if (end <= start) {
      end = start + 5;
    }
    const t = this.playheadSec();
    return clamp((t - start) / (end - start), 0, 1);
  };

  KlyricsClient.prototype.karaokeEnabled = function () {
    return !!this.style.karaoke && this.index >= 0 && this.index < this.lines.length;
  };

  KlyricsClient.prototype.xfadeMs = function () {
    return (this.style.scroll_mode || "line") === "line" ? LINE_CHANGE_MS : CURRENT_SCALE_MS;
  };

  KlyricsClient.prototype.setScaleTarget = function (target, snap) {
    if (!this.lines.length) {
      this.xfadeCur = -1;
      this.xfadeFrom = -1;
      this.xfadeAnim = false;
      return;
    }
    target = clamp(target, 0, this.lines.length - 1);
    if (snap || this.xfadeCur < 0) {
      this.xfadeCur = target;
      this.xfadeFrom = -1;
      this.xfadeAnim = false;
      return;
    }
    if (target === this.xfadeCur) return;
    if (Math.abs(target - this.xfadeCur) > 1) {
      this.xfadeCur = target;
      this.xfadeFrom = -1;
      this.xfadeAnim = false;
      return;
    }
    this.xfadeFrom = this.xfadeCur;
    this.xfadeCur = target;
    this.xfadeStartMs = performance.now();
    this.xfadeAnim = true;
  };

  KlyricsClient.prototype.scaleT = function (lineIndex) {
    if (!this.xfadeAnim) {
      return lineIndex === this.xfadeCur ? 1 : 0;
    }
    const raw = clamp((performance.now() - this.xfadeStartMs) / this.xfadeMs(), 0, 1);
    const e = easeSmoothstep(raw);
    if (raw >= 1) {
      this.xfadeAnim = false;
      this.xfadeFrom = -1;
      return lineIndex === this.xfadeCur ? 1 : 0;
    }
    if (lineIndex === this.xfadeCur) return e;
    if (lineIndex === this.xfadeFrom) return 1 - e;
    return 0;
  };

  KlyricsClient.prototype.targetScale = function () {
    return clamp((this.style.current_scale || 100) / 100, 1, 2);
  };

  KlyricsClient.prototype.drawScale = function (lineIndex) {
    const t = this.scaleT(lineIndex);
    const target = this.targetScale();
    return 1 + (target - 1) * t;
  };

  KlyricsClient.prototype.tick = function () {
    let changed = false;
    if (this.scrollAnim) {
      const raw = (performance.now() - this.scrollStartMs) / LINE_CHANGE_MS;
      if (raw >= 1) {
        this.scrollIndex = this.scrollTo;
        this.scrollAnim = false;
      } else {
        const t = easeSmoothstep(raw);
        this.scrollIndex = this.scrollFrom + (this.scrollTo - this.scrollFrom) * t;
      }
      changed = true;
    }
    if (this.xfadeAnim) {
      const raw = (performance.now() - this.xfadeStartMs) / this.xfadeMs();
      if (raw >= 1) {
        this.xfadeAnim = false;
        this.xfadeFrom = -1;
      }
      changed = true;
    }
    return changed;
  };

  KlyricsClient.prototype.needsAnimation = function () {
    return this.scrollAnim || this.xfadeAnim || this.karaokeEnabled();
  };

  KlyricsClient.prototype.setScrollTarget = function (target, snap) {
    if (!this.lines.length) {
      this.scrollIndex = 0;
      this.stopScrollAnim();
      return;
    }
    target = clamp(target, 0, this.lines.length - 1);
    if (snap) {
      this.scrollIndex = target;
      this.scrollFrom = target;
      this.scrollTo = target;
      this.stopScrollAnim();
      return;
    }
    if (Math.abs(target - this.scrollTo) < 0.01) {
      if (!this.scrollAnim) {
        this.scrollIndex = target;
        this.scrollTo = target;
      }
      return;
    }
    this.scrollFrom = this.scrollIndex;
    this.scrollTo = target;
    this.scrollStartMs = performance.now();
    this.scrollAnim = true;
  };

  KlyricsClient.prototype.layout = function () {
    const style = this.style;
    const fontSize = Math.max(8, Math.round(style.font_size || 14));
    const spacing = style.line_spacing | 0;
    const showOrig = (this.layers & LAYER_ORIG) !== 0;
    const showTrans = (this.layers & LAYER_TRANS) !== 0;
    const cur = this.index >= 0 && this.index < this.lines.length ? this.index : -1;
    const rows = [];
    let y = 0;
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i] || { text: "", translation: "" };
      const isCur = i === cur;
      const text = showOrig ? line.text || "" : "";
      const trans = showTrans ? line.translation || "" : "";
      const textH = text ? fontSize : 0;
      const transH = trans ? Math.round(fontSize * 0.85) : 0;
      let blockH;
      if (!text && !trans) {
        blockH = Math.max(spacing, fontSize);
      } else {
        blockH = textH + (transH ? (textH ? 4 : 0) + transH : 0) + spacing;
      }
      rows.push({
        index: i,
        y: y,
        h: blockH,
        center: y + blockH * 0.5,
        textH: textH,
        transH: transH,
        fontSize: fontSize,
        text: text,
        trans: trans,
        isCur: isCur,
        isPassed: cur >= 0 && i < cur,
      });
      y += blockH;
    }
    return { rows: rows, totalH: y };
  };

  KlyricsClient.prototype.scrollCenterY = function (layout, scroll) {
    if (!layout.rows.length) return 0;
    scroll = clamp(scroll, 0, layout.rows.length - 1);
    const i = Math.floor(scroll);
    const frac = scroll - i;
    const a = layout.rows[i].center;
    if (i + 1 >= layout.rows.length || frac <= 0) return a;
    return a + (layout.rows[i + 1].center - a) * frac;
  };

  KlyricsClient.prototype.scrollFromCenterY = function (layout, y) {
    if (!layout.rows.length) return 0;
    if (y <= layout.rows[0].center) return 0;
    const last = layout.rows.length - 1;
    if (y >= layout.rows[last].center) return last;
    let lo = 0;
    let hi = last;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (layout.rows[mid].center <= y) lo = mid;
      else hi = mid;
    }
    const span = layout.rows[hi].center - layout.rows[lo].center;
    if (span <= 0.01) return lo;
    return lo + clamp((y - layout.rows[lo].center) / span, 0, 1);
  };

  KlyricsClient.prototype.timeAtScroll = function (scroll) {
    if (!this.lines.length) return 0;
    scroll = clamp(scroll, 0, this.lines.length - 1);
    const i = Math.floor(scroll);
    const frac = scroll - i;
    const start = this.lines[i].start_time || 0;
    if (i + 1 >= this.lines.length || frac <= 0) return start;
    return start + frac * ((this.lines[i + 1].start_time || 0) - start);
  };

  KlyricsClient.prototype.lineIndexAt = function (time) {
    if (!this.lines.length) return -1;
    if ((this.lines[0].start_time || 0) > time) return -1;
    let idx = 0;
    for (let i = 0; i < this.lines.length; i++) {
      if ((this.lines[i].start_time || 0) <= time) idx = i;
      else break;
    }
    return idx;
  };

  KlyricsClient.prototype.lineIndexFromScroll = function (scroll) {
    if (!this.lines.length) return -1;
    return Math.floor(clamp(scroll, 0, this.lines.length - 1));
  };

  KlyricsClient.prototype.clampPreview = function (seconds, length) {
    let t = Math.max(0, seconds);
    if (length > 0) t = Math.min(t, length);
    return t;
  };

  KlyricsClient.prototype.isDragging = function () {
    return this._dragging;
  };

  KlyricsClient.prototype.isDragMoved = function () {
    return this._dragMoved;
  };

  KlyricsClient.prototype.dragPreviewPos = function () {
    return this._dragPreviewPos;
  };

  KlyricsClient.prototype.beginDrag = function (clientY) {
    if (this._dragging) this.cancelDrag(false);
    if (!this.lines.length) return Promise.resolve();
    this._dragging = true;
    this._dragMoved = false;
    this._dragStartY = clientY;
    this._dragLastY = clientY;
    this._dragStartIndex = this.index;
    this._dragStartScroll = this.scrollIndex;
    this._dragStartPlayhead = this.playheadSec();
    this._dragPreviewPos = this._dragStartPlayhead;
    this._dragLength = 0;
    this._dragStartScrollY = this.scrollCenterY(this.layout(), this.scrollIndex);
    const self = this;
    return this.request({ cmd: "playback_length" })
      .then(function (msg) {
        if (typeof msg.length === "number") self._dragLength = msg.length;
        if (self._dragMoved) self.updateDrag(self._dragLastY);
      })
      .catch(function () {});
  };

  KlyricsClient.prototype.updateDrag = function (clientY) {
    if (!this._dragging) return false;
    this._dragLastY = clientY;
    if (!this._dragMoved) {
      if (Math.abs(clientY - this._dragStartY) < SEEK_DRAG_SLOP) return false;
      this._dragMoved = true;
      this.stopScrollAnim();
    }
    const layout = this.layout();
    this._dragScroll = this.scrollFromCenterY(
      layout,
      this._dragStartScrollY + (this._dragStartY - clientY)
    );
    this._dragPreviewPos = this.clampPreview(this.timeAtScroll(this._dragScroll), this._dragLength);
    const idx = this.lineIndexFromScroll(this._dragScroll);
    this.scrollIndex = idx >= 0 ? idx : 0;
    this.scrollFrom = this.scrollIndex;
    this.scrollTo = this.scrollIndex;
    this.index = idx;
    this.setScaleTarget(idx >= 0 ? idx : 0, true);
    this._setStatus("预览 " + formatClock(this._dragPreviewPos));
    this._emitChange();
    return true;
  };

  KlyricsClient.prototype._restoreDragStart = function () {
    this.index = this._dragStartIndex;
    this.scrollIndex = this._dragStartScroll;
    this.scrollFrom = this._dragStartScroll;
    this.scrollTo = this._dragStartScroll;
    this.syncPlayhead(this._dragStartPlayhead);
    this.setScaleTarget(this.index >= 0 ? this.index : 0, true);
    this._emitChange();
  };

  KlyricsClient.prototype._commitSeek = function () {
    const self = this;
    const time = this._dragPreviewPos;
    return this.request({ cmd: "seek", time: time })
      .then(function () {
        self.syncPlayhead(time);
        const idx = self.lineIndexAt(time);
        self.index = idx;
        self.setScrollTarget(idx >= 0 ? idx : 0, true);
        self.setScaleTarget(idx >= 0 ? idx : 0, true);
        self._setStatus("已跳到 " + formatClock(time));
        self._emitChange();
      })
      .catch(function (err) {
        self._restoreDragStart();
        self._setStatus(String(err && err.message ? err.message : err));
        throw err;
      });
  };

  KlyricsClient.prototype.cancelDrag = function (commit) {
    if (!this._dragging && !this._dragMoved) {
      return Promise.resolve();
    }
    const moved = this._dragMoved;
    this._dragging = false;
    this._dragMoved = false;
    if (commit && moved) {
      return this._commitSeek();
    }
    if (moved) {
      this._restoreDragStart();
    }
    return Promise.resolve();
  };

  function createClient(options) {
    return new KlyricsClient(options);
  }

  const api = {
    Client: KlyricsClient,
    createClient: createClient,
    DEFAULT_URL: DEFAULT_URL,
    LAYER_RUBY: LAYER_RUBY,
    LAYER_ORIG: LAYER_ORIG,
    LAYER_TRANS: LAYER_TRANS,
    LAYER_ROMAJI: LAYER_ROMAJI,
    toggleLayer: toggleLayer,
    formatClock: formatClock,
    mergeStyle: mergeStyle,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.Klyrics = Object.assign(root.Klyrics || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
