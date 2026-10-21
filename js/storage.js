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
    autoMiss: true,      // (직접 판정일 때) 안 누르고 지나가면 실패로
    judgeMode: 'autoGood',   // autoGood = 기본 성공 · 리모컨을 누르면 실패 / manual = 직접 판정
    levelAutoSettings: true, // 난이도에 맞춰 낙하 속도·판정 구간을 자동으로
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

  /* 난이도별 채보 — 한 곡에 쉬움/보통/어려움 버전을 둡니다 */
  const LEVELS = [
    { id: 'easy',   label: '쉬움' },
    { id: 'normal', label: '보통' },
    { id: 'hard',   label: '어려움' },
  ];
  const LEVEL_IDS = LEVELS.map(function (l) { return l.id; });

  /* 난이도마다 어울리는 속도·판정 — 곡 카드에서 난이도를 고르면 같이 적용됩니다 */
  const LEVEL_PRESET = { easy: 'easy', normal: 'normal', hard: 'fast' };

  function settingsForLevel(level) {
    const cur = getSettings();
    if (!cur.levelAutoSettings) return {};
    const p = PRESETS[LEVEL_PRESET[level]];
    if (!p) return {};
    const out = {};
    ['scrollSec', 'earlyWindow', 'lateWindow', 'autoMiss'].forEach(function (k) { out[k] = p[k]; });
    return out;
  }

  function levelSpeedLabel(level) {
    return level === 'easy' ? '천천히' : (level === 'hard' ? '빠르게' : '기본 속도');
  }

  function levelLabel(id) {
    for (let i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return LEVELS[i].label;
    return id;
  }

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

  /* 난이도마다 따로 기록합니다 (보통은 예전 기록을 그대로 씁니다) */
  function bestKey(songId, level) {
    return (!level || level === 'normal') ? songId : songId + ':' + level;
  }

  function getBest(songId, level) {
    const b = allBest()[bestKey(songId, level)];
    return b && typeof b.score === 'number' ? b : null;
  }

  /* 점수가 올랐을 때만 덮어씁니다. 새 기록이면 true */
  function saveBest(songId, level, res) {
    if (res === undefined) { res = level; level = 'normal'; }   // 예전 호출 방식도 받아줍니다
    if (!res || !res.score) return false;              // 0점은 기록하지 않습니다
    const prev = getBest(songId, level);
    if (prev && prev.score >= res.score) return false;
    const all = allBest();
    all[bestKey(songId, level)] = {
      score: res.score,
      acc: res.acc,
      maxCombo: res.maxCombo,
      date: new Date().toISOString().slice(0, 10),
    };
    try { localStorage.setItem(BEST_KEY, JSON.stringify(all)); } catch (e) { return false; }
    return true;
  }

  /* ---------- library ---------- */
  function loadLibrary(fresh) {
    /* fresh=true 면 캐시를 확실히 건너뛰고 새로 받습니다 (아이패드에서 곡이 안 보일 때) */
    const url = MANIFEST_URL + (fresh ? '?t=' + Date.now() : '');
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { songs: [] }; })
      .catch(function () { return { songs: [] }; })
      .then(function (data) {
        songs = (data && Array.isArray(data.songs) ? data.songs : []).map(normalize);
        return songs;
      });
  }

  function normChart(c) {
    c = c || {};
    return {
      strum: c.strum || '4',
      strumChanges: Array.isArray(c.strumChanges)
        ? c.strumChanges.filter(function (x) { return x && typeof x.t === 'number' && x.strum; })
            .map(function (x) { return { t: x.t, strum: x.strum }; })
            .sort(function (a, b) { return a.t - b.t; })
        : [],
      notes: (Array.isArray(c.notes) ? c.notes : [])
        .filter(function (n) { return n && typeof n.t === 'number' && n.chord; })
        .map(function (n) {
          const out = { t: n.t, chord: n.chord };
          if (n.strum) out.strum = n.strum;
          return out;
        })
        .sort(function (a, b) { return a.t - b.t; }),
    };
  }

  function normalize(s) {
    const out = {
      id: s.id,
      title: s.title || '제목 없음',
      audio: s.audio || '',
      bpm: s.bpm || 90,
      offset: s.offset || 0,
      beatsPerBar: s.beatsPerBar || 4,
      snap: s.snap || '1',
      duration: s.duration || 0,
      updatedAt: s.updatedAt || 0,
      charts: {},
    };

    const src = (s.charts && typeof s.charts === 'object') ? s.charts : null;
    if (src) {
      LEVEL_IDS.forEach(function (id) {
        if (src[id] && Array.isArray(src[id].notes) && src[id].notes.length) out.charts[id] = normChart(src[id]);
      });
    }
    /* 예전 곡(난이도 없이 만든 것)은 '보통' 으로 옮깁니다 */
    if (!Object.keys(out.charts).length) {
      out.charts.normal = normChart({ notes: s.notes, strum: s.strum, strumChanges: s.strumChanges });
    }

    /* 예전 버전 앱도 읽을 수 있도록 기본 채보를 바깥에도 남겨둡니다 */
    const def = out.charts.normal || out.charts.hard || out.charts.easy;
    out.notes = def.notes.slice();
    out.strum = def.strum;
    out.strumChanges = def.strumChanges.slice();
    return out;
  }

  /* 어떤 난이도가 들어 있는지 (쉬움 → 보통 → 어려움 순서) */
  function levelsOf(song) {
    return LEVEL_IDS.filter(function (id) {
      return song && song.charts && song.charts[id] && song.charts[id].notes.length;
    });
  }

  /* 그 난이도로 연주할 수 있게 합친 곡 정보 */
  function songAtLevel(song, level) {
    const c = song.charts && song.charts[level];
    if (!c) return song;
    const out = {};
    Object.keys(song).forEach(function (k) { if (k !== 'charts') out[k] = song[k]; });
    out.notes = c.notes;
    out.strum = c.strum;
    out.strumChanges = c.strumChanges;
    out.level = level;
    return out;
  }

  /* 있는 채보에서 다른 난이도를 만들어 줍니다 */
  const STRUM_ORDER = ['1', '2', '4', '8s', '8'];

  /* 쉬움은 너무 촘촘한 주법만 눌러주고, 어려움은 8비트로 올립니다 */
  function levelStrum(id, toLevel) {
    if (id === 'w') return 'w';                       // 왈츠는 그대로
    const i = STRUM_ORDER.indexOf(id === '8c' ? '8' : id);
    if (toLevel === 'easy') return i > 2 ? '4' : (id || '4');
    if (toLevel === 'hard') return i < 4 ? '8' : id;
    return id || '4';
  }

  /* 가장 촘촘한 채보 — 다른 난이도는 항상 이걸 기준으로 만듭니다 */
  function richestLevel(song) {
    let best = null;
    LEVEL_IDS.forEach(function (id) {
      const c = song.charts && song.charts[id];
      if (c && c.notes.length && (!best || c.notes.length > song.charts[best].notes.length)) best = id;
    });
    return best;
  }

  function deriveChart(song, fromLevel, toLevel) {
    const src = song.charts && song.charts[fromLevel];
    if (!src || !src.notes.length) return null;
    const spb = 60 / (song.bpm || 90);
    const bar = spb * (song.beatsPerBar || 4);
    const off = song.offset || 0;
    const bucket = toLevel === 'easy' ? bar : (toLevel === 'normal' ? bar / 2 : 0);

    let notes = src.notes.slice();
    if (bucket > 0) {
      const kept = [];
      let lastBucket = null;
      notes.forEach(function (n) {
        const b = Math.floor((n.t - off) / bucket + 1e-6);
        if (b !== lastBucket) { kept.push(n); lastBucket = b; }
      });
      notes = kept;
    }
    /* 같은 코드가 연달아 나오면 하나로 */
    const out = [];
    notes.forEach(function (n) {
      const prev = out[out.length - 1];
      if (prev && prev.chord === n.chord && toLevel === 'easy') return;
      out.push({ t: n.t, chord: n.chord });
    });

    return {
      notes: out,
      strum: levelStrum(src.strum, toLevel),
      strumChanges: (src.strumChanges || []).map(function (c) {
        return { t: c.t, strum: levelStrum(c.strum, toLevel) };
      }),
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
    LEVELS: LEVELS,
    levelLabel: levelLabel,
    levelsOf: levelsOf,
    settingsForLevel: settingsForLevel,
    levelSpeedLabel: levelSpeedLabel,
    songAtLevel: songAtLevel,
    deriveChart: deriveChart,
    richestLevel: richestLevel,
    normChart: normChart,
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
