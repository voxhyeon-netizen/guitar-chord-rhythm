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
  let headH = NOTE_H;      // 막대 머리 높이 — 화면 크기에 맞춰 정해집니다
  let GAP = 14;
  let stats = null;
  let lastTarget = null;
  let lastToggleMs = 0;

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
      fx: $('fxLayer'),
      intro: $('introHint'),
      splash: $('comboSplash'),
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
  function start(s, overrides) {
    if (!GAudio.hasAudio()) {
      if (global.GMain) GMain.toast('mp3를 먼저 불러와야 연주할 수 있어요.');
      if (hooks.onExit) hooks.onExit();
      return;
    }
    song = s;
    settings = GStore.getSettings();
    if (overrides) Object.keys(overrides).forEach(function (k) { settings[k] = overrides[k]; });
    el.bar.classList.toggle('auto-good', settings.judgeMode === 'autoGood');
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

    /* 각 코드가 '얼마 동안 치는지'와 '어떤 주법인지' */
    const spbNow = 60 / (song.bpm || 90);
    const barLen = spbNow * (song.beatsPerBar || 4);
    notes.forEach(function (n, i) {
      const next = notes[i + 1];
      let d = next ? next.t - n.t : barLen;
      n.dur = Math.max(spbNow * 0.5, Math.min(d, barLen * 4));
      n.pat = global.GStrum ? GStrum.forNote(song, n) : null;
      n.marks = (n.pat && global.GStrum)
        ? GStrum.times(song, n.pat, n.t, n.t + n.dur).map(function (m) { return m.t; })
        : [];
    });

    stats = { good: 0, soso: 0, miss: 0, skip: 0, score: 0, combo: 0, maxCombo: 0 };
    lastTarget = null;
    el.songName.textContent = song.title || '';
    el.layer.innerHTML = '';
    el.fx.innerHTML = '';
    el.intro.classList.add('hidden');
    lastActiveLane = -1;
    lastPanelChord = null;
    lastFrameT = -1;
    for (let i = 1; i <= TIERS.length; i++) el.field.classList.remove('tier' + i);
    el.field.classList.remove('shake');
    el.splash.classList.remove('show');
    el.comboFloat.className = 'combo-float';
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
    headH = Math.max(56, Math.min(110, Math.round(h * 0.105)));
    GAP = 14;                     // 판정선과 코드 그림 사이 여백 — 선이 가려지면 안 됩니다
    if (!h || !el.field.clientWidth) {         // 화면이 아직 잡히지 않음 — 곧 다시 잽니다
      setTimeout(function () { if (active) measure(); }, 60);
    }
    footH = (settings.showDiagram && (GChords.shape(lanes[0]) || lanes.length === 1)) ? 122 : 46;
    judgeY = Math.max(140, h - footH - GAP);
    el.line.style.top = judgeY + 'px';
    el.feet.style.height = footH + 'px';
    /* 판정선 바로 아래에서 막대가 잘려 나갑니다 — 지나간 부분이 코드 그림을 덮지 않게 */
    el.layer.style.height = (judgeY + 6) + 'px';
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
        /* 소리가 실제로 시작됐는지 확인하고, 안 되면 알려줍니다 */
        setTimeout(function () {
          if (active && !paused && !GAudio.isPlaying() && global.GMain) {
            GAudio.unlock();
            GAudio.play(songTime());
            GMain.toast('소리를 시작하지 못했어요. 화면을 한 번 누르고 다시 시도해 주세요.');
          }
        }, 500);
      }
    }

    const laneW = el.field.clientWidth / Math.max(1, lanes.length);
    const scrollSec = settings.scrollSec;

    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const dt = n.t - t;

      if (n.state === 'wait' && dt < -settings.lateWindow) {
        if (settings.judgeMode === 'autoGood') applyJudge(n, 'good', true);
        else if (settings.autoMiss) applyJudge(n, 'miss', true);
        else { n.state = 'skip'; stats.skip++; markJudged(n, 'soso'); }
      }

      const dur = n.dur || 0.5;
      /* 판정했어도 막대는 끝까지 내려갑니다 — 아직 치는 중이니까요 */
      if (dt < scrollSec + 0.3 && dt > -(dur + 0.7)) {
        if (!n.elem) createNote(n, laneW);
        /* 막대의 아래끝이 판정선에 닿는 순간이 '치기 시작' 입니다 */
        const bottom = judgeY * (1 - dt / scrollSec);
        n.elem.style.transform = 'translate3d(0,' + (bottom - n.height).toFixed(1) + 'px,0)';
      } else if (n.elem) {
        removeNote(n);
      }
    }

    introHint(t);
    strumPulse(t);
    updateTarget(t);
    updateActiveLane(t);
    const dur = GAudio.duration();
    el.progress.style.width = (dur ? Math.max(0, Math.min(1, t / dur)) * 100 : 0) + '%';

    const last = notes.length ? notes[notes.length - 1] : null;
    if (last && t > last.t + 1.5 && notes.every(function (x) { return x.state !== 'wait'; })) finish();
  }

  function createNote(n, laneW) {
    const col = GChords.colorOf(n.chord);
    const dur = n.dur || 0.5;
    const h = Math.max(headH, judgeY * dur / settings.scrollSec);
    n.height = h;

    const d = document.createElement('div');
    d.className = 'note';
    d.style.height = h + 'px';
    d.style.width = laneW + 'px';
    d.style.left = (n.lane * laneW) + 'px';

    let html = '<div class="note-body" style="background:linear-gradient(180deg,' +
      col.light + ',' + col.main + ')"></div>';

    /* 치는 순간마다 화살표 — 판정선을 지나갈 때 치면 됩니다 */
    if (n.pat && global.GStrum) {
      const marks = GStrum.times(song, n.pat, n.t, n.t + dur);
      n.marks = marks.map(function (m) { return m.t; });
      for (let i = 0; i < marks.length; i++) {
        const off = (marks[i].t - n.t) / dur * h;
        if (off < headH * 0.8) continue;              // 머리와 겹치면 생략
        const up = marks[i].dir === 'U';
        html += '<i class="strum ' + (up ? 'up' : 'down') + '" style="bottom:' +
          off.toFixed(1) + 'px">' + (up ? '▲' : '▼') + '</i>';
      }
    }

    html += '<div class="note-head" style="height:' + headH + 'px;background:linear-gradient(180deg,' +
      col.light + ',' + col.main + ')">' + n.chord + '</div>';

    d.innerHTML = html;
    el.layer.appendChild(d);
    n.elem = d;
  }

  function removeNote(n) {
    if (n.elem && n.elem.parentNode) n.elem.parentNode.removeChild(n.elem);
    n.elem = null;
  }

  /* 판정 결과를 막대에 표시만 합니다. 지우지 않고 끝까지 흘려보냅니다. */
  function markJudged(n, kind) {
    if (!n.elem) return;
    n.elem.classList.remove('target', 'judged-good', 'judged-soso', 'judged-miss');
    n.elem.classList.add('judged', 'judged-' + kind);
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

  /* 전주 동안 빈 화면을 보고 있지 않도록 — 첫 코드까지 몇 초 남았는지 알려줍니다 */
  function introHint(t) {
    const first = notes[0];
    const left = first ? first.t - t : 0;
    const show = !!first && left > settings.scrollSec + 0.2;
    if (!show) {
      if (!el.intro.classList.contains('hidden')) el.intro.classList.add('hidden');
      return;
    }
    const sec = Math.max(1, Math.ceil(left - settings.scrollSec));
    el.intro.classList.remove('hidden');
    el.intro.innerHTML =
      '<div class="ih-top">🎵 전주 — 잘 듣고 준비하세요</div>' +
      '<div class="ih-count">' + sec + '</div>' +
      '<div class="ih-chord">첫 코드 <b>' + first.chord + '</b></div>' +
      ((settings.showDiagram && GChords.shape(first.chord))
        ? '<div class="ih-dia">' + GChords.diagramSvg(first.chord, { width: 110, showName: false }) + '</div>' : '');
  }

  /* 화살표가 판정선을 지나는 순간 선이 번쩍입니다 — 리듬을 눈으로 따라갈 수 있게 */
  let lastFrameT = -1;
  function strumPulse(t) {
    const prev = lastFrameT;
    lastFrameT = t;
    if (prev < 0 || t - prev > 0.5 || t < prev) return;   // 건너뛰거나 되감았을 때는 건너뜀
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > t + 0.05) break;
      if (!n.marks || t > n.t + (n.dur || 0.5) + 0.05) continue;
      for (let k = 0; k < n.marks.length; k++) {
        const m = n.marks[k];
        if (m > prev && m <= t) { pulseLine(n.lane); return; }
      }
    }
  }

  function pulseLine(lane) {
    el.line.classList.remove('pulse');
    void el.line.offsetWidth;
    el.line.classList.add('pulse');
    const foot = el.feet.children[lane];
    if (foot) {
      foot.classList.remove('beat');
      void foot.offsetWidth;
      foot.classList.add('beat');
    }
  }

  /* 지금 치는 코드의 그림을 밝게 — 어느 줄을 봐야 하는지 한눈에 */
  let lastActiveLane = -1;
  function updateActiveLane(t) {
    const n = spanningNote(t) || findTarget(t);
    const lane = n ? n.lane : -1;
    if (lane === lastActiveLane) return;
    lastActiveLane = lane;
    for (let i = 0; i < el.feet.children.length; i++) {
      el.feet.children[i].classList.toggle('active', i === lane);
    }
  }

  let lastPanelChord = null;
  function updateTarget(t) {
    const target = findTarget(t);
    const showing = target || spanningNote(t) || nextWaiting(t);
    const chord = showing ? showing.chord : null;
    if (chord !== lastPanelChord) {
      lastPanelChord = chord;
      setChordPanel(chord, afterOf(showing));
    }
    if (target !== lastTarget) {
      if (lastTarget && lastTarget.elem) lastTarget.elem.classList.remove('target');
      lastTarget = target;
    }
    if (target && target.elem) target.elem.classList.add('target');
  }

  /* 지금 판정선을 지나고 있는 막대 (판정이 끝났어도 아직 치는 중) */
  function spanningNote(t) {
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > t + 0.05) break;
      if (t < n.t + (n.dur || 0.5)) return n;
    }
    return null;
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
    const t = songTime();
    const target = findTarget(t);
    if (target) { applyJudge(target, kind, false); return; }

    /* 기본 성공 방식에서는 막대가 지나가는 동안 언제든 바꿀 수 있습니다
       — 두 번째 스트로크에서 틀려도 그때 누르면 됩니다 */
    if (settings.judgeMode === 'autoGood' && kind !== 'good') {
      const cur = spanningNote(t);
      if (cur && cur.state === 'done' && cur.auto && cur.kind === 'good') {
        revise(cur, kind);
        return;
      }
    }
    GAudio.sfx.click();
  }

  /* 이미 성공으로 넘어간 코드를 실패/살짝으로 고칩니다 */
  function revise(n, kind) {
    stats.good--;
    stats.score -= n.points || 0;
    n.kind = kind;
    n.points = 0;
    if (kind === 'soso') {
      stats.soso++;
      n.points = 50;
      stats.score += 50;
      GAudio.sfx.soso();
    } else {
      stats.miss++;
      stats.combo = 0;
      GAudio.sfx.miss();
    }
    if (stats.score < 0) stats.score = 0;
    markJudged(n, kind);
    flashLane(n.lane, kind);
    popup(kind, n.lane);
    comboFx(kind, n.lane);
    updateHud();
  }

  function applyJudge(n, kind, auto) {
    n.state = 'done';
    n.kind = kind;
    n.auto = !!auto;
    n.points = 0;
    if (kind === 'good') {
      stats.good++;
      stats.combo++;
      n.points = Math.round(100 * (1 + Math.min(stats.combo, 50) * 0.02));
      stats.score += n.points;
      GAudio.sfx.goodStep((stats.combo - 1) % 8);
      if (n.elem) n.elem.classList.add('hit-good');
    } else if (kind === 'soso') {
      stats.soso++;
      stats.combo++;
      n.points = 50;
      stats.score += n.points;
      GAudio.sfx.soso();
    } else {
      stats.miss++;
      stats.combo = 0;
      if (!auto) GAudio.sfx.miss();
    }
    if (stats.combo > stats.maxCombo) stats.maxCombo = stats.combo;

    flashLane(n.lane, kind);
    popup(kind, n.lane);
    comboFx(kind, n.lane);
    markJudged(n, kind);
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
      el.comboFloat.className = 'combo-float t' + comboTier(stats.combo);
      el.comboFloat.textContent = stats.combo + ' COMBO';
      el.comboFloat.classList.remove('show');
      void el.comboFloat.offsetWidth;
      el.comboFloat.classList.add('show');
    } else if (kind === 'miss') {
      el.comboFloat.classList.remove('show');
    }
  }

  /* ---------- 콤보 연출 ---------- */
  const TIERS = [5, 10, 20, 30, 50];

  function comboTier(c) {
    let t = 0;
    for (let i = 0; i < TIERS.length; i++) if (c >= TIERS[i]) t = i + 1;
    return t;
  }

  function comboFx(kind, lane) {
    const tier = kind === 'miss' ? 0 : comboTier(stats.combo);
    for (let i = 1; i <= TIERS.length; i++) el.field.classList.toggle('tier' + i, i === tier);

    if (kind === 'miss') {
      el.field.classList.add('shake');
      setTimeout(function () { el.field.classList.remove('shake'); }, 300);
      return;
    }

    sparks(lane, 4 + tier * 3, tier);

    /* 10콤보마다 크게 터뜨립니다 */
    if (stats.combo > 0 && stats.combo % 10 === 0) {
      splash(stats.combo + ' COMBO!');
      sparks(-1, 26, Math.max(2, tier));
      GAudio.sfx.milestone();
    }
  }

  function splash(text) {
    el.splash.textContent = text;
    el.splash.classList.remove('show');
    void el.splash.offsetWidth;
    el.splash.classList.add('show');
  }

  /* 판정선 쪽에서 튀어오르는 작은 불꽃 */
  function sparks(lane, count, tier) {
    const laneW = el.field.clientWidth / Math.max(1, lanes.length);
    const x = lane < 0 ? el.field.clientWidth / 2 : lane * laneW + laneW / 2;
    const y = judgeY - NOTE_H / 2;
    const hue = lane < 0 ? 45 : GChords.colorOf(lanes[lane] || 'C').hue;

    for (let i = 0; i < count; i++) {
      const s = document.createElement('i');
      s.className = 'spark';
      const ang = Math.random() * Math.PI - Math.PI / 2;      // 위쪽으로 퍼지게
      const dist = 40 + Math.random() * (60 + tier * 30);
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      s.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(0) + 'px');
      s.style.setProperty('--dy', (-Math.abs(Math.sin(ang)) * dist - 20).toFixed(0) + 'px');
      s.style.background = 'hsl(' + (hue + (Math.random() * 40 - 20)) + ', 90%, ' + (60 + Math.random() * 20) + '%)';
      s.style.width = s.style.height = (4 + Math.random() * (3 + tier)) + 'px';
      el.fx.appendChild(s);
      setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 700);
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
  /* PPT 리모컨은 키보드처럼 신호를 보냅니다. 버튼이 2~4개뿐이라 많이 쓰는 판정에 배정했습니다.
     다음(▶) = 성공 · 이전(◀) = 실패 · 화면끄기(⬛) = 살짝 · 시작(F5) = 일시정지
     제품마다 보내는 키가 달라서 한 동작에 여러 키를 받아 둡니다. */
  const REMOTE = {
    good: ['PageDown', 'ArrowRight', 'ArrowDown'],
    miss: ['PageUp', 'ArrowLeft', 'ArrowUp'],
    soso: ['KeyB', 'Period'],
    pause: ['F5'],
  };

  function remoteKind(code) {
    if (REMOTE.good.indexOf(code) >= 0) return 'good';
    if (REMOTE.miss.indexOf(code) >= 0) return 'miss';
    if (REMOTE.soso.indexOf(code) >= 0) return 'soso';
    return '';
  }

  function onKey(e) {
    if (!active) return;

    /* 리모컨 '시작' 버튼이 F5 를 보내는 제품이 있습니다. 막지 않으면 수업 중에 새로고침됩니다. */
    if (REMOTE.pause.indexOf(e.code) >= 0) { e.preventDefault(); togglePause(); return; }
    if (e.code === 'Space') { e.preventDefault(); togglePause(); return; }
    if (e.code === 'Escape') { e.preventDefault(); if (!paused) togglePause(); return; }

    /* 멈춰 있을 때는 리모컨 '다음'으로 다시 시작합니다 */
    if (paused) {
      if (remoteKind(e.code) === 'good') { e.preventDefault(); togglePause(); }
      return;
    }
    if (finished || e.repeat) return;

    if (e.code === settings.keyGood) { e.preventDefault(); judge('good'); }
    else if (e.code === settings.keySoso) { e.preventDefault(); judge('soso'); }
    else if (e.code === settings.keyMiss) { e.preventDefault(); judge('miss'); }
    else {
      const kind = remoteKind(e.code);
      /* 기본 성공 방식에서는 리모컨 버튼이 모두 '실패' 입니다 — 못 친 아이만 눌러주세요 */
      if (kind) { e.preventDefault(); judge(settings.judgeMode === 'autoGood' ? 'miss' : kind); }
    }
  }

  function togglePause() {
    if (!active || finished) return;
    /* 리모컨은 한 번 눌러도 F5 와 Esc 가 잇따라 오는 제품이 있어 두 번 토글되는 것을 막습니다 */
    const nowMs = performance.now();
    if (nowMs - lastToggleMs < 400) return;
    lastToggleMs = nowMs;
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

  /* 리모컨 확인용 — 이 키가 무슨 판정인지 알려줍니다 */
  function remoteLabel(code, autoGood) {
    if (autoGood && remoteKind(code)) return '실패';
    return remoteLabelRaw(code);
  }

  function remoteLabelRaw(code) {
    if (REMOTE.pause.indexOf(code) >= 0 || code === 'Space' || code === 'Escape') return '일시정지';
    const kind = remoteKind(code);
    return kind === 'good' ? '성공' : kind === 'soso' ? '살짝' : kind === 'miss' ? '실패' : '';
  }

  global.GPlay = { init: init, start: start, stop: stop, remoteLabel: remoteLabel };
})(window);
