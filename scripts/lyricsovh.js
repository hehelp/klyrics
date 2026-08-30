// Community example. Not a built-in source — enable it on the Search page.
// lyrics.ovh has little Chinese coverage; search only keeps songs that actually fetch.
var klyrics_source = {
  id: "js:lyricsovh",
  name: "lyrics.ovh",
  kind: "lyric",
  version: 1
};

function fetch(fetch_url, query) {
  var parts = String(fetch_url || "").split("\t");
  var artist = parts[0] || query.artist || "";
  var title = parts[1] || query.title || "";
  if (!artist && !title) {
    throw new Error("missing artist/title");
  }
  var res = Klyrics.http({
    method: "GET",
    url: "https://api.lyrics.ovh/v1/" + encodeURIComponent(artist) + "/" + encodeURIComponent(title)
  });
  var json = {};
  try {
    json = JSON.parse(res.text || "{}");
  } catch (e) {
    throw new Error("bad lyric response");
  }
  if (res.status < 200 || res.status >= 300 || json.error) {
    throw new Error(json.error || ("http " + res.status));
  }
  var text = json.lyrics || "";
  if (!text) {
    throw new Error("no lyrics");
  }
  return { synced: "", plain: text, tlyric: "" };
}

function search(query) {
  var q = ((query.artist || "") + " " + (query.title || "")).replace(/^\s+|\s+$/g, "");
  if (!q) {
    return [];
  }
  var res = Klyrics.http({
    method: "GET",
    url: "https://api.lyrics.ovh/suggest/" + encodeURIComponent(q)
  });
  if (res.status < 200 || res.status >= 300 || !res.text) {
    return [];
  }
  var json = JSON.parse(res.text);
  var list = json.data || [];
  var hits = [];
  for (var i = 0; i < list.length && hits.length < 5; i++) {
    var s = list[i];
    var artist = (s.artist && s.artist.name) || "";
    var title = s.title || "";
    var key = artist + "\t" + title;
    var lyric;
    try {
      lyric = fetch(key, query);
    } catch (e) {
      continue;
    }
    hits.push({
      title: title,
      artist: artist,
      album: (s.album && s.album.title) || "",
      duration: s.duration || 0,
      fetch_url: key,
      image_url: (s.album && s.album.cover) || "",
      synced: lyric.synced || "",
      plain: lyric.plain || ""
    });
  }
  return hits;
}
