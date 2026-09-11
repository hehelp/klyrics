// Community source. Plain lyrics from lyricsmania.com (no timestamps).
var klyrics_source = {
  id: "js:lyricsmania",
  name: "LyricsMania",
  kind: "lyric",
  version: 1
};

var kHost = "https://www.lyricsmania.com";
var kHeaders = {
  Referer: "https://www.lyricsmania.com/",
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
};

function trim(s) {
  return String(s || "").replace(/^\s+|\s+$/g, "");
}

function decodeHtml(text) {
  if (!text) {
    return "";
  }
  var out = String(text);
  out = out.replace(/&nbsp;/gi, " ");
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
  return out;
}

function slug(s) {
  var out = String(s || "").toLowerCase();
  out = out.replace(/&/g, " and ");
  out = out.replace(/[^a-z0-9]+/g, "_");
  out = out.replace(/^_+|_+$/g, "");
  return out;
}

function absUrl(href) {
  href = trim(href);
  if (!href) {
    return "";
  }
  if (/^https?:\/\//i.test(href)) {
    return href;
  }
  if (href.charAt(0) !== "/") {
    href = "/" + href;
  }
  return kHost + href;
}

function songUrl(artist, title) {
  var a = slug(artist);
  var t = slug(title);
  if (!a || !t) {
    return "";
  }
  return kHost + "/" + t + "_lyrics_" + a + ".html";
}

function get(url) {
  return Klyrics.http({
    method: "GET",
    url: url,
    headers: kHeaders
  });
}

function stripTags(html) {
  var out = String(html || "");
  out = out.replace(/<script[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<div class="p402_premium"[\s\S]*?<\/div>/gi, "");
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/p>/gi, "\n");
  out = out.replace(/<[^>]+>/g, "");
  out = decodeHtml(out);
  out = out.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  out = out.replace(/[ \t]+\n/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return trim(out);
}

function extractLyrics(html) {
  var start = html.search(/<div class="lyrics-body">/i);
  if (start < 0) {
    return "";
  }
  var from = html.indexOf(">", start);
  if (from < 0) {
    return "";
  }
  var i = from + 1;
  var depth = 1;
  var re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = i;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (/^<\//.test(m[0])) {
      depth -= 1;
      if (depth === 0) {
        return stripTags(html.slice(i, m.index));
      }
    } else if (!/\/\s*>$/.test(m[0])) {
      depth += 1;
    }
  }
  return "";
}

function parseHits(html) {
  var hits = [];
  var seen = {};
  var block = html;
  var lyricsAt = html.search(/<h4>\s*Lyrics\s*<\/h4>/i);
  var artistsAt = html.search(/<h4>\s*Artists\s*<\/h4>/i);
  if (lyricsAt >= 0) {
    block = artistsAt > lyricsAt ? html.slice(lyricsAt, artistsAt) : html.slice(lyricsAt);
  }
  var re = /<a href="(\/[^"]+_lyrics_[^"\/]+\.html)"[^>]*>([^<]+)<\/a>/gi;
  var m;
  while ((m = re.exec(block)) !== null && hits.length < 8) {
    var href = m[1];
    if (/_album_lyrics_/.test(href) || seen[href]) {
      continue;
    }
    seen[href] = true;
    var label = trim(decodeHtml(m[2]));
    var title = label;
    var artist = "";
    var dash = label.lastIndexOf(" - ");
    if (dash > 0) {
      title = trim(label.slice(0, dash));
      artist = trim(label.slice(dash + 3));
    }
    var img = "";
    var before = block.slice(Math.max(0, m.index - 180), m.index);
    var im = before.match(/<img src="([^"]+)"/i);
    if (im && im[1] && im[1].indexOf("thumbnails-sample") < 0 && im[1].indexOf("/css/") < 0) {
      img = absUrl(im[1]);
    }
    hits.push({
      title: title,
      artist: artist,
      album: "",
      duration: 0,
      fetch_url: absUrl(href),
      image_url: img
    });
  }
  return hits;
}

function fetch(fetch_url, query) {
  var url = trim(fetch_url);
  if (!url) {
    url = songUrl(query.artist, query.title);
  }
  if (!url) {
    throw new Error("missing lyricsmania url");
  }
  var res = get(url);
  if (res.status < 200 || res.status >= 300 || !res.text) {
    throw new Error("http " + res.status);
  }
  var text = extractLyrics(res.text);
  if (!text) {
    throw new Error("no lyrics");
  }
  return { synced: "", plain: text, tlyric: "" };
}

function search(query) {
  var artist = trim(query.artist);
  var title = trim(query.title);
  var q = trim(artist + " " + title);
  if (!q) {
    return [];
  }
  var res = get(kHost + "/search.php?k=" + encodeURIComponent(q));
  var hits = [];
  if (res.status >= 200 && res.status < 300 && res.text) {
    hits = parseHits(res.text);
  }
  if (hits.length === 0) {
    var direct = songUrl(artist, title);
    if (direct) {
      try {
        var lyric = fetch(direct, query);
        hits.push({
          title: title,
          artist: artist,
          album: "",
          duration: 0,
          fetch_url: direct,
          synced: "",
          plain: lyric.plain || ""
        });
      } catch (e) {
        return [];
      }
    }
  }
  return hits;
}
