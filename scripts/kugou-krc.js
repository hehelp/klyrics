// Community source. Does not replace the built-in Kugou line-LRC source.
// Downloads KRC, decrypts with Klyrics.decrypt(..., "krc"), converts to Enhanced LRC.
var klyrics_source = {
  id: "js:kugou-krc",
  name: "酷狗逐字",
  kind: "lyric",
  version: 1
};

function jsonRoot(text) {
  var s = String(text || "");
  var a = s.indexOf("{");
  var b = s.lastIndexOf("}");
  if (a < 0 || b <= a) {
    return {};
  }
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch (e) {
    return {};
  }
}

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function lrcStamp(sec, open, close) {
  if (sec < 0) {
    sec = 0;
  }
  var cs = Math.round(sec * 100);
  var total = Math.floor(cs / 100);
  var frac = cs % 100;
  var m = Math.floor(total / 60);
  var s = total % 60;
  return open + pad2(m) + ":" + pad2(s) + "." + pad2(frac) + close;
}

function wordsToEnhanced(lineStart, words) {
  var out = lrcStamp(lineStart, "[", "]");
  var last = null;
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (!w || !w.text) {
      continue;
    }
    out += lrcStamp(w.start, "<", ">") + w.text;
    last = w;
  }
  if (last && last.dur > 0) {
    out += lrcStamp(last.start + last.dur, "<", ">");
  }
  return last ? out : "";
}

function krcLineToEnhanced(line) {
  line = String(line || "").replace(/^\s+|\s+$/g, "");
  if (!line || line.charAt(0) !== "[") {
    return "";
  }
  if (/^\[[a-zA-Z$]/.test(line)) {
    return "";
  }
  var start = 0;
  var body = "";
  var ms = line.match(/^\[(\d+),(\d+)\](.*)$/);
  if (ms) {
    start = parseInt(ms[1], 10) / 1000;
    body = ms[3];
  } else {
    var clock = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (!clock) {
      return "";
    }
    start = parseInt(clock[1], 10) * 60 + parseFloat(clock[2]);
    body = clock[3];
  }
  var words = [];
  var re = /<(\d+),(\d+),-?\d+>([^<]*)/g;
  var m;
  while ((m = re.exec(body))) {
    words.push({
      start: start + parseInt(m[1], 10) / 1000,
      dur: parseInt(m[2], 10) / 1000,
      text: m[3]
    });
  }
  if (!words.length) {
    return body ? lrcStamp(start, "[", "]") + body : "";
  }
  return wordsToEnhanced(start, words);
}

function krcToEnhanced(text) {
  var lines = String(text || "").split(/\r?\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var row = krcLineToEnhanced(lines[i]);
    if (row) {
      out.push(row);
    }
  }
  return out.join("\n");
}

function firstHash(obj) {
  return (obj && (obj.FileHash || obj.HQFileHash || obj.SQFileHash)) || "";
}

function coverUrl(url) {
  return String(url || "").split("{size}").join("400");
}

function fetch(fetch_url, query) {
  var hash = String(fetch_url || "").replace(/^\s+|\s+$/g, "");
  if (!hash) {
    throw new Error("missing hash");
  }
  var look = Klyrics.http({
    method: "GET",
    url: "http://krcs.kugou.com/search?ver=1&man=yes&client=mobi&hash=" + Klyrics.urlEncode(hash)
  });
  if (look.status < 200 || look.status >= 300 || !look.text) {
    throw new Error("http " + look.status);
  }
  var cands = jsonRoot(look.text).candidates || [];
  var id = "";
  var key = "";
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    id = c && c.id != null ? String(c.id) : "";
    key = (c && c.accesskey) || "";
    if (id && key) {
      break;
    }
    id = "";
    key = "";
  }
  if (!id || !key) {
    throw new Error("no krc candidate");
  }
  var down = Klyrics.http({
    method: "GET",
    url:
      "http://lyrics.kugou.com/download?ver=1&client=pc&id=" +
      Klyrics.urlEncode(id) +
      "&accesskey=" +
      Klyrics.urlEncode(key) +
      "&fmt=krc&charset=utf8"
  });
  if (down.status < 200 || down.status >= 300 || !down.text) {
    throw new Error("http " + down.status);
  }
  var content = jsonRoot(down.text).content || "";
  if (!content) {
    throw new Error("empty krc");
  }
  var plain = Klyrics.decrypt(content, "krc", { encoding: "base64" });
  var synced = krcToEnhanced(plain);
  if (!synced) {
    throw new Error("no krc words");
  }
  return { synced: synced, plain: "", tlyric: "" };
}

function search(query) {
  var keyword = ((query.artist || "") + " " + (query.title || "")).replace(/^\s+|\s+$/g, "");
  if (!keyword) {
    keyword = query.title || query.artist || "";
  }
  if (!keyword) {
    return [];
  }
  var res = Klyrics.http({
    method: "GET",
    url:
      "http://songsearch.kugou.com/song_search_v2?keyword=" +
      Klyrics.urlEncode(keyword) +
      "&page=1&pagesize=8"
  });
  if (res.status < 200 || res.status >= 300 || !res.text) {
    return [];
  }
  var root = jsonRoot(res.text);
  var lists = (root.data && root.data.lists) || root.lists || [];
  var hits = [];
  for (var i = 0; i < lists.length && hits.length < 5; i++) {
    var s = lists[i];
    var hash = firstHash(s);
    if (!hash) {
      continue;
    }
    var lyric;
    try {
      lyric = fetch(hash, query);
    } catch (e) {
      continue;
    }
    var duration = s.Duration || s.duration || 0;
    hits.push({
      title: s.SongName || s.OriSongName || "",
      artist: s.SingerName || "",
      album: s.AlbumName || "",
      duration: duration > 10000 ? duration / 1000 : duration,
      fetch_url: hash,
      image_url: coverUrl(s.Image || s.AlbumImage || ""),
      synced: lyric.synced || ""
    });
  }
  return hits;
}
