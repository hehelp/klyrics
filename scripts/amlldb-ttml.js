// Community source. AMLL TTML database (amlldb.bikonoo.com).
// Search returns metadata only; fetch downloads the .ttml and leaves it in `synced`.
var klyrics_source = {
  id: "js:amlldb",
  name: "amlldb TTML",
  kind: "lyric",
  version: 1
};

var kBase = "https://amlldb.bikonoo.com";
var kHeaders = {
  Referer: kBase + "/search.html",
  Origin: kBase,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"'
};

function firstText(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (value.length) {
    for (var i = 0; i < value.length; i++) {
      if (value[i]) {
        return String(value[i]);
      }
    }
  }
  return "";
}

function joinNames(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  var names = [];
  for (var i = 0; i < value.length; i++) {
    if (value[i]) {
      names.push(String(value[i]));
    }
  }
  return names.join(" / ");
}

function fetch(fetch_url, query) {
  var file = String(fetch_url || "").replace(/^\s+|\s+$/g, "");
  if (!file) {
    throw new Error("missing ttml file");
  }
  var res = Klyrics.http({
    method: "GET",
    url: kBase + "/raw-lyrics/" + Klyrics.urlEncode(file),
    headers: kHeaders
  });
  var text = String(res.text || "").replace(/^\uFEFF/, "");
  if (res.status < 200 || res.status >= 300 || !text) {
    throw new Error("http " + res.status);
  }
  if (text.indexOf("<tt") < 0 && text.indexOf("<TT") < 0) {
    throw new Error("not ttml");
  }
  return { synced: text, plain: "", tlyric: "" };
}

function search(query) {
  // Site search matches title (or artist) alone. "artist - title" returns nothing.
  var keyword = String(query.title || query.artist || "").replace(/^\s+|\s+$/g, "");
  if (!keyword) {
    return [];
  }
  var res = Klyrics.http({
    method: "POST",
    url: kBase + "/api/search-lyrics",
    headers: {
      Referer: kHeaders.Referer,
      Origin: kHeaders.Origin,
      "User-Agent": kHeaders["User-Agent"],
      "sec-ch-ua": kHeaders["sec-ch-ua"],
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query: keyword, type: "all" })
  });
  if (res.status < 200 || res.status >= 300 || !res.text) {
    return [];
  }
  var list = [];
  try {
    list = JSON.parse(res.text);
  } catch (e) {
    return [];
  }
  if (!list || !list.length) {
    return [];
  }
  var hits = [];
  for (var i = 0; i < list.length && hits.length < 8; i++) {
    var row = list[i];
    var file = firstText(row && (row.file || row.id));
    if (!file) {
      continue;
    }
    hits.push({
      title: firstText(row.title) || firstText(row.titles) || query.title || "",
      artist: firstText(row.artist) || joinNames(row.artists) || query.artist || "",
      album: firstText(row.album) || firstText(row.albums) || "",
      duration: 0,
      fetch_url: file,
      synced: "",
      plain: ""
    });
  }
  return hits;
}
