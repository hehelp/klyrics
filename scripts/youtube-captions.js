// Community source. YouTube CC timedtext, then YouTube Music lyrics tab.
var klyrics_source = {
  id: "js:youtube",
  name: "YouTube字幕",
  kind: "lyric",
  version: 2
};

var kHeaders = {
  Referer: "https://www.youtube.com/",
  Origin: "https://www.youtube.com",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Cookie: "CONSENT=YES+",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
};

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function formatLrcTime(secondsStr) {
  var totalSeconds = parseFloat(secondsStr);
  if (isNaN(totalSeconds) || totalSeconds < 0) {
    return "[00:00.00]";
  }
  var m = Math.floor(totalSeconds / 60);
  var s = Math.floor(totalSeconds % 60);
  var xx = Math.floor((totalSeconds % 1) * 100);
  return "[" + pad2(m) + ":" + pad2(s) + "." + pad2(xx) + "]";
}

function decodeHtmlEntities(text) {
  if (!text) {
    return "";
  }
  var out = String(text);
  out = out.replace(/&amp;/g, "&");
  out = out.replace(/&quot;/g, '"');
  out = out.replace(/&lt;/g, "<");
  out = out.replace(/&gt;/g, ">");
  out = out.replace(/&apos;/g, "'");
  out = out.replace(/&#39;/g, "'");
  out = out.replace(/&#x27;/gi, "'");
  out = out.replace(/&#(\d+);/g, function (_, n) {
    return String.fromCharCode(parseInt(n, 10));
  });
  out = out.replace(/&#x([0-9a-fA-F]+);/g, function (_, n) {
    return String.fromCharCode(parseInt(n, 16));
  });
  out = out.replace(/<br\s*\/?>/gi, " ");
  out = out.replace(/<[^>]+>/g, "");
  return out.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
}

function convertYoutubeXmlToLrc(xmlData) {
  var lrc = "";
  var regex = /<text\s+start="([^"]+)"[^>]*>([\s\S]*?)<\/text>/gi;
  var match;
  while ((match = regex.exec(xmlData)) !== null) {
    var cleanText = decodeHtmlEntities(match[2]);
    if (cleanText) {
      lrc += formatLrcTime(match[1]) + cleanText + "\n";
    }
  }
  if (lrc) {
    return lrc;
  }
  regex = /<p\s+t="([^"]+)"[^>]*>([\s\S]*?)<\/p>/gi;
  while ((match = regex.exec(xmlData)) !== null) {
    var cleanP = decodeHtmlEntities(match[2]);
    if (cleanP) {
      lrc += formatLrcTime(parseFloat(match[1]) / 1000) + cleanP + "\n";
    }
  }
  return lrc;
}

function convertJson3ToLrc(text) {
  var data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return "";
  }
  var events = data && data.events;
  if (!events || !events.length) {
    return "";
  }
  var lrc = "";
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    var segs = (ev && ev.segs) || [];
    var line = "";
    for (var j = 0; j < segs.length; j++) {
      if (segs[j] && segs[j].utf8) {
        line += segs[j].utf8;
      }
    }
    line = decodeHtmlEntities(line.replace(/\n/g, " "));
    if (!line) {
      continue;
    }
    lrc += formatLrcTime((ev.tStartMs || 0) / 1000) + line + "\n";
  }
  return lrc;
}

function httpGet(url) {
  var res = Klyrics.http({
    method: "GET",
    url: url,
    headers: kHeaders
  });
  if (!res || res.status < 200 || res.status >= 300 || !res.text) {
    Klyrics.log("http " + (res ? res.status : 0) + " " + url);
    return "";
  }
  return String(res.text);
}

function trackSource(query) {
  var parts = [
    (query && query.path) || "",
    (query && query.url) || "",
    (query && query.title) || "",
    (query && query.album) || ""
  ];
  for (var i = 0; i < parts.length; i++) {
    var s = String(parts[i] || "");
    if (extractVideoId(s)) {
      return s;
    }
  }
  return String(parts[0] || parts[1] || "");
}

function extractVideoId(raw) {
  var s = String(raw || "");
  var m = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m) {
    return m[1];
  }
  m = s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (m) {
    return m[1];
  }
  m = s.match(/youtube\.com\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/);
  if (m) {
    return m[1];
  }
  return "";
}

function extractJsonArray(html, key) {
  var needle = '"' + key + '"';
  var idx = html.indexOf(needle);
  if (idx < 0) {
    return null;
  }
  var start = html.indexOf("[", idx);
  if (start < 0 || start - idx > 40) {
    return null;
  }
  var depth = 0;
  var inStr = false;
  var esc = false;
  for (var i = start; i < html.length && i < start + 200000; i++) {
    var c = html.charAt(i);
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "[") {
      depth++;
    } else if (c === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

function trackName(row) {
  if (!row) {
    return "";
  }
  if (row.name && row.name.simpleText) {
    return String(row.name.simpleText);
  }
  if (typeof row.name === "string") {
    return row.name;
  }
  return String(row.languageCode || "");
}

function langRank(row) {
  var code = String((row && row.languageCode) || "").toLowerCase();
  var asr = row && row.kind === "asr" ? 100 : 0;
  var pref = 20;
  if (code === "zh-hans" || code === "zh-cn" || code === "zh") {
    pref = 0;
  } else if (code === "zh-hant" || code === "zh-tw" || code === "zh-hk") {
    pref = 1;
  } else if (code.indexOf("zh") === 0) {
    pref = 2;
  } else if (code === "en" || code.indexOf("en-") === 0) {
    pref = 10;
  }
  return asr + pref;
}

function httpPost(url, body, extra) {
  var headers = {};
  var k;
  for (k in kHeaders) {
    if (kHeaders.hasOwnProperty(k)) {
      headers[k] = kHeaders[k];
    }
  }
  headers["Content-Type"] = "application/json";
  if (url.indexOf("music.youtube.com") >= 0) {
    headers.Origin = "https://music.youtube.com";
    headers.Referer = "https://music.youtube.com/";
  }
  if (extra) {
    for (k in extra) {
      if (extra.hasOwnProperty(k)) {
        headers[k] = extra[k];
      }
    }
  }
  var res = Klyrics.http({
    method: "POST",
    url: url,
    headers: headers,
    body: body
  });
  if (!res || res.status < 200 || res.status >= 300 || !res.text) {
    Klyrics.log("http " + (res ? res.status : 0) + " " + url);
    return "";
  }
  return String(res.text);
}

function innertubeNext(videoId) {
  var body = JSON.stringify({
    context: {
      client: {
        clientName: "WEB_REMIX",
        clientVersion: "1.20250903.01.00",
        hl: "zh-CN",
        gl: "US"
      }
    },
    videoId: videoId,
    isAudioOnly: true,
    enablePersistentPlaylistPanel: true
  });
  return httpPost("https://music.youtube.com/youtubei/v1/next?prettyPrint=false", body);
}

function innertubeBrowse(browseId, android) {
  var ctx = android
    ? {
        clientName: "ANDROID_MUSIC",
        clientVersion: "7.27.52",
        hl: "zh-CN",
        androidSdkVersion: 34
      }
    : {
        clientName: "WEB_REMIX",
        clientVersion: "1.20250903.01.00",
        hl: "zh-CN",
        gl: "US"
      };
  var extra = android
    ? { "User-Agent": "com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14)" }
    : null;
  var body = JSON.stringify({
    context: { client: ctx },
    browseId: browseId
  });
  return httpPost("https://music.youtube.com/youtubei/v1/browse?prettyPrint=false", body, extra);
}

function lyricsBrowseId(nextText) {
  var re = /"browseId":"(MPLYt_[^"]+)"[\s\S]{0,260}MUSIC_PAGE_TYPE_TRACK_LYRICS/g;
  var m = re.exec(nextText);
  if (!m) {
    return "";
  }
  var from = m.index > 400 ? m.index - 400 : 0;
  var around = nextText.slice(from, m.index + 280);
  if (around.indexOf('"unselectable":true') >= 0) {
    return "";
  }
  return m[1];
}

function convertTimedMusicToLrc(rows) {
  var lrc = "";
  if (!rows || !rows.length) {
    return lrc;
  }
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var line = row && row.lyricLine ? String(row.lyricLine) : "";
    line = decodeHtmlEntities(line.replace(/\r/g, ""));
    if (!line) {
      continue;
    }
    var ms = 0;
    if (row.cueRange && row.cueRange.startTimeMilliseconds) {
      ms = parseFloat(row.cueRange.startTimeMilliseconds);
    }
    lrc += formatLrcTime((isNaN(ms) ? 0 : ms) / 1000) + line + "\n";
  }
  return lrc;
}

function convertShelfLyrics(text) {
  var idx = text.indexOf("musicDescriptionShelfRenderer");
  if (idx < 0) {
    return "";
  }
  var m = text.slice(idx, idx + 30000).match(/"description":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"\}/);
  if (!m) {
    return "";
  }
  try {
    return JSON.parse('"' + m[1] + '"').replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  } catch (e) {
    return m[1].replace(/\\n/g, "\n").replace(/\\r/g, "");
  }
}

function searchMusicLyrics(videoId) {
  var nextText = innertubeNext(videoId);
  if (!nextText) {
    return null;
  }
  var browseId = lyricsBrowseId(nextText);
  if (!browseId) {
    Klyrics.log("music: no lyrics tab");
    return null;
  }
  var timed = innertubeBrowse(browseId, true);
  var rows = timed ? extractJsonArray(timed, "timedLyricsData") : null;
  var lrc = convertTimedMusicToLrc(rows);
  if (lrc) {
    Klyrics.log("music timed " + rows.length);
    return { synced: lrc, plain: "", album: "YouTube Music" };
  }
  var shelf = innertubeBrowse(browseId, false);
  var plain = convertShelfLyrics(shelf);
  if (plain) {
    Klyrics.log("music plain");
    return { synced: "", plain: plain, album: "YouTube Music" };
  }
  Klyrics.log("music: empty lyrics tab");
  return null;
}

function captionUrl(row) {
  var url = String((row && row.baseUrl) || "");
  if (!url) {
    return "";
  }
  url = url.replace(/\\u0026/g, "&");
  if (url.indexOf("//") === 0) {
    url = "https:" + url;
  }
  return url;
}

function fetch(fetch_url) {
  var url = String(fetch_url || "").replace(/^\s+|\s+$/g, "");
  if (!url) {
    throw new Error("missing caption url");
  }
  var text = httpGet(url);
  if (!text) {
    throw new Error("http empty");
  }
  var lrc = convertYoutubeXmlToLrc(text);
  if (!lrc) {
    lrc = convertJson3ToLrc(text);
  }
  if (!lrc) {
    throw new Error("no caption text");
  }
  return { synced: lrc, plain: "", tlyric: "" };
}

function search(query) {
  var raw = trackSource(query);
  var id = extractVideoId(raw);
  if (!id) {
    Klyrics.log("skip: no video id in path/title");
    return [];
  }
  Klyrics.log("watch " + id);
  var html = httpGet("https://www.youtube.com/watch?v=" + id);
  if (!html) {
    return [];
  }
  var list = extractJsonArray(html, "captionTracks");
  if (!list || !list.length) {
    var fallback = html.match(/"captionTracks":\[\{"baseUrl":"([^"]+)"/);
    if (!fallback || !fallback[1]) {
      Klyrics.log("no CC tracks, try music lyrics");
      var music = searchMusicLyrics(id);
      if (!music) {
        return [];
      }
      return [
        {
          title: query.title || id,
          artist: query.artist || "",
          album: music.album,
          duration: query.duration || 0,
          fetch_url: "",
          synced: music.synced,
          plain: music.plain
        }
      ];
    }
    list = [{ baseUrl: fallback[1].replace(/\\u0026/g, "&"), languageCode: "" }];
  }
  Klyrics.log("captionTracks " + list.length);
  list.sort(function (a, b) {
    return langRank(a) - langRank(b);
  });
  var hits = [];
  var seen = {};
  for (var i = 0; i < list.length && hits.length < 8; i++) {
    var row = list[i];
    var url = captionUrl(row);
    if (!url || seen[url]) {
      continue;
    }
    seen[url] = true;
    var lang = trackName(row) || row.languageCode || "captions";
    if (row.kind === "asr") {
      lang += " (自动)";
    }
    hits.push({
      title: query.title || id,
      artist: query.artist || "",
      album: lang,
      duration: query.duration || 0,
      fetch_url: url,
      synced: "",
      plain: ""
    });
  }
  return hits;
}
