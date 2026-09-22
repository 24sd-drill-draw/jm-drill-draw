// Offline copy of Film Room and Drill Draw.
//
// Network first, always: online, every file comes fresh from the site, so an
// update lands exactly as it did before this existed, and the fresh copy
// replaces the saved one. Only when the network fails (a plane, a rink with no
// wifi) or hangs past a few seconds does the saved copy answer instead.
//
// Nothing here touches the drills, marks or reels: those live in the
// browser's own storage and never went over the network. Video is never
// stored: clips are opened from disk and are not requests this worker sees.

var CACHE = 'jmdd-offline-v1';
var CORE = [
  './', 'index.html', 'film-room.html', 'rink-lab.html',
  'app.js', 'animate-ui.js', 'animate.css', 'style.css',
  'images/logo-krakenS.png', 'images/logo-youthS.png', 'images/logo-anchorage.png',
  'images/logo-anchorLight.png', 'images/logo-anchorNavy.png',
  'images/ref-cones.png', 'images/ref-flow.png', 'images/ref-stations.png', 'images/ref-swing.png'
];
var WAIT_MS = 4000;   // rink wifi that connects but never answers

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // one missing file must not sink the rest
    return Promise.all(CORE.map(function (u) {
      return fetch(u, { cache: 'reload' }).then(function (r) { if (r.ok) return c.put(u, r); }).catch(function () { });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.has('range')) return;              // video byte ranges
  if (url.pathname.indexOf('/test-media/') >= 0) return;

  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function fromCache() {
      if (done) return;
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (done) return;
        if (hit) { done = true; resolve(hit); }
      });
    }
    var timer = setTimeout(fromCache, WAIT_MS);
    fetch(req).then(function (res) {
      clearTimeout(timer);
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        // saved under the plain address so a new ?v= stamp replaces the old copy
        var key = url.origin + url.pathname;
        caches.open(CACHE).then(function (c) { c.put(key, copy); });
      }
      if (!done) { done = true; resolve(res); }
    }).catch(function () {
      clearTimeout(timer);
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (done) return;
        done = true;
        resolve(hit || new Response('Offline, and this page has not been saved yet. Open it once with internet.',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
      });
    });
  }));
});
