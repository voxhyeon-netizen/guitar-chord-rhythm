/* Gameplay: chords fall down lanes, the teacher judges at the line. */
(function (global) {
  const MAX_LANES = 6;
  const NOTE_H = 64;

  let el = {};
  let hooks = {};
  let song = null;
  let settings = null;
  let notes = [];          // { t, chord, lane, state, elem }
  let lanes = [];          // chord name per lane
  let laneOfChord = {};
  let active = false;
  let paused = false;
  let finished = false;
  let rafId = 0;
  let judgeY = 0;
  let footH = 0;
  let stats = null;
  let lastTarget = null;

  /* lead-in: the clock starts at -leadSec so the first chord falls in from the top */
  let leadSec = 0;
  let leadStartMs = 0;
  let audioStarted = false;
  let pendingTicks = [];
  let pausedLeadT = 0;
  let kickTimer = 0;

  function $(id) { return document.getElementById(id); }

  function init(h) {
    hooks = h || {};
    el = {
      screen: $('screen-play'),
      exit: $('playExit'),
      songName: $('playSong'),
      score: $('statScore'),
      combo: $('statCombo'),
      acc: $('statAcc'),
      progress: $('playProgress'),
      field: $('laneField'),
      cols: $('laneCols'),
      layer: $('notesLayer'),
      line: document.querySelector('#screen-play .judge-line'),
      feet: $('laneFeet'),
      popup: $('judgePopup'),
      comboFloat: $('comboFloat'),
      nowChord: $('nowChord'),
      nextChord: $('nextChord'),
      tally: $('tally'),
      bar: document.querySelector('.judge-bar'),
      pauseBtn: $('playPause'),
      countOverlay: $('countOverlay'),
      countNum: $('countNum'),
      pauseOverlay: $('pauseOverlay'),
      resume: $('btnResume'),
      restart: $('btnRestart'),
      quit: $('btnQuit'),
      rate: $('playRate'),
      scroll: $('playScroll'),
    };

    /* pointerdown, not click: on a tablet the judgement must land the instant it is tapped */
    el.bar.addEventListener('pointerdown', function (e) {
      const b = e.target.closest('[data-judge]');
      if (!b) return;
      e.preventDefault();
      judge(b.dataset.judge);
    });
    el.pauseBtn.addEventListener('click', togglePause);
    el.exit.addEventListener('click', quit);
    el.resume.addEventListener('click', function () { if (paused) togglePause(); });
    el.restart.addEventListener('click', restart);
    el.quit.addEventListener('click', quit);
    el.rate.addEventListener('change', function () { GAudio.setRate(parseFloat(el.rate.value)); });
    el.scroll.addEventListener('input', function () {
      settings.scrollSec = parseFloat(el.scroll.value);
      GStore.saveSettings(settings);
    });
    document.addEventListener('keydown', onKey);
    global.addEventListener('resize', function () { if (active) measure(); });
  }

  /* ---------- start ---------- */
  function start(s) {
    if (!GAudio.hasAudio()) {
      if (global.GMain) GMain.toast('mp3를 먼저 불러와야 연주할 수 있어요.');
      if (hooks.onExit) hooks.onExit();
      return;
    }
    song = s;
    settings = GStore.getSettings();
    el.scroll.value = settings.scrollSec;
    el.rate.value = String(GAudio.getRate());
    finished = false;
    paused = false;
    active = true;
    audioStarted = false;

    buildLanes();
    notes = (song.notes || []).slice().sort(function (a, b) { return a.t - b.t; })
      .map(function (n) {
        return {
          t: n.t,
          chord: n.chord,
          lane: laneOfChord[n.chord] != null ? laneOfChord[n.chord] : 0,
          state: 'wait',
          elem: null,
        };
      });

    stats = { good: 0, soso: 0, miss: 0, skip: 0, score: 0, combo: 0, maxCombo: 0 };
    lastTarget = null;
    el.songName.textContent = song.title || '';
    el.layer.innerHTML = '';
    updateHud();
    setChordPanel(notes.length ? notes[0].chord : null, notes[1] ? notes[1].chord : null);
    measure();

    const spb = 60 / (song.bpm || 90);
    const beats = Math.max(0, parseInt(settings.countInBeats, 10) || 0);
    leadSec = Math.max(settings.scrollSec, beats * spb) + 0.3;
    pendingTicks = [];
    for (let k = beats; k >= 1; k--) pendingTicks.push({ t: -k * spb, n: k });
    leadStartMs = performance.now();

    GAudio.onEnd(finish);
    GAudio.seek(0);
    GAudio.unlock();
    /* 화면 갱신(rAF)이 멈춰 있어도 연주는 시작되도록 하는 보조 장치 */
    clearTimeout(kickTimer);
    kickTimer = setTimeout(function () {
      if (active && !paused && !audioStarted && songTime() >= 0) {
        audioStarted = true;
        GAudio.play(0);
        el.countOverlay.classList.remove('show');
      }
      if (active && !rafId) loop();
    }, Math.max(400, leadSec * 1000 + 200));
    if (beats > 0) el.countOverlay.classList.add('show');
    el.countNum.textContent = beats > 0 ? String(beats) : '';
    loop();
  }

  function songTime() {
    if (audioStarted) return GAudio.now();
    return (performance.now() - leadStartMs) / 1000 - leadSec;
  }

  function buildLanes() {
    const seen = [];
    (song.notes || []).forEach(function (n) {
      if (seen.indexOf(n.chord) < 0) seen.push(n.chord);
    });
    laneOfChord = {};
    if (!seen.length) {
      lanes = ['—'];
    } else if (seen.length > MAX_LANES) {
      lanes = ['모든 코드'];
      seen.forEach(function (c) { laneOfChord[c] = 0; });
    } else {
      lanes = seen;
      seen.forEach(function (c, i) { laneOfChord[c] = i; });
    }

    el.cols.innerHTML = '';
    el.feet.innerHTML = '';
    lanes.forEach(function (name) {
      const isReal = !!GChords.shape(name);
      const col = GChords.colorOf(isReal ? name : 'C');
      const c = document.createElement('div');
      c.className = 'lane-col';
      c.style.setProperty('--glow', col.main);
      el.cols.appendChild(c);

      const f = document.createElement('div');
      f.className = 'lane-foot';
      f.innerHTML = (isReal && settings.showDiagram)
        ? GChords.diagramSvg(name, { width: 96 })
        : '<div class="lf-name" style="color:' + col.light + '">' + name + '</div>';
      el.feet.appendChild(f);
    });
  }

  function measure() {
    const h = el.field.clientHeight;
    if (!h || !el.field.clientWidth) {         // 화면이 아직 잡히지 않음 — 곧 다시 잽니다
      setTimeout(function () { if (active) measure(); }, 60);
    }
    footH = (settings.showDiagram && (GChords.shape(lanes[0]) || lanes.length === 1)) ? 122 : 46;
    judgeY = Math.max(140, h - footH);
    el.line.style.top = judgeY + 'px';
    el.feet.style.height = footH + 'px';
    const laneW = el.field.clientWidth / Math.max(1, lanes.length);
    notes.forEach(function (n) {
      if (n.elem) {
        n.elem.style.width = laneW + 'px';
        n.elem.style.left = (n.lane * laneW) + 'px';
      }
    });
  }

  /* ---------- loop ---------- */
  function loop() {
    if (!active) return;
    rafId = requestAnimationFrame(loop);
    if (paused) return;

    const t = songTime();

    if (!audioStarted) {
      while (pendingTicks.length && pendingTicks[0].t <= t) {
        const tick = pendingTicks.shift();
        el.countNum.textContent = String(tick.n);
        el.countNum.style.animation = 'none';
        void el.countNum.offsetWidth;
        el.countNum.style.animation = '';
        GAudio.sfx.tick(pendingTicks.length === 0);
      }
      if (t >= 0) {
        audioStarted = true;
        GAudio.play(0);
        el.countOverlay.classList.remove('show');
        /* 아이패드에서 소리가 잠긴 채 시작되면 알려줍니다 */
        if (GAudio.state() !== 'running' && global.GMain) {
          GAudio.unlock();
          GMain.toast('소리가 잠겨 있어요. 화면을 한 번 누르고, 음량·무음 모드를 확인하세요.');
        }
      }
    }

    const laneW = el.field.clientWidth / Math.max(1, lanes.length);
    const startY = -NOTE_H;
    const endY = judgeY - NOTE_H / 2;   // the note sits centred on the line on the beat
    const scrollSec = settings.scrollSec;

    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const dt = n.t - t;

      if (n.state === 'wait' && dt < -settings.lateWindow) {
        if (settings.autoMiss) applyJudge(n, 'miss', true);
        else { n.state = 'skip'; stats.skip++; fadeOut(n); }
      }

      if (n.state === 'done' || n.state === 'skip') continue;

      if (dt < scrollSec + 0.3 && dt > -1.2) {
        if (!n.elem) createNote(n, laneW);
        const p = 1 - dt / scrollSec;
        n.elem.style.transform = 'translate3d(0,' + (startY + p * (endY - startY)).toFixed(1) + 'px,0)';
      } else if (n.elem) {
        removeNote(n);
      }
    }

    updateTarget(t);
    const dur = GAudio.duration();
    el.progress.style.width = (dur ? Math.max(0, Math.min(1, t / dur)) * 100 : 0) + '%';

    const last = notes.length ? notes[notes.length - 1] : null;
    if (last && t > last.t + 1.5 && notes.every(function (x) { return x.state !== 'wait'; })) finish();
  }

  function createNote(n, laneW) {
    const col = GChords.colorOf(n.chord);
    const d = document.createElement('div');
    d.className = 'note';
    d.style.height = NOTE_H + 'px';
    d.style.width = laneW + 'px';
    d.style.left = (n.lane * laneW) + 'px';
    d.innerHTML = '<div class="note-inner" style="background:linear-gradient(180deg,' +
      col.light + ',' + col.main + ')">' + n.chord + '</div>';
    el.layer.appendChild(d);
    n.elem = d;
  }

  function removeNote(n) {
    if (n.elem && n.elem.parentNode) n.elem.parentNode.removeChild(n.elem);
    n.elem = null;
  }

  function fadeOut(n) {
    if (!n.elem) return;
    const e = n.elem;
    n.elem = null;
    e.classList.remove('target');
    e.classList.add('done');
    setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 220);
  }

  /* ---------- target ---------- */
  function findTarget(t) {
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const dt = n.t - t;
      if (dt > settings.earlyWindow) break;
      if (n.state !== 'wait' || dt < -settings.lateWindow) continue;
      const d = Math.abs(dt);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  function updateTarget(t) {
    const target = findTarget(t);
    if (target !== lastTarget) {
      if (lastTarget && lastTarget.elem) lastTarget.elem.classList.remove('target');
      lastTarget = target;
      const upcoming = target || nextWaiting(t);
      setChordPanel(upcoming ? upcoming.chord : null, afterOf(upcoming));
    }
    if (target && target.elem) target.elem.classList.add('target');
  }

  function nextWaiting(t) {
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].state === 'wait' && notes[i].t >= t - settings.lateWindow) return notes[i];
    }
    return null;
  }

  function afterOf(n) {
    if (!n) return null;
    const i = notes.indexOf(n);
    for (let j = i + 1; j < notes.length; j++) {
      if (notes[j].chord !== n.chord) return notes[j].chord;
    }
    return notes[i + 1] ? notes[i + 1].chord : null;
  }

  function setChordPanel(now, next) {
    /* single-lane mode has no fixed chord per lane: mirror the current one at the foot */
    if (lanes.length === 1 && el.feet.children[0]) {
      el.feet.children[0].innerHTML = (now && settings.showDiagram && GChords.shape(now))
        ? GChords.diagramSvg(now, { width: 110 })
        : '<div class="lf-name">' + (now || '—') + '</div>';
    }
    el.nowChord.innerHTML = now
      ? ((settings.showDiagram && GChords.shape(now))
        ? GChords.diagramSvg(now, { width: 150 })
        : '<div class="side-name">' + now + '</div>')
      : '<span class="side-empty">—</span>';
    el.nextChord.innerHTML = next
      ? ((settings.showDiagram && GChords.shape(next))
        ? GChords.diagramSvg(next, { width: 130 })
        : '<div class="side-name">' + next + '</div>')
      : '<span class="side-empty">—</span>';
  }

  /* ---------- judging ---------- */
  const LABEL = { good: '성공!', soso: '살짝', miss: '실패' };
  const COLOR = { good: '#2ed573', soso: '#1e90ff', miss: '#ff6b81' };

  function judge(kind) {
    if (!active || paused || finished) return;
    pressFx(kind);
    const target = findTarget(songTime());
    if (!target) { GAudio.sfx.click(); return; }
    applyJudge(target, kind, false);
  }

  function applyJudge(n, kind, auto) {
    n.state = 'done';
    if (kind === 'good') {
      stats.good++;
      stats.combo++;
      stats.score += Math.round(100 * (1 + Math.min(stats.combo, 50) * 0.02));
      GAudio.sfx.good();
      if (n.elem) n.elem.classList.add('hit-good');
    } else if (kind === 'soso') {
      stats.soso++;
      stats.combo++;
      stats.score += 50;
      GAudio.sfx.soso();
    } else {
      stats.miss++;
      stats.combo = 0;
      if (!auto) GAudio.sfx.miss();
    }
    if (stats.combo > stats.maxCombo) stats.maxCombo = stats.combo;

    flashLane(n.lane, kind);
    popup(kind, n.lane);
    fadeOut(n);
    if (lastTarget === n) lastTarget = null;
    updateHud();
  }

  function popup(kind, lane) {
    const laneW = el.field.clientWidth / Math.max(1, lanes.length);
    el.popup.textContent = LABEL[kind];
    el.popup.style.color = COLOR[kind];
    el.popup.style.left = (lane * laneW + laneW / 2) + 'px';
    el.popup.style.top = (judgeY - 40) + 'px';
    el.popup.classList.remove('show');
    void el.popup.offsetWidth;
    el.popup.classList.add('show');

    if (kind !== 'miss' && stats.combo >= 3) {
      el.comboFloat.textContent = stats.combo + ' COMBO';
      el.comboFloat.classList.remove('show');
      void el.comboFloat.offsetWidth;
      el.comboFloat.classList.add('show');
    } else if (kind === 'miss') {
      el.comboFloat.classList.remove('show');
    }
  }

  function flashLane(lane, kind) {
    const c = el.cols.children[lane];
    if (!c) return;
    c.style.setProperty('--glow', COLOR[kind]);
    c.classList.add('flash');
    setTimeout(function () {
      c.classList.remove('flash');
      const name = lanes[lane];
      c.style.setProperty('--glow', GChords.colorOf(GChords.shape(name) ? name : 'C').main);
    }, 170);
  }

  function pressFx(kind) {
    const b = el.bar.querySelector('[data-judge="' + kind + '"]');
    if (!b) return;
    b.classList.add('press');
    setTimeout(function () { b.classList.remove('press'); }, 90);
  }

  function updateHud() {
    el.score.textContent = stats.score.toLocaleString();
    el.combo.textContent = stats.combo;
    const done = stats.good + stats.soso + stats.miss;
    el.acc.textContent = (done ? Math.round((stats.good + stats.soso * 0.5) / done * 100) : 100) + '%';
    const b = el.tally.querySelectorAll('b');
    b[0].textContent = stats.good;
    b[1].textContent = stats.soso;
    b[2].textContent = stats.miss;
  }

  /* ---------- controls ---------- */
  function onKey(e) {
    if (!active) return;
    if (e.code === 'Space') { e.preventDefault(); togglePause(); return; }
    if (e.code === 'Escape') { e.preventDefault(); if (!paused) togglePause(); return; }
    if (paused || finished || e.repeat) return;
    if (e.code === settings.keyGood) { e.preventDefault(); judge('good'); }
    else if (e.code === settings.keySoso) { e.preventDefault(); judge('soso'); }
    else if (e.code === settings.keyMiss) { e.preventDefault(); judge('miss'); }
  }

  function togglePause() {
    if (!active || finished) return;
    paused = !paused;
    if (paused) {
      pausedLeadT = songTime();
      if (audioStarted) GAudio.pause();
      el.pauseOverlay.classList.add('show');
    } else {
      el.pauseOverlay.classList.remove('show');
      if (audioStarted) {
        GAudio.resume().then(function () { GAudio.play(GAudio.now()); });
      } else {
        leadStartMs = performance.now() - (pausedLeadT + leadSec) * 1000;
      }
    }
  }

  function restart() {
    el.pauseOverlay.classList.remove('show');
    const s = song;
    stop();
    start(s);
  }

  function quit() {
    stop();
    if (hooks.onExit) hooks.onExit();
  }

  function stop() {
    active = false;
    paused = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    clearTimeout(kickTimer);
    kickTimer = 0;
    el.countOverlay.classList.remove('show');
    el.pauseOverlay.classList.remove('show');
    GAudio.onEnd(null);
    GAudio.pause();
    notes.forEach(removeNote);
    lastTarget = null;
  }

  function finish() {
    if (finished || !active) return;
    finished = true;
    const result = {
      score: stats.score,
      good: stats.good,
      soso: stats.soso,
      miss: stats.miss,
      maxCombo: stats.maxCombo,
      total: stats.good + stats.soso + stats.miss,
    };
    const s = song;
    stop();
    GAudio.sfx.fanfare();
    if (hooks.onFinish) hooks.onFinish(result, s);
  }

  global.GPlay = { init: init, start: start, stop: stop };
})(window);
