/**
 * Klyrics Zero Bus 客户端（无 DOM / 无 canvas）
 *
 * 经 foo_zero_bus 的本机 WebSocket 调用 plugin.klyrics。
 * 业务 JSON 与本机 9999 口相同，但必须包在 Zero Bus 信封里，且 payload 是字符串。
 * 绘制层请用 Klyrics.mount() 或自行读取本对象的状态。
 *
 *   const client = Klyrics.createClient({
 *     url: "ws://127.0.0.1:17890",
 *     onStatus: (text) => console.log(text),
 *     onChange: () => repaint(),
 *   });
 *   client.destroy();
 */
(function (root) {
  "use strict";

  const DEFAULT_URL = "ws://127.0.0.1:17890";
  const SERVICE = "plugin.klyrics";
  const MSG_REQUEST = 1;
  const MSG_RESPONSE = 2;
  const MSG_EVENT = 3;
  const MSG_ERROR = 5;
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
    this._waiters = Object.create(null);
    this._seq = 0;
    this._closed = false;

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
    this._rejectWaiters("destroyed");
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

  KlyricsClient.prototype.isOpen = function () {
    return !!(this.ws && this.ws.readyState === WebSocket.OPEN);
  };

  KlyricsClient.prototype._rejectWaiters = function (reason) {
    const ids = Object.keys(this._waiters);
    for (let i = 0; i < ids.length; i++) {
      const waiter = this._waiters[ids[i]];
      delete this._waiters[ids[i]];
      waiter.reject(new Error(reason));
    }
  };

  KlyricsClient.prototype._parsePayload = function (raw) {
    if (raw == null || raw === "") return {};
    if (typeof raw === "object") return raw;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  };

  KlyricsClient.prototype._handleEvent = function (msg) {
    const self = this;
    if (!msg || !msg.event) return false;

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
      return true;
    }
    if (msg.event === "config_changed") {
      if (msg.style) {
        self.style = mergeStyle(msg.style);
      }
      if (typeof msg.layers === "number") {
        self.layers = msg.layers | 0;
      }
      self._emitChange();
      return true;
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
        return true;
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
      return true;
    }
    return false;
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
      let envelope;
      try {
        envelope = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (!envelope || typeof envelope !== "object") return;

      const body = self._parsePayload(envelope.payload);
      const type = envelope.type | 0;

      if (type === MSG_EVENT) {
        if (body) self._handleEvent(body);
        return;
      }

      const id = envelope.correlation_id || "";
      const waiter = id ? self._waiters[id] : null;
      if (!waiter) return;
      delete self._waiters[id];

      if (type === MSG_ERROR) {
        const code = body && body.code ? String(body.code) : "ERROR";
        const message = body && body.message ? String(body.message) : "Zero Bus 错误";
        if (code === "SERVICE_NOT_FOUND") {
          waiter.reject(new Error("未找到 plugin.klyrics（确认已安装 foo_zero_bus，并启用快乐歌词的 Zero Bus 服务）"));
        } else {
          waiter.reject(new Error(code + ": " + message));
        }
        return;
      }

      if (type !== MSG_RESPONSE) return;
      if (!body) {
        waiter.reject(new Error("应答无法解析"));
        return;
      }
      if (body.ok === false) {
        waiter.reject(new Error(body.error || "命令失败"));
      } else {
        waiter.resolve(body);
      }
    };

    ws.onerror = function () {
      self._setStatus("Zero Bus 连接失败（确认 foobar2000、foo_zero_bus 已开，且快乐歌词启用了 Zero Bus 服务）");
      self._emitChange();
    };

    ws.onclose = function () {
      if (self._closed) return;
      self._rejectWaiters("连接断开");
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
    return new Promise(function (resolve, reject) {
      if (!self.isOpen()) {
        reject(new Error("未连接"));
        return;
      }
      const msgId = "klyrics_" + ++self._seq;
      const timer = setTimeout(function () {
        if (!self._waiters[msgId]) return;
        delete self._waiters[msgId];
        reject(new Error("超时: " + payload.cmd));
      }, 8000);
      self._waiters[msgId] = {
        resolve: function (msg) {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: function (err) {
          clearTimeout(timer);
          reject(err);
        },
      };
      try {
        self.ws.send(
          JSON.stringify({
            sender: "",
            receiver: SERVICE,
            type: MSG_REQUEST,
            msg_id: msgId,
            correlation_id: "",
            payload: JSON.stringify(payload),
          })
        );
      } catch (e) {
        delete self._waiters[msgId];
        clearTimeout(timer);
        reject(e);
      }
    });
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
        const jobs = [];
        for (let i = 0; i < count; i++) {
          jobs.push(
            self.request({ cmd: "get_line", index: i }).then(function (lineMsg) {
              self.lines[i] = {
                start_time: lineMsg.start_time || 0,
                duration: lineMsg.duration || 0,
                text: lineMsg.text || "",
                translation: lineMsg.translation || "",
              };
            })
          );
        }
        return Promise.all(jobs);
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
    SERVICE: SERVICE,
    MSG_REQUEST: MSG_REQUEST,
    MSG_RESPONSE: MSG_RESPONSE,
    MSG_EVENT: MSG_EVENT,
    MSG_ERROR: MSG_ERROR,
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
