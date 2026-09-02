// Community source. Does not replace the built-in QQ line-LRC source.
// Downloads QRC, decrypts with Klyrics.decrypt(..., "qrc"), converts to Enhanced LRC.
var klyrics_source = {
  id: "js:qq-qrc",
  name: "QQ逐字",
  kind: "lyric",
  version: 1
};

var kHeaders = {
  Referer: "https://y.qq.com/",
  Origin: "https://y.qq.com"
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

function decodeEntities(text) {
  return String(text || "")
    .replace(/&#10;|&#x0a;/gi, "\n")
    .replace(/&#13;|&#x0d;/gi, "\r")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripTags(text) {
  return String(text || "").replace(/<[^>]+>/g, "");
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

function extractQrcBody(text) {
  var s = String(text || "");
  var m = s.match(/LyricContent="([^"]*)"/);
  if (!m) {
    m = s.match(/LyricContent='([^']*)'/);
  }
  if (m) {
    return decodeEntities(m[1]);
  }
  return s;
}

function qrcLineToEnhanced(line) {
  line = String(line || "").replace(/^\s+|\s+$/g, "");
  if (!line || line.charAt(0) !== "[") {
    return "";
  }
  if (/^\[[a-zA-Z$]/.test(line)) {
    return "";
  }
  var head = line.match(/^\[(\d+),(\d+)\](.*)$/);
  if (!head) {
    return "";
  }
  var lineStart = parseInt(head[1], 10) / 1000;
  var rest = head[3];
  var words = [];
  var re = /([^(]*)\((\d+),(\d+)\)/g;
  var m;
  while ((m = re.exec(rest))) {
    if (!m[1]) {
      continue;
    }
    words.push({
      start: parseInt(m[2], 10) / 1000,
      dur: parseInt(m[3], 10) / 1000,
      text: m[1]
    });
  }
  if (!words.length) {
    return rest ? lrcStamp(lineStart, "[", "]") + rest : "";
  }
  return wordsToEnhanced(lineStart, words);
}

function qrcToEnhanced(text) {
  var lines = extractQrcBody(text).split(/\r?\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var row = qrcLineToEnhanced(lines[i]);
    if (row) {
      out.push(row);
    }
  }
  return out.join("\n");
}

function qrcToLineLrc(text) {
  var lines = extractQrcBody(text).split(/\r?\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = String(lines[i] || "").replace(/^\s+|\s+$/g, "");
    var head = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!head) {
      if (/^\[\d+:\d+/.test(line)) {
        out.push(line);
      }
      continue;
    }
    var words = String(head[3] || "").replace(/\(\d+,\d+\)/g, "");
    if (words) {
      out.push(lrcStamp(parseInt(head[1], 10) / 1000, "[", "]") + words);
    }
  }
  return out.join("\n");
}

function looksHex(s) {
  s = String(s || "").replace(/\s+/g, "");
  return s.length >= 32 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}

function decryptField(raw) {
  raw = String(raw || "").replace(/\s+/g, "");
  if (!raw) {
    return "";
  }
  try {
    if (looksHex(raw)) {
      return Klyrics.decrypt(raw, "qrc", { encoding: "hex" });
    }
    return Klyrics.decrypt(raw, "qrc", { encoding: "base64" });
  } catch (e) {
    return "";
  }
}

function firstCdata(xml) {
  var s = String(xml || "");
  var i = 0;
  while ((i = s.indexOf("CDATA[", i)) >= 0) {
    var start = i + 6;
    var end = s.indexOf("]", start);
    if (end < 0) {
      break;
    }
    var chunk = s.slice(start, end).replace(/\s+/g, "");
    if (looksHex(chunk)) {
      return chunk;
    }
    i = start;
  }
  return "";
}

function lyricData(root) {
  if (!root || typeof root !== "object") {
    return null;
  }
  if (root.request && root.request.data) {
    return root.request.data;
  }
  var alt = root["music.musichallSong.PlayLyricInfo.GetPlayLyricInfo"];
  if (alt && alt.data) {
    return alt.data;
  }
  return root.data || null;
}

function singerNames(song) {
  var list = (song && song.singer) || [];
  var names = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].name) {
      names.push(String(list[i].name));
    }
  }
  return names.join(" / ");
}

function fetchByPlayLyric(songid) {
  var res = Klyrics.http({
    method: "POST",
    url: "https://u.y.qq.com/cgi-bin/musicu.fcg",
    headers: {
      Referer: "https://y.qq.com/",
      Origin: "https://y.qq.com",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      comm: { ct: 11, cv: "1003006", v: "1003006", tmeAppID: "qqmusiclight" },
      request: {
        module: "music.musichallSong.PlayLyricInfo",
        method: "GetPlayLyricInfo",
        param: { songID: Number(songid), qrc: 1, trans: 1, roma: 0, crypt: 1 }
      }
    })
  });
  if (res.status < 200 || res.status >= 300 || !res.text) {
    throw new Error("http " + res.status);
  }
  var data = lyricData(jsonRoot(res.text));
  var lyric = data && data.lyric ? String(data.lyric) : "";
  var trans = data && data.trans ? String(data.trans) : "";
  if (!lyric) {
    throw new Error("no qrc field");
  }
  var plain = decryptField(lyric);
  var synced = qrcToEnhanced(plain);
  if (!synced) {
    throw new Error("no qrc words");
  }
  var tlyric = "";
  if (trans) {
    var tplain = decryptField(trans);
    tlyric = qrcToLineLrc(tplain) || tplain;
  }
  return { synced: synced, plain: "", tlyric: tlyric };
}

function fetchByDownload(songid) {
  var res = Klyrics.http({
    method: "POST",
    url: "https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg",
    headers: {
      Referer: "https://y.qq.com/",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "version=15&miniversion=82&lrctype=4&musicid=" + Klyrics.urlEncode(String(songid))
  });
  if (res.status < 200 || res.status >= 300 || !res.text) {
    throw new Error("http " + res.status);
  }
  var hex = firstCdata(res.text);
  if (!hex) {
    throw new Error("no qrc cdata");
  }
  var plain = decryptField(hex);
  var synced = qrcToEnhanced(plain);
  if (!synced) {
    throw new Error("no qrc words");
  }
  return { synced: synced, plain: "", tlyric: "" };
}

function fetch(fetch_url, query) {
  var id = String(fetch_url || "").replace(/^\s+|\s+$/g, "");
  if (!id) {
    throw new Error("missing song id");
  }
  try {
    return fetchByPlayLyric(id);
  } catch (e) {
    return fetchByDownload(id);
  }
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
      "https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=" +
      Klyrics.urlEncode(keyword) +
      "&n=5&format=json",
    headers: kHeaders
  });
  if (res.status < 200 || res.status >= 300 || !res.text) {
    return [];
  }
  var root = jsonRoot(res.text);
  var lists = ((root.data && root.data.song && root.data.song.list) || []);
  var hits = [];
  for (var i = 0; i < lists.length && hits.length < 3; i++) {
    var s = lists[i];
    var id = s && (s.songid != null ? s.songid : s.id);
    if (id == null || id === "") {
      continue;
    }
    var lyric;
    try {
      lyric = fetch(String(id), query);
    } catch (e) {
      continue;
    }
    var albummid = s.albummid || (s.album && s.album.mid) || "";
    hits.push({
      title: stripTags(s.songname || s.name || ""),
      artist: stripTags(singerNames(s)),
      album: stripTags(s.albumname || (s.album && s.album.name) || ""),
      duration: s.interval || 0,
      fetch_url: String(id),
      image_url: albummid ? "https://y.gtimg.cn/music/photo_new/T002R400x400M000" + albummid + ".jpg" : "",
      synced: lyric.synced || "",
      tlyric: lyric.tlyric || ""
    });
  }
  return hits;
}
