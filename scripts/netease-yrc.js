// Community source. Does not replace the built-in NetEase line-LRC source.
// Fetches YRC word timestamps and converts them to Enhanced LRC in `synced`.
var klyrics_source = {
  id: "js:netease-yrc",
  name: "网易云逐字",
  kind: "lyric",
  version: 1
};

var kUa =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var kHeaders = {
  Referer: "https://music.163.com/",
  Cookie: "appver=1.5.0.75771;",
  "User-Agent": kUa
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

function yrcLineToEnhanced(line) {
  line = String(line || "").replace(/^\s+|\s+$/g, "");
  if (!line) {
    return "";
  }
  if (line.charAt(0) === "{") {
    try {
      var obj = JSON.parse(line);
      var parts = obj.c || [];
      var cursor = (obj.t || 0) / 1000;
      var words = [];
      for (var i = 0; i < parts.length; i++) {
        var tx = parts[i].tx || "";
        if (!tx) {
          continue;
        }
        var dur = typeof parts[i].t === "number" ? parts[i].t / 1000 : 0;
        words.push({ start: cursor, dur: dur, text: tx });
        if (dur > 0) {
          cursor += dur;
        }
      }
      return wordsToEnhanced((obj.t || 0) / 1000, words);
    } catch (e) {
      return "";
    }
  }
  var head = line.match(/^\[(\d+),(\d+)\]/);
  if (!head) {
    return "";
  }
  var lineStart = parseInt(head[1], 10) / 1000;
  var rest = line.slice(head[0].length);
  var words = [];
  var re = /\((\d+),(\d+)(?:,-?\d+)?\)([^(]*)/g;
  var m;
  while ((m = re.exec(rest))) {
    words.push({
      start: parseInt(m[1], 10) / 1000,
      dur: parseInt(m[2], 10) / 1000,
      text: m[3]
    });
  }
  return wordsToEnhanced(lineStart, words);
}

function yrcToEnhanced(text) {
  var lines = String(text || "").split(/\r?\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var row = yrcLineToEnhanced(lines[i]);
    if (row) {
      out.push(row);
    }
  }
  return out.join("\n");
}

function artistNames(song) {
  var list = (song && song.artists) || [];
  var names = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].name) {
      names.push(String(list[i].name));
    }
  }
  return names.join(" / ");
}

function fetch(fetch_url, query) {
  var id = String(fetch_url || "").replace(/^\s+|\s+$/g, "");
  if (!id) {
    throw new Error("missing song id");
  }
  var res = Klyrics.http({
    method: "GET",
    url:
      "https://music.163.com/api/song/lyric/v1?id=" +
      Klyrics.urlEncode(id) +
      "&cp=false&lv=1&kv=1&tv=-1&yv=1&ytv=-1&yrv=-1",
    headers: kHeaders
  });
  if (res.status < 200 || res.status >= 300 || !res.text) {
    throw new Error("http " + res.status);
  }
  var json = jsonRoot(res.text);
  var yrc = (json.yrc && json.yrc.lyric) || "";
  var synced = yrcToEnhanced(yrc);
  if (!synced) {
    throw new Error("no yrc");
  }
  var tlyric = (json.tlyric && json.tlyric.lyric) || "";
  var ytlrc = (json.ytlrc && json.ytlrc.lyric) || "";
  return { synced: synced, plain: "", tlyric: tlyric || ytlrc || "" };
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
      "https://music.163.com/api/search/get/web?s=" +
      Klyrics.urlEncode(keyword) +
      "&type=1&offset=0&limit=5",
    headers: kHeaders
  });
  if (res.status < 200 || res.status >= 300 || !res.text) {
    return [];
  }
  var songs = ((jsonRoot(res.text).result || {}).songs) || [];
  var hits = [];
  for (var i = 0; i < songs.length && hits.length < 3; i++) {
    var s = songs[i];
    var id = s && s.id != null ? String(s.id) : "";
    if (!id) {
      continue;
    }
    var lyric;
    try {
      lyric = fetch(id, query);
    } catch (e) {
      continue;
    }
    hits.push({
      title: s.name || "",
      artist: artistNames(s),
      album: (s.album && s.album.name) || "",
      duration: s.duration > 10000 ? s.duration / 1000 : s.duration || 0,
      fetch_url: id,
      image_url: (s.album && s.album.picUrl) || "",
      synced: lyric.synced || "",
      tlyric: lyric.tlyric || ""
    });
  }
  return hits;
}
