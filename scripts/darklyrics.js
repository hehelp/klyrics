// Community source. Plain lyrics from darklyrics.com (metal archive, no timestamps).
var klyrics_source = {
  id: "js:darklyrics",
  name: "Dark Lyrics",
  kind: "lyric",
  version: 1
};

var kHost = "http://www.darklyrics.com";
var kHeaders = {
  Referer: "http://www.darklyrics.com/",
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

function stripTags(html) {
  var out = String(html || "");
  out = out.replace(/<script[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/p>/gi, "\n");
  out = out.replace(/<[^>]+>/g, "");
  out = decodeHtml(out);
  out = out.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  out = out.replace(/[ \t]+\n/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return trim(out);
}

function norm(s) {
  var out = decodeHtml(s).toLowerCase();
  out = out.replace(/&/g, "and");
  out = out.replace(/[^a-z0-9]+/g, " ");
  return trim(out.replace(/\s+/g, " "));
}

function stripParen(s) {
  return trim(String(s || "").replace(/\s*[(\[][^)\]]*[)\]]\s*/g, " ").replace(/\s+/g, " "));
}

function primaryArtist(artist) {
  var s = stripParen(artist);
  s = s.split(/\s*(?:,|&|\/|feat\.?|ft\.?|featuring)\s+/i)[0];
  return trim(s);
}

function slug(name, dropThe) {
  var s = trim(name).toLowerCase();
  if (dropThe) {
    s = s.replace(/^the\s+/, "");
  }
  s = s.replace(/&/g, "and");
  s = s.replace(/[^a-z0-9]+/g, "");
  return s;
}

function letterOf(slugName) {
  var ch = slugName.charAt(0);
  if (ch >= "a" && ch <= "z") {
    return ch;
  }
  return "19";
}

function absUrl(href) {
  href = trim(href);
  if (!href) {
    return "";
  }
  href = href.replace(/^\.\.\//, "/");
  if (/^https?:\/\//i.test(href)) {
    return href.replace(/^https:\/\//i, "http://");
  }
  if (href.charAt(0) !== "/") {
    href = "/" + href;
  }
  return kHost + href;
}

function httpOk(res) {
  return !!(res && res.text && (res.status === 418 || (res.status >= 200 && res.status < 300)));
}

function isMissingPage(res) {
  if (!res || !res.text) {
    return true;
  }
  if (res.status === 404) {
    return true;
  }
  if (res.status >= 400 && res.status !== 418) {
    return true;
  }
  return /page not found/i.test(res.text);
}

function get(url) {
  return Klyrics.http({
    method: "GET",
    url: url,
    headers: kHeaders
  });
}

function suggestBands(q) {
  var names = [];
  q = trim(q);
  if (!q) {
    return names;
  }
  var res = Klyrics.http({
    method: "POST",
    url: kHost + "/ss",
    headers: {
      Referer: kHost + "/",
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": kHeaders["User-Agent"]
    },
    body: "q=" + encodeURIComponent(q) + "&n=1"
  });
  if (!httpOk(res)) {
    return names;
  }
  var re = /<text>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|(.*?))\s*<\/text>/gi;
  var m;
  while ((m = re.exec(res.text)) !== null) {
    var name = trim(decodeHtml(m[1] || m[2] || ""));
    if (name && names.indexOf(name) < 0) {
      names.push(name);
    }
  }
  return names;
}

function bandUrlFromSlug(slugName) {
  if (!slugName) {
    return "";
  }
  return kHost + "/" + letterOf(slugName) + "/" + slugName + ".html";
}

function bandUrlsForName(name) {
  var urls = [];
  var seen = {};
  var slugs = [slug(name, false), slug(name, true)];
  for (var i = 0; i < slugs.length; i++) {
    var url = bandUrlFromSlug(slugs[i]);
    if (url && !seen[url]) {
      seen[url] = true;
      urls.push(url);
    }
  }
  return urls;
}

function parseBandName(html) {
  var t = html.match(/<title>\s*([^<]+?)\s+lyrics\s*<\/title>/i);
  if (t) {
    return trim(decodeHtml(t[1]));
  }
  return "";
}

function parseBandSongs(html, artistName) {
  var hits = [];
  var seen = {};
  var parts = html.split(/<div class="album">/i);
  if (parts.length < 2) {
    parts = [html];
  }
  for (var i = 0; i < parts.length; i++) {
    var chunk = parts[i];
    var album = "";
    var am = chunk.match(/<h2>[\s\S]*?<strong>"([^"]+)"<\/strong>/i);
    if (am) {
      album = trim(decodeHtml(am[1]));
    }
    var re = /<a href="((?:\.\.\/)?lyrics\/[^"#?]+\.html)#(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(chunk)) !== null) {
      var href = absUrl(m[1] + "#" + m[2]);
      if (seen[href]) {
        continue;
      }
      seen[href] = true;
      var title = trim(stripTags(m[3]));
      if (!title) {
        continue;
      }
      hits.push({
        title: title,
        artist: artistName,
        album: album,
        duration: 0,
        fetch_url: href
      });
    }
  }
  return hits;
}

function findBandOnLetterPage(html, artist) {
  var want = norm(artist);
  if (!want) {
    return "";
  }
  var best = "";
  var bestScore = 0;
  var re = /<a href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1];
    if (/azlyrics\.com/i.test(href)) {
      continue;
    }
    if (!/(?:^|\/)[a-z0-9]{1,2}\/[^\/]+\.html$/i.test(href)) {
      continue;
    }
    var have = norm(m[2]);
    var score = 0;
    if (have === want) {
      score = 100;
    } else if (have.indexOf(want) >= 0 || want.indexOf(have) >= 0) {
      score = 60;
    }
    if (score > bestScore) {
      bestScore = score;
      best = absUrl(href);
    }
  }
  return bestScore >= 60 ? best : "";
}

function loadBandPage(artist) {
  var names = [];
  var raw = primaryArtist(artist);
  if (raw) {
    names.push(raw);
  }
  try {
    var suggested = suggestBands(raw);
    for (var i = 0; i < suggested.length && i < 4; i++) {
      if (names.indexOf(suggested[i]) < 0) {
        names.push(suggested[i]);
      }
    }
  } catch (e) {}
  var tried = {};
  for (var n = 0; n < names.length; n++) {
    var urls = bandUrlsForName(names[n]);
    for (var u = 0; u < urls.length; u++) {
      if (tried[urls[u]]) {
        continue;
      }
      tried[urls[u]] = true;
      var res = get(urls[u]);
      if (!isMissingPage(res)) {
        return res.text;
      }
    }
  }
  if (!raw) {
    return "";
  }
  var letterSlug = slug(raw, true) || slug(raw, false);
  if (!letterSlug) {
    return "";
  }
  var index = get(kHost + "/" + letterOf(letterSlug) + ".html");
  if (isMissingPage(index)) {
    return "";
  }
  var found = findBandOnLetterPage(index.text, raw);
  if (!found || tried[found]) {
    return "";
  }
  var band = get(found);
  return isMissingPage(band) ? "" : band.text;
}

function parseSearchHits(html) {
  var hits = [];
  var seen = {};
  var re = /<a href="((?:https?:\/\/(?:www\.)?darklyrics\.com)?\/lyrics\/[^"#?]+\.html)#(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null && hits.length < 8) {
    var href = absUrl(m[1] + "#" + m[2]);
    if (seen[href]) {
      continue;
    }
    seen[href] = true;
    var label = trim(stripTags(m[3]).replace(/\s+/g, " "));
    var artist = "";
    var album = "";
    var title = label;
    var parts = label.split(" - ");
    if (parts.length >= 3) {
      artist = trim(parts[0]);
      album = trim(parts[1]);
      title = trim(parts.slice(2).join(" - "));
    } else if (parts.length === 2) {
      artist = trim(parts[0]);
      title = trim(parts[1]);
    }
    hits.push({
      title: title,
      artist: artist,
      album: album,
      duration: 0,
      fetch_url: href
    });
  }
  return hits;
}

function titleScore(wantTitle, haveTitle, wantAlbum, haveAlbum) {
  var want = norm(wantTitle);
  var have = norm(haveTitle);
  if (!want || !have) {
    return 0;
  }
  var score = 0;
  if (want === have) {
    score = 100;
  } else if (norm(stripParen(wantTitle)) === have || want === norm(stripParen(haveTitle))) {
    score = 88;
  } else if (have.indexOf(want) >= 0 || want.indexOf(have) >= 0) {
    score = 56;
  } else {
    return 0;
  }
  var wa = norm(wantAlbum);
  var ha = norm(haveAlbum);
  if (wa && ha) {
    if (wa === ha) {
      score += 24;
    } else if (ha.indexOf(wa) >= 0 || wa.indexOf(ha) >= 0) {
      score += 10;
    }
  }
  return score;
}

function rankHits(songs, query) {
  var scored = [];
  for (var i = 0; i < songs.length; i++) {
    var s = songs[i];
    var score = titleScore(query.title, s.title, query.album, s.album);
    if (score > 0) {
      scored.push({ score: score, hit: s });
    }
  }
  scored.sort(function (a, b) {
    return b.score - a.score;
  });
  var out = [];
  var seen = {};
  for (var j = 0; j < scored.length && out.length < 8; j++) {
    var key = scored[j].hit.fetch_url;
    if (seen[key]) {
      continue;
    }
    seen[key] = true;
    out.push(scored[j].hit);
  }
  return out;
}

function extractTrack(html, trackNo, titleHint) {
  var start = html.search(/<div class="lyrics">/i);
  var block = start >= 0 ? html.slice(start) : html;
  var heading = null;
  if (trackNo) {
    var named = new RegExp('<h3>\\s*<a name="' + trackNo + '">([\\s\\S]*?)</a>\\s*</h3>', "i");
    heading = named.exec(block);
  }
  if (!heading && titleHint) {
    var want = norm(titleHint);
    var re = /<h3>\s*<a name="(\d+)">([\s\S]*?)<\/a>\s*<\/h3>/gi;
    var m;
    while ((m = re.exec(block)) !== null) {
      var label = trim(stripTags(m[2]).replace(/^\d+\.\s*/, ""));
      if (norm(label) === want) {
        heading = m;
        break;
      }
    }
  }
  if (!heading) {
    return "";
  }
  var after = block.slice(heading.index + heading[0].length);
  var stop = after.search(/<h3>\s*<a name="/i);
  if (stop < 0) {
    stop = after.search(/<div class="(thanks|note)"/i);
  }
  if (stop < 0) {
    stop = after.search(/<\/div>/i);
  }
  if (stop >= 0) {
    after = after.slice(0, stop);
  }
  var text = stripTags(after);
  text = text.replace(/(?:^|\n)thanks to [^\n]+$/gi, "");
  text = trim(text);
  return text;
}

function fetch(fetch_url, query) {
  var url = trim(fetch_url);
  var track = "";
  var hash = url.indexOf("#");
  if (hash >= 0) {
    track = url.slice(hash + 1);
    url = url.slice(0, hash);
  }
  if (!url) {
    throw new Error("missing darklyrics url");
  }
  var res = get(url);
  if (isMissingPage(res)) {
    throw new Error("http " + (res && res.status));
  }
  var text = extractTrack(res.text, track, query && query.title);
  if (!text) {
    throw new Error("no lyrics");
  }
  return { synced: "", plain: text, tlyric: "" };
}

function search(query) {
  var artist = trim(query.artist);
  var title = trim(query.title);
  var hits = [];
  var q = trim(artist + " " + title);
  if (q) {
    try {
      var searched = get(kHost + "/search?q=" + encodeURIComponent(q));
      if (httpOk(searched) && !isMissingPage(searched)) {
        hits = parseSearchHits(searched.text);
      }
    } catch (e) {}
  }
  if (hits.length > 0) {
    var ranked = rankHits(hits, query);
    return ranked.length ? ranked : hits.slice(0, 8);
  }
  if (!artist) {
    return [];
  }
  var html = loadBandPage(artist);
  if (!html) {
    return [];
  }
  var band = parseBandName(html) || primaryArtist(artist);
  var songs = parseBandSongs(html, band);
  return rankHits(songs, query);
}
