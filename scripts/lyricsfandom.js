// Community source. Plain lyrics from lyrics.fandom.com/ja (歌詞 Wiki). HTML is CF-gated; use MediaWiki API.
var klyrics_source = {
  id: "js:lyricsfandom",
  name: "歌詞 Wiki",
  kind: "lyric",
  version: 1
};

var kApi = "https://lyrics.fandom.com/ja/api.php";
var kHeaders = {
  Referer: "https://lyrics.fandom.com/ja/wiki/%E6%AD%8C%E8%A9%9E_Wiki",
  Accept: "application/json,text/javascript;q=0.9,*/*;q=0.8",
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
  out = out.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ");
  return trim(out.replace(/\s+/g, " "));
}

function capFirst(s) {
  s = trim(s);
  if (!s) {
    return "";
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function primaryArtist(artist) {
  var s = trim(artist).replace(/\s*[(\[][^)\]]*[)\]]\s*/g, " ");
  s = s.split(/\s*(?:,|&|\/|feat\.?|ft\.?|featuring)\s+/i)[0];
  return trim(s);
}

function skipTitle(title) {
  title = trim(title);
  if (!title) {
    return true;
  }
  if (/^(main page|歌詞 wiki)$/i.test(title)) {
    return true;
  }
  return /wiki/i.test(title) && title.indexOf(" - ") < 0;
}

function splitPageTitle(title) {
  var raw = trim(title);
  var dash = raw.indexOf(" - ");
  if (dash < 0) {
    dash = raw.indexOf(":");
    if (dash > 0) {
      return { artist: trim(raw.slice(0, dash)), title: trim(raw.slice(dash + 1)) };
    }
    return { artist: "", title: raw };
  }
  return { artist: trim(raw.slice(0, dash)), title: trim(raw.slice(dash + 3)) };
}

function api(params) {
  var q = [];
  for (var key in params) {
    if (params.hasOwnProperty(key) && params[key] !== undefined && params[key] !== "") {
      q.push(encodeURIComponent(key) + "=" + encodeURIComponent(params[key]));
    }
  }
  var res = Klyrics.http({
    method: "GET",
    url: kApi + "?" + q.join("&"),
    headers: kHeaders
  });
  if (!res || !res.text || res.status < 200 || res.status >= 300) {
    throw new Error("http " + (res && res.status));
  }
  var json = {};
  try {
    json = JSON.parse(res.text);
  } catch (e) {
    throw new Error("bad api json");
  }
  if (json.error) {
    throw new Error(json.error.info || json.error.code || "api error");
  }
  return json;
}

function pageMap(json) {
  return (json.query && json.query.pages) || {};
}

function isPresent(page) {
  return page && page.pageid && !page.missing;
}

function allpages(prefix, limit) {
  if (!trim(prefix)) {
    return [];
  }
  var json = api({
    action: "query",
    list: "allpages",
    apprefix: prefix,
    aplimit: String(limit || 12),
    format: "json"
  });
  return ((json.query && json.query.allpages) || []).map(function (p) {
    return p.title;
  });
}

function prefixesFor(artist, title) {
  var a = primaryArtist(artist);
  var t = trim(title);
  var artists = [];
  if (a) {
    artists.push(a);
    var cap = capFirst(a);
    if (cap !== a) {
      artists.push(cap);
    }
  }
  var out = [];
  var seen = {};
  function add(p) {
    p = trim(p);
    if (p && !seen[p]) {
      seen[p] = true;
      out.push(p);
    }
  }
  for (var i = 0; i < artists.length; i++) {
    if (t) {
      add(artists[i] + " - " + t);
      add(artists[i] + ":" + t);
    }
    add(artists[i] + " - ");
    add(artists[i]);
  }
  if (!a && t) {
    add(t);
  }
  return out;
}

function collectTitles(query) {
  var titles = [];
  var seen = {};
  function add(title) {
    title = trim(title);
    if (!title || skipTitle(title) || seen[title]) {
      return;
    }
    seen[title] = true;
    titles.push(title);
  }
  var guesses = prefixesFor(query.artist, query.title);
  if (guesses.length) {
    try {
      var info = api({
        action: "query",
        titles: guesses.slice(0, 8).join("|"),
        redirects: "1",
        format: "json"
      });
      var pages = pageMap(info);
      for (var id in pages) {
        if (pages.hasOwnProperty(id) && isPresent(pages[id])) {
          add(pages[id].title);
        }
      }
    } catch (e) {}
  }
  for (var i = 0; i < guesses.length && titles.length < 16; i++) {
    try {
      var list = allpages(guesses[i], 12);
      for (var j = 0; j < list.length; j++) {
        add(list[j]);
      }
    } catch (e) {}
    if (titles.length >= 8 && i >= 1) {
      break;
    }
  }
  return titles;
}

function titleScore(wantTitle, haveTitle, wantArtist, haveArtist) {
  var want = norm(wantTitle);
  var have = norm(haveTitle);
  if (!want || !have) {
    return 0;
  }
  var score = 0;
  if (want === have) {
    score = 100;
  } else if (have.indexOf(want) >= 0 || want.indexOf(have) >= 0) {
    score = 60;
  } else {
    return 0;
  }
  var wa = norm(wantArtist);
  var ha = norm(haveArtist);
  if (wa && ha) {
    if (wa === ha) {
      score += 24;
    } else if (ha.indexOf(wa) >= 0 || wa.indexOf(ha) >= 0) {
      score += 10;
    }
  }
  return score;
}

function extractLyrics(wikitext) {
  var out = String(wikitext || "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/\[\[Category:[^\]]*\]\]/gi, "");
  out = out.replace(/\{\{[^}]*\}\}/g, "");
  out = out.replace(/\[\[([^|\]]*\|)?([^\]]+)\]\]/g, "$2");
  return stripTags(out);
}

function wikitextOf(title) {
  var json = api({
    action: "query",
    titles: title,
    prop: "revisions",
    rvprop: "content",
    rvslots: "main",
    redirects: "1",
    format: "json"
  });
  var pages = pageMap(json);
  for (var id in pages) {
    if (!pages.hasOwnProperty(id) || !isPresent(pages[id])) {
      continue;
    }
    var revs = pages[id].revisions || [];
    if (!revs.length) {
      return "";
    }
    var slot = (revs[0].slots && revs[0].slots.main) || {};
    return slot["*"] || revs[0]["*"] || "";
  }
  return "";
}

function fetch(fetch_url, query) {
  var title = trim(fetch_url) || trim(primaryArtist(query.artist) + " - " + trim(query.title));
  if (!title) {
    throw new Error("missing lyrics fandom title");
  }
  var text = extractLyrics(wikitextOf(title));
  if (!text) {
    throw new Error("no lyrics");
  }
  return { synced: "", plain: text, tlyric: "" };
}

function search(query) {
  var titles = collectTitles(query);
  var scored = [];
  for (var i = 0; i < titles.length; i++) {
    var parts = splitPageTitle(titles[i]);
    var score = titleScore(query.title, parts.title, query.artist, parts.artist);
    if (!score && titles.length <= 3) {
      score = 40;
    }
    if (score > 0) {
      scored.push({
        score: score,
        hit: {
          title: parts.title || titles[i],
          artist: parts.artist,
          album: "",
          duration: 0,
          fetch_url: titles[i]
        }
      });
    }
  }
  scored.sort(function (a, b) {
    return b.score - a.score;
  });
  var out = [];
  for (var j = 0; j < scored.length && out.length < 8; j++) {
    out.push(scored[j].hit);
  }
  return out;
}
