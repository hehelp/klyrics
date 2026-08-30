// Community example. Not a built-in source — enable it on the Artwork page.
var klyrics_source = {
  id: "js:deezerart",
  name: "Deezer",
  kind: "art",
  version: 1
};

function pushHit(hits, seen, item) {
  if (!item || !item.url || seen[item.url]) {
    return;
  }
  seen[item.url] = true;
  hits.push(item);
}

function searchArt(query) {
  var hits = [];
  var seen = {};
  var albumQ = ((query.artist || "") + " " + (query.album || query.title || "")).replace(/^\s+|\s+$/g, "");
  if (albumQ) {
    var res = Klyrics.http({
      method: "GET",
      url: "https://api.deezer.com/search/album?q=" + encodeURIComponent(albumQ)
    });
    if (res.status >= 200 && res.status < 300 && res.text) {
      var json = {};
      try {
        json = JSON.parse(res.text);
      } catch (e) {
        json = {};
      }
      var list = json.data || [];
      for (var i = 0; i < list.length && hits.length < 8; i++) {
        var a = list[i];
        pushHit(hits, seen, {
          url: a.cover_xl || a.cover_big || a.cover_medium || "",
          thumb_url: a.cover_medium || a.cover_small || "",
          kind: "album",
          artist: (a.artist && a.artist.name) || query.artist || "",
          album: a.title || query.album || "",
          title: query.title || ""
        });
      }
    }
  }
  if (query.artist) {
    var artistRes = Klyrics.http({
      method: "GET",
      url: "https://api.deezer.com/search/artist?q=" + encodeURIComponent(query.artist)
    });
    if (artistRes.status >= 200 && artistRes.status < 300 && artistRes.text) {
      var artistJson = {};
      try {
        artistJson = JSON.parse(artistRes.text);
      } catch (e) {
        artistJson = {};
      }
      var artists = artistJson.data || [];
      for (var j = 0; j < artists.length && j < 4; j++) {
        var ar = artists[j];
        pushHit(hits, seen, {
          url: ar.picture_xl || ar.picture_big || ar.picture_medium || "",
          thumb_url: ar.picture_medium || ar.picture_small || "",
          kind: "artist",
          artist: ar.name || query.artist || "",
          album: "",
          title: ""
        });
      }
    }
  }
  return hits;
}
