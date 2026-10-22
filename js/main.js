/* Screen routing, song library (songs/ folder), settings. */
(function (global) {
  let el = {};
  let loadedAudioId = null;
  let audioPick = null;     // pending <input type=file> handler
  let lastPlayed = null;
  let curScreen = 'home';
  let remoteCheck = false;
  let toastTimer = 0;

  function $(id) { return document.getElementById(id); }

  document.addEventListener('DOMContentLoaded', function () {
    el = {
      home: $('screen-home'),
      editor: $('screen-editor'),
      play: $('screen-play'),
      result: $('screen-result'),
      list: $('songList'),
      addSong: $('btnAddSong'),
      importChart: $('btnImportChart'),
      settings: $('btnSettings'),
      fileAudio: $('fileAudio'),
      fileChart: $('fileChart'),
      toast: $('toast'),
      settingsOverlay: $('settingsOverlay'),
      mode: $('modeNote'),
      offlineBtn: $('btnOffline'),
      offlineState: $('offlineState'),
      guide: $('btnGuide'),
      sound: $('btnSound'),
      refresh: $('btnRefresh'),
      remote: $('btnRemote'),
    };

    GEditor.init({
      onBack: function () { show('home'); renderList(); },
      onSave: saveSongFromEditor,
      onPlaytest: function (song, lvl) { startPlay(song, lvl); },
      onReplaceAudio: function (song) {
        pickAudioFor(song, function () {
          GEditor.refreshAudio();
          toast('mp3를 바꿨어요.');
        });
      },
    });

    GPlay.init({
      onExit: function () { show('home'); renderList(); },
      onFinish: showResult,
    });

    el.addSong.addEventListener('click', function () { pickAudioFor(null, null); });
    el.importChart.addEventListener('click', function () { el.fileChart.click(); });
    el.settings.addEventListener('click', openSettings);
    el.sound.addEventListener('click', soundTest);
    el.refresh.addEventListener('click', function () { refreshLibrary(true); });
    el.remote.addEventListener('click', toggleRemoteCheck);
    el.fileAudio.addEventListener('change', onAudioChosen);
    el.fileChart.addEventListener('change', onChartChosen);

    $('resAgain').addEventListener('click', function () {
      if (lastPlayed) startPlay(lastPlayed);
    });
    $('resHome').addEventListener('click', function () { show('home'); renderList(); });

    document.addEventListener('keydown', onRemoteCheckKey);
    document.addEventListener('keydown', onResultKey);

    applyTheme(GStore.getSettings().theme);
    unlockAudioOnFirstTouch();
    setupOffline();
    watchForeground();
    wireSettings();
    show('home');

    GStore.ping().then(function () { return GStore.loadLibrary(); }).then(function () {
      renderList();
      updateMode();
      reportOffline();
    });
  });

  function applyTheme(theme) {
    document.documentElement.classList.toggle('bright', theme === 'bright');
  }

  /* 아이패드는 화면을 누르는 순간에만 오디오 잠금이 풀립니다. 처음 몇 번은 계속 시도합니다. */
  function unlockAudioOnFirstTouch() {
    let tries = 0;
    const unlock = function () {
      GAudio.unlock();
      tries++;
      if (GAudio.state() === 'running' || tries > 5) {
        document.removeEventListener('pointerdown', unlock, true);
        document.removeEventListener('touchstart', unlock, true);
      }
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('touchstart', unlock, true);
  }

  function soundTest() {
    GAudio.testTone();
    setTimeout(function () {
      const st = GAudio.state();
      if (st === 'running') {
        toast('"딩동댕" 소리가 들렸나요? 안 들리면 아이패드 음량과 무음 모드를 확인하세요.');
      } else {
        toast('소리가 아직 잠겨 있어요(' + st + '). 화면을 한 번 더 누른 뒤 다시 눌러보세요.');
      }
    }, 700);
  }

  /* 맥에서 새로 올린 곡을 받아옵니다.
     아이패드는 앱을 켜 둔 채로 두면 예전 목록이 남아 있어서, 돌아올 때마다 조용히 다시 받습니다. */
  let refreshing = false;
  function refreshLibrary(loud) {
    if (refreshing) return Promise.resolve();
    refreshing = true;
    const beforeCount = GStore.list().length;
    if (loud) toast('곡 목록을 받아오는 중…');
    return GStore.loadLibrary(true).then(function (list) {
      if (document.getElementById('screen-home').classList.contains('active')) renderList();
      if (loud) {
        toast(list.length === beforeCount
          ? '곡 ' + list.length + '개 — 이미 최신이에요.'
          : '곡 ' + list.length + '개를 받았어요. (전 ' + beforeCount + '개)');
      }
      return list;
    }).catch(function () {
      if (loud) toast('받아오지 못했어요. 인터넷 연결을 확인해 주세요.');
    }).then(function (r) { refreshing = false; return r; });
  }

  /* 앱으로 돌아올 때 자동으로 다시 받기 */
  function watchForeground() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (!document.getElementById('screen-home').classList.contains('active')) return;
      refreshLibrary(false);
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update(); }).catch(function () {});
      }
    });
  }

  /* ---------- 오프라인 저장 ---------- */
  const MEDIA_CACHE = 'gchord-media-v1';

  function setupOffline() {
    /* 웹에 올렸을 때(https)만 오프라인 저장을 씁니다.
       맥에서 채보할 때는 캐시가 끼어들면 수정이 바로 안 보일 수 있어 끕니다. */
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
    navigator.serviceWorker.register('sw.js').catch(function () { /* ignore */ });
    el.offlineBtn.classList.remove('hidden');
    el.offlineBtn.addEventListener('click', cacheEverything);
    reportOffline();
  }

  function reportOffline() {
    if (!window.caches || el.offlineBtn.classList.contains('hidden')) return;
    caches.open(MEDIA_CACHE).then(function (c) { return c.keys(); }).then(function (keys) {
      const songs = keys.filter(function (r) { return !/songs\.json$/.test(r.url); }).length;
      el.offlineState.classList.remove('hidden');
      el.offlineState.innerHTML = songs
        ? '오프라인 저장됨 — <b>' + songs + '곡</b> · 인터넷 없이도 연주할 수 있어요'
        : '아직 오프라인 저장을 하지 않았어요. 수업 전에 <b>⬇ 오프라인 저장</b>을 눌러두세요.';
    }).catch(function () { /* ignore */ });
  }

  function cacheEverything() {
    if (!window.caches) return;
    el.offlineBtn.disabled = true;
    el.offlineState.classList.remove('hidden');
    el.offlineState.textContent = '최신 곡 목록을 먼저 받는 중…';
    refreshLibrary(false).then(doCacheEverything);
  }

  function doCacheEverything() {
    el.offlineState.classList.remove('hidden');
    el.offlineState.textContent = '저장하는 중…';

    const urls = GStore.list().map(function (s) { return GStore.audioUrl(s); })
      .filter(Boolean).concat(['songs/songs.json']);

    caches.open(MEDIA_CACHE).then(function (cache) {
      let done = 0;
      return Promise.all(urls.map(function (u) {
        return cache.add(u).then(function () {
          done++;
          el.offlineState.textContent = '저장하는 중… ' + done + '/' + urls.length;
        }).catch(function () { /* 한 곡이 실패해도 나머지는 계속 */ });
      }));
    }).then(function () {
      toast('이 기기에 저장했어요. 이제 인터넷 없이도 열려요.');
      reportOffline();
    }).catch(function () {
      el.offlineState.textContent = '저장하지 못했어요.';
    }).then(function () {
      el.offlineBtn.disabled = false;
    });
  }

  /* ---------- screens ---------- */
  function show(name) {
    curScreen = name;
    ['home', 'editor', 'play', 'result'].forEach(function (k) {
      el[k].classList.toggle('active', k === name);
    });
    if (name !== 'editor') GEditor.close();
  }

  /* 리모컨마다 보내는 신호가 다릅니다. 선생님이 직접 눌러보고 확인할 수 있게 합니다. */
  function toggleRemoteCheck() {
    remoteCheck = !remoteCheck;
    el.remote.classList.toggle('btn-primary', remoteCheck);
    toast(remoteCheck
      ? '리모컨 버튼을 하나씩 눌러보세요. 무슨 신호인지 알려줍니다.'
      : '리모컨 확인을 껐어요.');
  }

  function onRemoteCheckKey(e) {
    if (!remoteCheck || curScreen !== 'home') return;
    e.preventDefault();
    const label = GPlay.remoteLabel(e.code, GStore.getSettings().judgeMode === 'autoGood');
    toast(label
      ? '이 버튼 = ' + label + '  (' + e.code + ')'
      : '이 버튼은 쓰지 않는 신호예요 (' + e.code + ')');
  }

  /* 결과 화면도 리모컨으로 넘길 수 있게 — 맥 앞으로 돌아오지 않아도 다음 곡을 이어서 합니다.
     다음(▶) = 다시 연주 · 이전(◀) = 목록으로 */
  function onResultKey(e) {
    if (curScreen !== 'result') return;
    const next = ['PageDown', 'ArrowRight', 'ArrowDown', 'Enter', 'F5'];
    const back = ['PageUp', 'ArrowLeft', 'ArrowUp'];
    if (next.indexOf(e.code) >= 0) {
      e.preventDefault();
      if (lastPlayed) startPlay(lastPlayed);
    } else if (back.indexOf(e.code) >= 0) {
      e.preventDefault();
      show('home');
      renderList();
    }
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2600);
  }

  /* 읽기 전용 = 곡을 폴더에 쓸 수 없는 환경 (아이패드/웹에 올린 경우) */
  function updateMode() {
    const rw = GStore.canWrite();
    el.mode.classList.toggle('hidden', rw);
    el.addSong.classList.toggle('hidden', !rw);
    el.importChart.classList.toggle('hidden', !rw);
    el.guide.classList.toggle('hidden', !rw);   // 사용법은 맥에서 채보할 때만 필요
  }

  /* ---------- song list ---------- */
  function renderList() {
    const songs = GStore.list().sort(function (a, b) {
      return (a.title || '').localeCompare(b.title || '', 'ko');
    });
    const rw = GStore.canWrite();
    el.list.innerHTML = '';

    if (!songs.length) {
      const d = document.createElement('div');
      d.className = 'empty-note';
      d.innerHTML = rw
        ? '아직 곡이 없어요.<br><b>＋ 새 곡 추가</b>를 눌러 mp3를 고르고,<br>채보 화면에서 코드를 찍어보세요.'
        : '이 기기에는 곡이 없어요.<br>맥에서 곡을 만든 뒤 <b>폴더를 통째로</b> 옮기거나 웹에 올려주세요.';
      el.list.appendChild(d);
      return;
    }

    songs.forEach(function (song) {
      const levels = GStore.levelsOf(song);
      const chords = [];
      (song.notes || []).forEach(function (n) { if (chords.indexOf(n.chord) < 0) chords.push(n.chord); });

      const card = document.createElement('div');
      card.className = 'song-card';

      const main = document.createElement('div');
      main.className = 'sc-main';
      main.innerHTML = '<h3>' + escapeHtml(song.title) + '</h3>' +
        '<div class="sc-meta">' +
        '<span>' + fmtDur(song.duration || 0) + '</span>' +
        '<span>BPM ' + (song.bpm || '-') + '</span>' +
        (song.audio ? '' : '<span class="warn">mp3 없음</span>') +
        '</div>';
      const chipRow = document.createElement('div');
      chipRow.className = 'sc-chords';
      /* 연주 화면의 줄 색과 똑같이 — 한 곡 안에서 색이 겹치지 않게 */
      const chipCols = GChords.distinctColors(chords.map(function (c) {
        return GChords.shape(c) ? c : 'C';
      }));
      chords.slice(0, 8).forEach(function (c, i) {
        const s = document.createElement('span');
        s.className = 'chip';
        s.textContent = c;
        s.style.background = (chipCols[i] || GChords.colorOf(c)).main;
        s.style.color = '#10203a';
        chipRow.appendChild(s);
      });
      main.appendChild(chipRow);

      /* 난이도마다 한 줄씩 — 코드 수와 주법, 최고 기록을 같이 보여줍니다 */
      const levelBox = document.createElement('div');
      levelBox.className = 'sc-levels';
      levels.forEach(function (lv) {
        const chart = song.charts[lv];
        const best = GStore.getBest(song.id, lv);
        const row = document.createElement('button');
        row.className = 'level-row lv-' + lv;
        const auto = GStore.getSettings().levelAutoSettings;
        row.innerHTML =
          '<b class="lv-name">▶ ' + GStore.levelLabel(lv) + '</b>' +
          '<span class="lv-meta">코드 ' + chart.notes.length + '개 · ' +
            (global.GStrum ? GStrum.name(chart.strum) : '') +
            (auto ? ' · ' + GStore.levelSpeedLabel(lv) : '') + '</span>' +
          (best ? '<span class="lv-best">★ ' + best.score.toLocaleString() + '</span>' : '');
        row.addEventListener('click', function () { startPlay(song, lv); });
        levelBox.appendChild(row);
      });
      main.appendChild(levelBox);

      const btns = document.createElement('div');
      btns.className = 'sc-btns';
      if (rw) {
        btns.appendChild(mkBtn('채보 수정', 'btn btn-secondary', function () { openEditor(song); }));
        btns.appendChild(mkBtn('삭제', 'btn btn-back btn-sm2', function () {
          if (!confirm('"' + song.title + '"을 폴더에서 삭제할까요?')) return;
          GStore.deleteSong(song.id).then(function () {
            if (loadedAudioId === song.id) loadedAudioId = null;
            renderList();
            toast('삭제했어요.');
          }).catch(function (e) { toast('삭제하지 못했어요: ' + e.message); });
        }));
      }

      card.appendChild(main);
      card.appendChild(btns);
      el.list.appendChild(card);
    });
  }

  function mkBtn(label, cls, fn) {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtDur(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec - m * 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------- audio ---------- */
  function ensureAudio(song) {
    if (loadedAudioId === song.id && GAudio.hasAudio()) return Promise.resolve();
    const url = GStore.audioUrl(song);
    if (!url) return Promise.reject(new Error('no-audio'));
    return GAudio.load(url).then(function () { loadedAudioId = song.id; });
  }

  /* Pick an mp3: song=null creates a new one. */
  function pickAudioFor(song, after) {
    if (!GStore.canWrite()) {
      toast('이 기기에서는 곡을 추가할 수 없어요. 맥에서 추가해 주세요.');
      return;
    }
    audioPick = { song: song, after: after };
    el.fileAudio.value = '';
    el.fileAudio.click();
  }

  function onAudioChosen(e) {
    const file = e.target.files && e.target.files[0];
    if (!file || !audioPick) return;
    const ctx = audioPick;
    audioPick = null;
    toast('불러오는 중…');

    let song = ctx.song;
    const isNew = !song;
    if (isNew) {
      song = {
        id: GStore.newId(),
        title: file.name.replace(/\.[^.]+$/, ''),
        bpm: 90, offset: 0, beatsPerBar: 4, snap: '1', notes: [],
      };
    }

    GAudio.resume()
      .then(function () { return GAudio.load(file); })
      .then(function () {
        song.duration = GAudio.duration();
        loadedAudioId = song.id;
        toast('폴더에 저장 중…');
        return GStore.uploadAudio(song.id, file);
      })
      .then(function (res) {
        song.audio = res.audio;
        return GStore.saveSong(song);
      })
      .then(function (saved) {
        toast('songs 폴더에 저장했어요.');
        if (ctx.after) ctx.after(saved);
        else openEditor(saved, true);
      })
      .catch(function (err) {
        toast('저장하지 못했어요: ' + (err && err.message ? err.message : 'error'));
      });
  }

  /* ---------- editor / play ---------- */
  function saveSongFromEditor(song) {
    return GStore.saveSong(song)
      .then(function () { toast('songs 폴더에 저장했어요.'); })
      .catch(function (e) { toast('저장하지 못했어요: ' + e.message); throw e; });
  }

  function openEditor(song, audioReady) {
    const go = function () {
      show('editor');
      GEditor.open(song);
    };
    if (audioReady && loadedAudioId === song.id) { go(); return; }
    ensureAudio(song).then(go).catch(function () {
      toast('mp3를 찾을 수 없어요. "mp3 교체"로 다시 넣어주세요.');
      go();
    });
  }

  function startPlay(song, level) {
    const lv = level || song.level || (GStore.levelsOf(song)[0] || 'normal');
    song = GStore.songAtLevel(song, lv);
    if (!(song.notes || []).length) {
      toast('먼저 채보에서 코드를 찍어주세요.');
      if (GStore.canWrite()) openEditor(song);
      return;
    }
    lastPlayed = song;
    GAudio.unlock();          // 아이패드: 누르는 그 순간에 잠금을 풀어야 소리가 납니다
    /* 금방 열리면 안내가 깜빡이기만 해서, 오래 걸릴 때만 보여줍니다 */
    const slow = setTimeout(function () { toast('곡을 준비하고 있어요…'); }, 400);
    ensureAudio(song)
      .then(function () {
        clearTimeout(slow);
        el.toast.classList.remove('show');
        show('play');
        /* requestAnimationFrame 으로 미루면 브라우저가 화면 갱신을 멈춘 사이
           시작 신호를 놓쳐 연주 화면이 멈춘 채로 남습니다. 바로 시작합니다. */
        GPlay.start(song, GStore.settingsForLevel(lv));
      })
      .catch(function (err) {
        clearTimeout(slow);
        toast('mp3를 불러오지 못했어요 (' + (err && err.message ? err.message : 'error') + ')');
      });
  }

  /* ---------- chart import ---------- */
  function onChartChosen(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = function () {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (err) {
        toast('JSON을 읽을 수 없어요.');
        return;
      }
      if (!data || !Array.isArray(data.notes)) { toast('채보 파일 형식이 아니에요.'); return; }
      const song = {
        id: GStore.newId(),
        title: data.title || file.name.replace(/\.[^.]+$/, ''),
        bpm: data.bpm || 90,
        offset: data.offset || 0,
        beatsPerBar: data.beatsPerBar || 4,
        snap: '1',
        duration: data.duration || 0,
        notes: data.notes.filter(function (n) { return n && typeof n.t === 'number' && n.chord; })
          .map(function (n) { return { t: n.t, chord: n.chord }; }),
      };
      GStore.saveSong(song).then(function (saved) {
        renderList();
        toast('채보를 가져왔어요. 이제 mp3를 골라주세요.');
        pickAudioFor(saved, function (s2) { openEditor(s2, true); });
      }).catch(function (err) { toast('저장하지 못했어요: ' + err.message); });
    };
    reader.readAsText(file);
  }

  /* ---------- result ---------- */
  function showResult(res, song) {
    lastPlayed = song;
    const acc = res.total ? (res.good + res.soso * 0.5) / res.total : 0;
    const pct = Math.round(acc * 100);
    const stars = pct >= 95 ? 3 : pct >= 80 ? 2 : pct >= 60 ? 1 : 0;

    $('resStars').textContent = '★★★☆☆☆'.slice(3 - stars, 6 - stars);
    $('resTitle').textContent = (song.title || '연주') +
      (song.level && song.level !== 'normal' ? ' · ' + GStore.levelLabel(song.level) : '') + ' 끝!';
    $('resScore').textContent = res.score.toLocaleString();
    $('resGood').textContent = res.good;
    $('resSoso').textContent = res.soso;
    $('resMiss').textContent = res.miss;
    $('resCombo').textContent = res.maxCombo;
    $('resAcc').textContent = pct + '%';
    $('resComment').textContent =
      stars === 3 ? '완벽해요! 코드 바꾸기가 아주 정확해요 👏' :
      stars === 2 ? '좋아요! 조금만 더 다듬으면 완벽해요.' :
      stars === 1 ? '잘했어요. 느린 속도로 한 번 더 해볼까요?' :
      '천천히 연습해봐요. 속도를 0.75배로 낮춰보세요.';

    /* 지난 기록과 견줘 보여줍니다 — 아이들이 '지난주보다 올랐다'를 느끼는 자리 */
    const lv = song.level || 'normal';
    const prev = GStore.getBest(song.id, lv);
    const isNew = GStore.saveBest(song.id, lv, { score: res.score, acc: pct, maxCombo: res.maxCombo });
    const bestBox = $('resBest');
    if (isNew && prev) {
      bestBox.innerHTML = '🎉 <b>최고 기록 경신!</b> 지난 기록 ' + prev.score.toLocaleString() + '점';
      bestBox.className = 'result-best new';
    } else if (isNew) {
      bestBox.innerHTML = '🎉 <b>첫 기록이에요!</b>';
      bestBox.className = 'result-best new';
    } else if (prev) {
      bestBox.innerHTML = '★ 최고 기록 ' + prev.score.toLocaleString() + '점 (' + prev.date + ')';
      bestBox.className = 'result-best';
    } else {
      bestBox.textContent = '';
      bestBox.className = 'result-best';
    }
    show('result');
  }

  /* ---------- settings ---------- */
  function wireSettings() {
    const s = GStore.getSettings();
    [['setScroll', 'scrollSec', 'setScrollVal'],
     ['setEarly', 'earlyWindow', 'setEarlyVal'],
     ['setLate', 'lateWindow', 'setLateVal']].forEach(function (m) {
      const input = $(m[0]);
      input.value = s[m[1]];
      $(m[2]).textContent = Number(s[m[1]]).toFixed(2);
      input.addEventListener('input', function () {
        const cur = GStore.getSettings();
        cur[m[1]] = parseFloat(input.value);
        GStore.saveSettings(cur);
        $(m[2]).textContent = Number(input.value).toFixed(2);
      });
    });

    [['setAutoMiss', 'autoMiss'], ['setDiagram', 'showDiagram']].forEach(function (m) {
      const box = $(m[0]);
      box.checked = !!s[m[1]];
      box.addEventListener('change', function () {
        const cur = GStore.getSettings();
        cur[m[1]] = box.checked;
        GStore.saveSettings(cur);
      });
    });

    const countIn = $('setCountIn');
    countIn.value = s.countInBeats;
    countIn.addEventListener('change', function () {
      const cur = GStore.getSettings();
      cur.countInBeats = Math.max(0, Math.min(8, parseInt(countIn.value, 10) || 0));
      countIn.value = cur.countInBeats;
      GStore.saveSettings(cur);
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
      b.addEventListener('click', function () {
        GStore.applyPreset(b.dataset.preset);
        settingsValues();
        toast(GStore.presets[b.dataset.preset].label + '으로 맞췄어요. 다음 연주부터 적용돼요.');
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-theme]'), function (b) {
      b.addEventListener('click', function () {
        const cur = GStore.getSettings();
        cur.theme = b.dataset.theme;
        GStore.saveSettings(cur);
        applyTheme(cur.theme);
        settingsValues();
        renderList();
        toast(cur.theme === 'bright' ? '밝은 화면으로 바꿨어요.' : '어두운 화면으로 바꿨어요.');
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-judgemode]'), function (b) {
      b.addEventListener('click', function () {
        const cur = GStore.getSettings();
        cur.judgeMode = b.dataset.judgemode;
        GStore.saveSettings(cur);
        settingsValues();
        toast(cur.judgeMode === 'autoGood'
          ? '기본은 성공이에요. 못 친 아이가 있을 때만 리모컨을 누르세요.'
          : '성공·살짝·실패를 직접 눌러 판정합니다.');
      });
    });

    const levelAuto = $('setLevelAuto');
    levelAuto.addEventListener('change', function () {
      const cur = GStore.getSettings();
      cur.levelAutoSettings = levelAuto.checked;
      GStore.saveSettings(cur);
      renderList();
    });

    $('setClose').addEventListener('click', function () { el.settingsOverlay.classList.remove('show'); });
    $('setReset').addEventListener('click', function () {
      GStore.saveSettings(JSON.parse(JSON.stringify(GStore.defaultSettings)));
      el.settingsOverlay.classList.remove('show');
      settingsValues();
      toast('기본값으로 되돌렸어요.');
    });
  }

  function settingsValues() {
    const s = GStore.getSettings();
    $('setScroll').value = s.scrollSec;
    $('setScrollVal').textContent = Number(s.scrollSec).toFixed(2);
    $('setEarly').value = s.earlyWindow;
    $('setEarlyVal').textContent = Number(s.earlyWindow).toFixed(2);
    $('setLate').value = s.lateWindow;
    $('setLateVal').textContent = Number(s.lateWindow).toFixed(2);
    $('setAutoMiss').checked = !!s.autoMiss;
    $('setLevelAuto').checked = !!s.levelAutoSettings;
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme]'), function (b) {
      b.classList.toggle('btn-primary', b.dataset.theme === (s.theme || 'dark'));
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme]'), function (b) {
      b.addEventListener('click', function () {
        const cur = GStore.getSettings();
        cur.theme = b.dataset.theme;
        GStore.saveSettings(cur);
        applyTheme(cur.theme);
        settingsValues();
        renderList();
        toast(cur.theme === 'bright' ? '밝은 화면으로 바꿨어요.' : '어두운 화면으로 바꿨어요.');
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-judgemode]'), function (b) {
      b.classList.toggle('btn-primary', b.dataset.judgemode === (s.judgeMode || 'autoGood'));
    });
    const amRow = $('setAutoMissRow');
    if (amRow) amRow.style.display = (s.judgeMode === 'manual') ? '' : 'none';
    $('setDiagram').checked = !!s.showDiagram;
    $('setCountIn').value = s.countInBeats;

    const cur = GStore.currentPreset();
    Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
      b.classList.toggle('on', b.dataset.preset === cur);
    });
  }

  function openSettings() {
    settingsValues();
    el.settingsOverlay.classList.add('show');
  }

  global.GMain = { toast: toast, renderList: renderList };
})(window);
