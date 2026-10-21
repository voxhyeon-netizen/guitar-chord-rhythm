/* Library lives in songs/ as real files; settings live in localStorage.
   When the local server is running the page can write songs back to the folder. */
(function (global) {
  const SETTINGS_KEY = 'gchord.settings.v1';
  const BEST_KEY = 'gchord.best.v1';
  const MANIFEST_URL = 'songs/songs.json';

  const DEFAULT_SETTINGS = {
    scrollSec: 2.6,      // travel time from top of lane to judge line
    earlyWindow: 0.7,    // how long before the beat a note can be judged
    lateWindow: 0.55,    // grace period after the beat
    autoMiss: true,      // unjudged notes become 실패 automatically
    showDiagram: true,
    countInBeats: 4,
    keyGood: 'KeyX',
    keySoso: 'KeyZ',
    keyMiss: 'KeyC',
  };

  /* 난이도 — 수업 중에 하나씩 만지지 않고 한 번에 맞춥니다.
     쉬움: 코드가 천천히 내려오고 판정도 넉넉, 안 누르면 그냥 지나감(실패로 안 봄)
     보통: 기본값
     빠름: 익숙해진 반에서 */
  const PRESETS = {
    easy:   { label: '쉬움', scrollSec: 3.4, earlyWindow: 0.9,  lateWindow: 0.7,  autoMiss: false },
    normal: { label: '보통', scrollSec: 2.6, earlyWindow: 0.7,  lateWindow: 0.55, autoMiss: true },
    fast:   { label: '빠름', scrollSec: 1.8, earlyWindow: 0.45, lateWindow: 0.35, autoMiss: true },
  };

  let songs = [];
  let writable = false;

  /* ---------- settings ---------- */
  function getSettings() {
    let s = {};
    try {
      s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    } catch (e) { s = {}; }
    const out = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
      out[k] = s[k] != null ? s[k] : DEFAULT_SETTINGS[k];
    });
    return out;
  }

  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return getSettings();
    const cur = getSettings();
    ['scrollSec', 'earlyWindow', 'lateWindow', 'autoMiss'].forEach(function (k) { cur[k] = p[k]; });
    saveSettings(cur);
    return cur;
  }

  /* 지금 설정이 어느 난이도인지 — 하나라도 다르면 '직접 맞춤' */
  function currentPreset() {
    const cur = getSettings();
    const hit = Object.keys(PRESETS).filter(function (name) {
      const p = PRESETS[name];
      return ['scrollSec', 'earlyWindow', 'lateWindow', 'autoMiss'].every(function (k) {
        return typeof p[k] === 'boolean' ? p[k] === !!cur[k] : Math.abs(p[k] - cur[k]) < 0.001;
      });
    });
    return hit[0] || '';
  }

  /* ---------- 최고 기록 ----------
     이 기기(브라우저)에만 저장됩니다. 곡은 폴더를 따라다니지만 기록은 따라가지 않습니다. */
  function allBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function getBest(songId) {
    const b = allBest()[songId];
    return b && typeof b.score === 'number' ? b : null;
  }

  /* 점수가 올랐을 때만 덮어씁니다. 새 기록이면 true */
  function saveBest(songId, res) {
    const prev = getBest(songId);
    if (prev && prev.score >= res.score) return false;
    const all = allBest();
    all[songId] = {
      score: res.score,
      acc: res.acc,
      maxCombo: res.maxCombo,
      date: new Date().toISOString().slice(0, 10),
    };
    try { localStorage.setItem(BEST_KEY, JSON.stringify(all)); } catch (e) { return false; }
    return true;
  }

  /* ---------- library ---------- */
  function loadLibrary() {
    return fetch(MANIFEST_URL, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { songs: [] }; })
      .catch(function () { return { songs: [] }; })
      .then(function (data) {
        songs = (data && Array.isArray(data.songs) ? data.songs : []).map(normalize);
        return songs;
      });
  }

  function normalize(s) {
    return {
      id: s.id,
      title: s.title || '제목 없음',
      audio: s.audio || '',
      bpm: s.bpm || 90,
      offset: s.offset || 0,
      beatsPerBar: s.beatsPerBar || 4,
      snap: s.snap || '1',
      duration: s.duration || 0,
      updatedAt: s.updatedAt || 0,
      notes: Array.isArray(s.notes) ? s.notes.slice() : [],
    };
  }

  function list() { return songs.slice(); }

  function getSong(id) {
    return songs.filter(function (s) { return s.id === id; })[0] || null;
  }

  function audioUrl(song) {
    if (!song || !song.audio) return null;
    return 'songs/' + encodeURIComponent(song.audio) + '?v=' + (song.updatedAt || 0);
  }

  function newId() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------- server ---------- */
  function ping() {
    return fetch('api/ping', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { writable = !!(d && d.writable); return writable; })
      .catch(function () { writable = false; return false; });
  }

  function canWrite() { return writable; }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(readResult);
  }

  function readResult(r) {
    return r.json().catch(function () { return { ok: false, error: 'bad-response' }; })
      .then(function (d) {
        if (!r.ok || !d.ok) throw new Error((d && d.error) || ('http-' + r.status));
        return d;
      });
  }

  /* Write the song into songs/songs.json. */
  function saveSong(song) {
    song.updatedAt = Date.now();
    const clean = normalize(song);
    clean.updatedAt = song.updatedAt;
    return postJson('api/song', clean).then(function () {
      const i = songs.findIndex(function (s) { return s.id === clean.id; });
      if (i >= 0) songs[i] = clean; else songs.push(clean);
      return clean;
    });
  }

  /* Write the audio file into songs/. */
  function uploadAudio(id, file) {
    const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
    return fetch('api/audio?id=' + encodeURIComponent(id) + '&ext=' + encodeURIComponent(ext), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    }).then(readResult);
  }

  function deleteSong(id) {
    return postJson('api/delete', { id: id }).then(function () {
      songs = songs.filter(function (s) { return s.id !== id; });
    });
  }

  global.GStore = {
    getSettings: getSettings,
    saveSettings: saveSettings,
    defaultSettings: DEFAULT_SETTINGS,
    presets: PRESETS,
    applyPreset: applyPreset,
    currentPreset: currentPreset,
    getBest: getBest,
    saveBest: saveBest,
    loadLibrary: loadLibrary,
    list: list,
    getSong: getSong,
    audioUrl: audioUrl,
    newId: newId,
    ping: ping,
    canWrite: canWrite,
    saveSong: saveSong,
    uploadAudio: uploadAudio,
    deleteSong: deleteSong,
  };
})(window);
