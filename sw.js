/* 오프라인 캐시 — 한 번 열어두면 인터넷 없이도 연주할 수 있습니다. */
const SHELL = 'gchord-shell-v36';
const MEDIA = 'gchord-media-v2';   // v1 에 잘못 저장된 음원이 있어 새로 시작합니다
const SHELL_FILES = [
  './',
  'index.html',
  'css/style.css?v=36',
  'js/access-config.js?v=36',
  'js/gate.js?v=36',
  'js/chords.js?v=36',
  'js/strum.js?v=36',
  'js/storage.js?v=36',
  'js/audio.js?v=36',
  'js/editor.js?v=36',
  'js/mic.js?v=36',
  'js/play.js?v=36',
  'js/main.js?v=36',
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

  /* 음원 — 인터넷이 되면 서비스워커를 거치지 않고 그대로 받아오게 둡니다.
     아이패드(사파리)는 음원을 구간으로 나눠 받는데, 서비스워커가 끼어들면
     앞부분만 읽고 곡 길이를 0.00초쯤으로 잘못 아는 일이 있습니다.
     그러면 틀자마자 '끝났다' 가 되어 게임이 바로 끝납니다.
     인터넷이 안 될 때만 저장해 둔 것을 씁니다. */
  if (isSong) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && (res.ok || res.status === 206)) return res;
        return handleSong(req);
      }).catch(function () { return handleSong(req); })
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

/* ---------- 음원 ----------
   아이패드(사파리)는 음원을 통째로 받지 않고 '몇 번째 바이트부터 몇 번째까지' 로 나눠 달라고 합니다(Range).
   그런데 저장해 둔 파일을 그냥 통째로 돌려주면, 사파리가 그것을 곡 전체로 잘못 읽어
   노래를 틀자마자 끝난 것으로 처리하는 일이 있습니다.
   그래서 달라고 한 구간만 잘라 206 으로 돌려줍니다. 맥에서는 원래도 문제가 없었습니다. */
async function handleSong(req) {
  const url = new URL(req.url);
  const key = stripQuery(url);
  const cache = await caches.open(MEDIA);
  let hit = await cache.match(key, { ignoreSearch: true });

  if (!hit) {
    /* 구간 요청이 와도 파일 전체를 받아 저장합니다 — 잘린 응답(206)은 캐시에 넣을 수 없습니다 */
    let full;
    try { full = await fetch(key, { cache: 'no-store' }); } catch (err) { full = null; }
    if (!full || !full.ok) return fetch(req);
    try { await cache.put(key, full.clone()); } catch (err) { /* 저장 못 해도 재생은 계속 */ }
    hit = full;
  }
  return rangeResponse(hit, req);
}

async function rangeResponse(res, req) {
  const range = req.headers.get('range');
  if (!range) return res;

  const buf = await res.clone().arrayBuffer();
  const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return res;

  let start = m[1] ? parseInt(m[1], 10) : NaN;
  let end = m[2] ? parseInt(m[2], 10) : NaN;
  if (isNaN(start)) {                 // 'bytes=-500' = 끝에서 500바이트
    const tail = isNaN(end) ? size : end;
    start = Math.max(0, size - tail);
    end = size - 1;
  }
  if (isNaN(end) || end >= size) end = size - 1;
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }

  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
