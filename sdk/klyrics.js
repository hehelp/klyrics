/**
 * Klyrics WebSocket 歌词画布 Demo
 *
 * 接口层：Klyrics.createClient()（见 klyrics_client.js，无绘制）
 * 本文件：canvas 绘制、拖拽 seek、右键菜单。
 *
 * 用法：
 *   const panel = Klyrics.mount(canvas, {
 *     width: 420,
 *     height: 560,
 *     url: "ws://127.0.0.1:9999",
 *     onStatus: (text) => { ... },
 *   });
 *   panel.destroy();
 */
(function (root) {
  "use strict";

  const ClientApi = root.Klyrics || {};
  const createClient = ClientApi.createClient;
  const DEFAULT_URL = ClientApi.DEFAULT_URL || "ws://127.0.0.1:9999";
  const toggleLayer = ClientApi.toggleLayer;
  const formatClock = ClientApi.formatClock;
  const LAYER_RUBY = ClientApi.LAYER_RUBY || 1;
  const LAYER_ORIG = ClientApi.LAYER_ORIG || 2;
  const LAYER_TRANS = ClientApi.LAYER_TRANS || 4;
  const LAYER_ROMAJI = ClientApi.LAYER_ROMAJI || 8;

  if (typeof createClient !== "function") {
    throw new Error("Klyrics.mount: load klyrics_client.js before klyrics.js");
  }

  const MENU_CSS = [
    ".klyrics-ctx{position:fixed;z-index:99999;min-width:200px;padding:4px 0;",
    "background:#1e222b;border:1px solid #3a4050;border-radius:8px;",
    "box-shadow:0 12px 28px rgba(0,0,0,.45);color:#e8e8ec;",
    "font:13px/1.35 \"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei UI\",sans-serif;",
    "user-select:none}",
    ".klyrics-ctx button{display:flex;align-items:center;gap:8px;width:100%;",
    "margin:0;padding:7px 14px 7px 12px;border:0;background:transparent;",
    "color:inherit;font:inherit;text-align:left;cursor:pointer}",
    ".klyrics-ctx button:hover,.klyrics-ctx .open>button{background:#2b3344}",
    ".klyrics-ctx button:disabled{opacity:.4;cursor:default}",
    ".klyrics-ctx button:disabled:hover{background:transparent}",
    ".klyrics-ctx .check{width:1em;flex:none;color:#6cb6ff}",
    ".klyrics-ctx .label{flex:1}",
    ".klyrics-ctx .arrow{opacity:.55;font-size:11px}",
    ".klyrics-ctx .sep{height:1px;margin:4px 8px;background:#343a48}",
    ".klyrics-ctx .sub{position:absolute;left:100%;top:-4px;margin-left:2px;",
    "display:none;min-width:140px;padding:4px 0;background:#1e222b;",
    "border:1px solid #3a4050;border-radius:8px;box-shadow:0 12px 28px rgba(0,0,0,.45)}",
    ".klyrics-ctx .has-sub{position:relative}",
    ".klyrics-ctx .has-sub.open>.sub,.klyrics-ctx .has-sub:hover>.sub{display:block}",
  ].join("");

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function fontCss(style, scale) {
    const size = Math.max(8, Math.round(style.font_size * (scale || 1)));
    const italic = style.italic ? "italic " : "";
    const weight = style.font_weight || 600;
    const family = style.font_family || "sans-serif";
    return italic + weight + " " + size + 'px "' + family + '", sans-serif';
  }

  function ensureMenuCss() {
    if (document.getElementById("klyrics-ctx-css")) return;
    const style = document.createElement("style");
    style.id = "klyrics-ctx-css";
    style.textContent = MENU_CSS;
    document.head.appendChild(style);
  }

  function KlyricsPanel(canvas, options) {
    options = options || {};
    this.canvas = typeof canvas === "string" ? document.querySelector(canvas) : canvas;
    if (!this.canvas || !this.canvas.getContext) {
      throw new Error("Klyrics.mount: need a <canvas>");
    }

    this.width = Math.max(1, (options.width | 0) || this.canvas.width || 420);
    this.height = Math.max(1, (options.height | 0) || this.canvas.height || 560);
    this.onStatus = typeof options.onStatus === "function" ? options.onStatus : function () {};

    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext("2d");
    this.paintLoop = 0;
    this._closed = false;
    this._menuEl = null;
    this._dragPointerId = null;

    const self = this;
    this.client = createClient({
      url: options.url || DEFAULT_URL,
      onStatus: function (text) {
        self.onStatus(text);
      },
      onChange: function () {
        self._paint();
        self._ensurePaintLoop();
      },
    });

    this._onCtx = this._onContextMenu.bind(this);
    this._onDocDown = this._hideMenu.bind(this);
    this._onPtrDown = this._onPointerDown.bind(this);
    this._onPtrMove = this._onPointerMove.bind(this);
    this._onPtrUp = this._onPointerUp.bind(this);

    this.canvas.style.touchAction = "none";
    this.canvas.style.cursor = "grab";
    this.canvas.style.userSelect = "none";
    this.canvas.addEventListener("contextmenu", this._onCtx);
    this.canvas.addEventListener("pointerdown", this._onPtrDown);
  }

  KlyricsPanel.prototype.destroy = function () {
    this._closed = true;
    this._stopPaintLoop();
    this._cancelDrag(false);
    this._hideMenu();
    this.canvas.removeEventListener("contextmenu", this._onCtx);
    this.canvas.removeEventListener("pointerdown", this._onPtrDown);
    document.removeEventListener("mousedown", this._onDocDown, true);
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  };

  KlyricsPanel.prototype._stopPaintLoop = function () {
    if (this.paintLoop) {
      cancelAnimationFrame(this.paintLoop);
      this.paintLoop = 0;
    }
  };

  KlyricsPanel.prototype._ensurePaintLoop = function () {
    const client = this.client;
    if (this._closed || this.paintLoop || !client) return;
    if (!client.needsAnimation()) return;
    const self = this;
    const tick = function () {
      self.paintLoop = 0;
      if (self._closed || !self.client) return;
      self.client.tick();
      self._paint();
      if (self.client.needsAnimation()) {
        self.paintLoop = requestAnimationFrame(tick);
      }
    };
    this.paintLoop = requestAnimationFrame(tick);
  };

  KlyricsPanel.prototype._canvasY = function (ev) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleY = this.height / (rect.height || this.height);
    return (ev.clientY - rect.top) * scaleY;
  };

  KlyricsPanel.prototype._unbindDragMove = function () {
    this.canvas.removeEventListener("pointermove", this._onPtrMove);
    this.canvas.removeEventListener("pointerup", this._onPtrUp);
    this.canvas.removeEventListener("pointercancel", this._onPtrUp);
    if (this._dragPointerId != null) {
      try {
        this.canvas.releasePointerCapture(this._dragPointerId);
      } catch (e) {}
      this._dragPointerId = null;
    }
  };

  KlyricsPanel.prototype._cancelDrag = function (commit) {
    const client = this.client;
    if (!client) return;
    const dragging = client.isDragging() || client.isDragMoved();
    if (!dragging) {
      this._unbindDragMove();
      return;
    }
    this.canvas.style.cursor = "grab";
    this._unbindDragMove();
    client.cancelDrag(commit);
  };

  KlyricsPanel.prototype._onPointerDown = function (ev) {
    const client = this.client;
    if (ev.button !== 0 || this._closed || !client) return;
    this._hideMenu();
    if (!client.lines.length) return;
    if (client.isDragging()) this._cancelDrag(false);
    ev.preventDefault();
    this._dragPointerId = ev.pointerId;
    try {
      this.canvas.setPointerCapture(ev.pointerId);
    } catch (e) {}
    this.canvas.addEventListener("pointermove", this._onPtrMove);
    this.canvas.addEventListener("pointerup", this._onPtrUp);
    this.canvas.addEventListener("pointercancel", this._onPtrUp);
    client.beginDrag(this._canvasY(ev));
  };

  KlyricsPanel.prototype._onPointerMove = function (ev) {
    const client = this.client;
    if (!client || !client.isDragging()) return;
    if (this._dragPointerId != null && ev.pointerId !== this._dragPointerId) return;
    ev.preventDefault();
    if (client.updateDrag(this._canvasY(ev))) {
      this.canvas.style.cursor = "grabbing";
    }
  };

  KlyricsPanel.prototype._onPointerUp = function (ev) {
    if (this._dragPointerId != null && ev.pointerId !== this._dragPointerId) return;
    this._cancelDrag(ev.type === "pointerup");
  };

  KlyricsPanel.prototype._onContextMenu = function (ev) {
    ev.preventDefault();
    const client = this.client;
    const self = this;
    if (!client || !client.ws || client.ws.readyState !== WebSocket.OPEN) {
      this.onStatus("未连接，无法打开菜单");
      return;
    }
    client
      .refreshUiState()
      .then(function () {
        self._showMenu(ev.clientX, ev.clientY);
      })
      .catch(function (err) {
        self.onStatus(String(err && err.message ? err.message : err));
      });
  };

  KlyricsPanel.prototype._hideMenu = function (ev) {
    if (ev && this._menuEl && this._menuEl.contains(ev.target)) {
      return;
    }
    if (this._menuEl) {
      this._menuEl.remove();
      this._menuEl = null;
    }
    document.removeEventListener("mousedown", this._onDocDown, true);
  };

  KlyricsPanel.prototype._showMenu = function (x, y) {
    const self = this;
    const client = this.client;
    if (!client) return;
    ensureMenuCss();
    this._hideMenu();

    const rootEl = document.createElement("div");
    rootEl.className = "klyrics-ctx";
    rootEl.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });

    function addSep() {
      const sep = document.createElement("div");
      sep.className = "sep";
      rootEl.appendChild(sep);
    }

    function addItem(label, opts) {
      opts = opts || {};
      const btn = document.createElement("button");
      btn.type = "button";
      if (opts.disabled) btn.disabled = true;
      const check = document.createElement("span");
      check.className = "check";
      check.textContent = opts.checked ? "✓" : "";
      const text = document.createElement("span");
      text.className = "label";
      text.textContent = label;
      btn.appendChild(check);
      btn.appendChild(text);
      if (opts.action) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          self._hideMenu();
          Promise.resolve(opts.action()).catch(function (err) {
            self.onStatus(String(err && err.message ? err.message : err));
          });
        });
      }
      rootEl.appendChild(btn);
      return btn;
    }

    function addSub(label, build) {
      const wrap = document.createElement("div");
      wrap.className = "has-sub";
      const btn = document.createElement("button");
      btn.type = "button";
      const check = document.createElement("span");
      check.className = "check";
      const text = document.createElement("span");
      text.className = "label";
      text.textContent = label;
      const arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.textContent = "▸";
      btn.appendChild(check);
      btn.appendChild(text);
      btn.appendChild(arrow);
      const sub = document.createElement("div");
      sub.className = "sub";
      build(sub);
      wrap.appendChild(btn);
      wrap.appendChild(sub);
      wrap.addEventListener("mouseenter", function () {
        wrap.classList.add("open");
      });
      wrap.addEventListener("mouseleave", function () {
        wrap.classList.remove("open");
      });
      rootEl.appendChild(wrap);
    }

    addItem("关于快乐歌词", {
      action: function () {
        return client.request({ cmd: "show_preferences", page_id: "about" });
      },
    });
    addItem("首选项", {
      action: function () {
        return client.request({ cmd: "show_preferences", page_id: "panel" });
      },
    });
    addSep();
    addItem("搜索歌词", {
      action: function () {
        return client.request({ cmd: "show_search_window" });
      },
    });
    addSep();
    addItem("显示桌面歌词", {
      checked: client.desktopOn,
      action: function () {
        const on = !client.desktopOn;
        return client
          .request({ cmd: "set_desktop_visible", on: on })
          .then(function () {
            return client.request({ cmd: "desktop_visible" });
          })
          .then(function (msg) {
            client.desktopOn = !!msg.on;
            self._paint();
          });
      },
    });
    addItem("锁定桌面歌词", {
      checked: client.desktopLocked,
      action: function () {
        const on = !client.desktopLocked;
        return client.request({ cmd: "set_desktop_locked", on: on }).then(function () {
          client.desktopLocked = on;
        });
      },
    });
    addItem("显示浮动窗口歌词", {
      checked: client.floatOn,
      action: function () {
        const on = !client.floatOn;
        return client
          .request({ cmd: "set_float_visible", on: on })
          .then(function () {
            return client.request({ cmd: "float_visible" });
          })
          .then(function (msg) {
            client.floatOn = !!msg.on;
            self._paint();
          });
      },
    });
    addItem("锁定浮动窗口", {
      checked: client.floatLocked,
      action: function () {
        const on = !client.floatLocked;
        return client.request({ cmd: "set_float_locked", on: on }).then(function () {
          client.floatLocked = on;
        });
      },
    });
    addItem("显示任务栏歌词", {
      checked: client.taskbarOn,
      action: function () {
        const on = !client.taskbarOn;
        return client
          .request({ cmd: "set_taskbar_visible", on: on })
          .then(function () {
            return client.request({ cmd: "taskbar_visible" });
          })
          .then(function (msg) {
            client.taskbarOn = !!msg.on;
            self._paint();
          });
      },
    });
    addItem("锁定任务栏歌词", {
      checked: client.taskbarLocked,
      action: function () {
        const on = !client.taskbarLocked;
        return client.request({ cmd: "set_taskbar_locked", on: on }).then(function () {
          client.taskbarLocked = on;
        });
      },
    });
    addSep();
    addSub("歌词语言", function (sub) {
      function layerItem(name, bit) {
        const btn = document.createElement("button");
        btn.type = "button";
        const check = document.createElement("span");
        check.className = "check";
        check.textContent = client.layers & bit ? "✓" : "";
        const text = document.createElement("span");
        text.className = "label";
        text.textContent = name;
        btn.appendChild(check);
        btn.appendChild(text);
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          const next = toggleLayer(client.layers, bit);
          self._hideMenu();
          client
            .request({ cmd: "set_lyric_layers", layers: next })
            .then(function () {
              return client.request({ cmd: "lyric_layers" });
            })
            .then(function (msg) {
              client.layers = msg.layers | 0;
              self._paint();
            })
            .catch(function (err) {
              self.onStatus(String(err && err.message ? err.message : err));
            });
        });
        sub.appendChild(btn);
      }
      layerItem("注音", LAYER_RUBY);
      layerItem("原文", LAYER_ORIG);
      layerItem("译文", LAYER_TRANS);
      layerItem("罗马音", LAYER_ROMAJI);
    });
    addSep();
    addItem("保存", {
      action: function () {
        return client.request({ cmd: "save_lyrics" }).then(function () {
          self.onStatus("已请求保存歌词");
        });
      },
    });
    addSep();
    addItem("编辑歌词", {
      action: function () {
        return client.request({ cmd: "show_edit_window" });
      },
    });

    document.body.appendChild(rootEl);
    this._menuEl = rootEl;

    const rect = rootEl.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    rootEl.style.left = left + "px";
    rootEl.style.top = top + "px";

    setTimeout(function () {
      document.addEventListener("mousedown", self._onDocDown, true);
    }, 0);
  };

  KlyricsPanel.prototype._drawLineText = function (ctx, text, x, y, maxW, baseColor, hiColor, progress, lineH) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    if (!(progress > 0) || progress >= 1 || !hiColor) {
      ctx.fillStyle = progress >= 1 && hiColor ? hiColor : baseColor;
      ctx.fillText(text, x, y, maxW);
      return;
    }
    const tw = Math.min(ctx.measureText(text).width, maxW);
    const left = x - tw / 2;
    ctx.fillStyle = baseColor;
    ctx.fillText(text, x, y, maxW);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, y - 2, Math.max(0, tw * progress), (lineH || 20) + 6);
    ctx.clip();
    ctx.fillStyle = hiColor;
    ctx.fillText(text, x, y, maxW);
    ctx.restore();
  };

  KlyricsPanel.prototype._paint = function () {
    const client = this.client;
    if (!client) return;

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const style = client.style;
    const viewCenter = h * 0.5;

    ctx.clearRect(0, 0, w, h);

    const mode = style.bg_mode || "color";
    if (mode === "transparent") {
      const cell = 12;
      for (let yy = 0; yy < h; yy += cell) {
        for (let xx = 0; xx < w; xx += cell) {
          ctx.fillStyle = (xx / cell + yy / cell) & 1 ? "#ececec" : "#f7f7f7";
          ctx.fillRect(xx, yy, cell, cell);
        }
      }
    } else {
      ctx.fillStyle = style.bg || "#1A1A22";
      ctx.fillRect(0, 0, w, h);
    }

    if (!client.lines.length) {
      ctx.fillStyle = style.text || "#888888";
      ctx.font = fontCss(style, 1);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("暂无歌词", w / 2, viewCenter);
      return;
    }

    const layout = client.layout();
    const scrollY = client.scrollCenterY(layout, client.scrollIndex);
    const karaokeOn = client.karaokeEnabled();
    const karaokeProg = karaokeOn ? client.karaokeProgress(client.index) : 0;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    for (let i = 0; i < layout.rows.length; i++) {
      const row = layout.rows[i];
      const blockCenter = viewCenter + (row.center - scrollY);
      const contentH = (row.text ? row.textH : 0) + (row.trans ? (row.text ? 4 : 0) + row.transH : 0);
      const top = blockCenter - (contentH || row.h) * 0.5;
      const drawScale = client.drawScale(i);
      const half = row.h * drawScale * 0.5 + 4;
      if (blockCenter + half < 0 || blockCenter - half > h) continue;

      let alpha = 1;
      const cur = client.index >= 0 ? client.index : 0;
      if (style.fade && style.fade_lines > 0) {
        const dist = Math.abs(i - cur);
        if (dist > 0) {
          alpha = clamp(1 - dist / (style.fade_lines + 1), 0.25, 1);
        }
      }

      ctx.save();
      if (Math.abs(drawScale - 1) > 0.001) {
        ctx.translate(w / 2, blockCenter);
        ctx.scale(drawScale, drawScale);
        ctx.translate(-w / 2, -blockCenter);
      }
      ctx.globalAlpha = alpha;

      if (row.text) {
        ctx.font = fontCss(style, 1);
        if (row.isCur && karaokeOn) {
          this._drawLineText(
            ctx,
            row.text,
            w / 2,
            top,
            w - 24,
            style.text,
            style.highlight,
            karaokeProg,
            row.textH
          );
        } else {
          let color = style.text;
          if (row.isCur) color = style.highlight;
          else if (row.isPassed) color = style.passed || style.text;
          if (!row.isCur && client.scaleT(i) > 0.01 && !row.isPassed) {
            color = style.highlight;
          }
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(row.text, w / 2, top, w - 24);
        }
      }
      if (row.trans) {
        ctx.font = fontCss(
          {
            font_family: style.font_family,
            font_weight: style.font_weight,
            font_size: Math.max(8, Math.round(style.font_size * 0.85)),
            italic: style.italic,
          },
          1
        );
        ctx.globalAlpha = alpha * 0.85;
        let color = style.text;
        if (row.isCur || client.scaleT(i) > 0.01) color = style.highlight;
        else if (row.isPassed) color = style.passed || style.text;
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(row.trans, w / 2, top + (row.text ? row.textH + 4 : 0), w - 24);
      }
      ctx.restore();
    }

    ctx.restore();
    ctx.globalAlpha = 1;

    if (client.isDragMoved()) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = style.highlight || "#FFDC50";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(16, viewCenter);
      ctx.lineTo(w - 16, viewCenter);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const label = formatClock(client.dragPreviewPos());
      ctx.font = '600 12px "Segoe UI","PingFang SC","Microsoft YaHei UI",sans-serif';
      const padX = 8;
      const bw = ctx.measureText(label).width + padX * 2;
      const bh = 20;
      const bx = (w - bw) / 2;
      const by = 10;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = style.highlight || "#FFDC50";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, w / 2, by + bh / 2);
      ctx.restore();
    }
  };

  function mount(canvas, options) {
    return new KlyricsPanel(canvas, options);
  }

  root.Klyrics = Object.assign(root.Klyrics || {}, {
    mount: mount,
    Panel: KlyricsPanel,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
