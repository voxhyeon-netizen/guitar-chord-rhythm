/* 오프라인 캐시 — 한 번 열어두면 인터넷 없이도 연주할 수 있습니다. */
const SHELL = 'gchord-shell-v6';
const MEDIA = 'gchord-media-v1';
const SHELL_FILES = [
  './',
  'index.html',
  'css/style.css?v=6',
  'js/access-config.js?v=6',
  'js/gate.js?v=6',
  'js/chords.js?v=6',
  'js/storage.js?v=6',
  'js/audio.js?v=6',
  'js/editor.js?v=6',
  'js/play.js?v=6',
  'js/main.js?v=6',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) { return c.addAll(SHELL_FILES); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { /* 일부 파일이 없어도 설치는 진행 */ })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL && k !== MEDIA) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') >= 0) return;          // 저장 API는 캐시하지 않음

  const isSong = url.pathname.indexOf('/songs/') >= 0;
  const isManifest = url.pathname.endsWith('songs.json');

  /* 곡 목록은 최신 우선, 안 되면 저장해 둔 것 */
  if (isManifest) {
    e.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(MEDIA).then(function (c) { c.put(stripQuery(url), copy); });
        return res;
      }).catch(function () {
        return caches.match(stripQuery(url)).then(function (hit) {
          return hit || new Response('{"songs":[]}', { headers: { 'Content-Type': 'application/json' } });
        });
      })
    );
    return;
  }

  /* 음원은 저장해 둔 것 우선 (용량이 크니 한 번만 받습니다) */
  if (isSong) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          const copy = res.clone();
          if (res.ok) caches.open(MEDIA).then(function (c) { c.put(req, copy); });
          return res;
        });
      })
    );
    return;
  }

  /* 화면(index.html)은 최신 우선 — 파일을 고쳤을 때 옛날 화면이 남지 않게 */
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        if (res.ok) caches.open(SHELL).then(function (c) { c.put('index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  /* 나머지 화면 파일: 저장해 둔 것 우선, 없으면 받아서 저장 */
  e.respondWith(
    caches.match(req, { ignoreSearch: false }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        const copy = res.clone();
        if (res.ok) caches.open(SHELL).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match('index.html');
      });
    })
  );
});

function stripQuery(url) {
  return url.origin + url.pathname;
}
