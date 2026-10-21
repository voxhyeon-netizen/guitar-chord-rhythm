/* Chart editor: waveform + beat grid, place chords on a timeline. */
(function (global) {
  const H = 200;
  const WAVE_TOP = 8, WAVE_H = 92;
  const RULER_TOP = WAVE_TOP + WAVE_H, RULER_H = 20;
  const NOTE_TOP = RULER_TOP + RULER_H + 2, NOTE_H = 64;
  const PEAK_RES = 180; // waveform buckets per second

  let el = {};
  let hooks = {};
  let song = null;
  let peaks = null;
  let pxPerSec = 110;
  let brush = 'C';
  let selected = -1;
  let dirty = false;
  let hoverT = null;
  let dragging = null;     // { index, grabDt }
  let scrubbing = false;   // 파형 위를 끌어서 재생선 옮기는 중
  let rafId = 0;
  let active = false;
  let taps = [];
  let dpr = 1;
  let lastPointerType = 'mouse';

  function $(id) { return document.getElementById(id); }

  function init(h) {
    hooks = h || {};
    el = {
      screen: $('screen-editor'),
      title: $('edTitle'),
      file: $('edFile'),
      back: $('edBack'),
      save: $('edSave'),
      exportBtn: $('edExport'),
      playtest: $('edPlaytest'),
      replaceAudio: $('edReplaceAudio'),
      playPause: $('edPlayPause'),
      stop: $('edStop'),
      time: $('edTime'),
      bpm: $('edBpm'),
      tap: $('edTap'),
      offset: $('edOffset'),
      setOffset: $('edSetOffset'),
      snapSound: $('edSnapSound'),
      beats: $('edBeats'),
      snap: $('edSnap'),
      metro: $('edMetro'),
      rate: $('edRate'),
      zoom: $('edZoom'),
      timeline: $('edTimeline'),
      wrap: $('edCanvasWrap'),
      canvas: $('edCanvas'),
      palette: $('edPalette'),
      brushBox: $('edBrush'),
      place: $('edPlace'),
      notes: $('edNotes'),
    };

    buildPalette();

    el.back.addEventListener('click', function () {
      if (dirty && !confirm('저장하지 않은 변경이 있어요. 목록으로 나갈까요?')) return;
      if (hooks.onBack) hooks.onBack();
    });
    el.save.addEventListener('click', save);
    el.exportBtn.addEventListener('click', exportJson);
    el.playtest.addEventListener('click', function () {
      if (!song.notes.length) { toast('먼저 코드를 찍어주세요.'); return; }
      save();
      if (hooks.onPlaytest) hooks.onPlaytest(song);
    });

    el.replaceAudio.addEventListener('click', function () {
      if (hooks.onReplaceAudio) hooks.onReplaceAudio(song);
    });

    el.playPause.addEventListener('click', togglePlay);
    el.stop.addEventListener('click', function () {
      GAudio.pause();
      GAudio.seek(0);
      GAudio.stopMetro();
      el.playPause.textContent = '▶';
      el.timeline.scrollLeft = 0;
    });

    el.bpm.addEventListener('input', function () {
      song.bpm = clampNum(parseFloat(el.bpm.value), 30, 300, 90);
      dirty = true;
      restartMetroIfOn();
    });
    el.offset.addEventListener('input', function () {
      song.offset = Math.max(0, parseFloat(el.offset.value) || 0);
      dirty = true;
      restartMetroIfOn();
    });
    el.snapSound.addEventListener('click', snapToOnset);
    el.setOffset.addEventListener('click', function () {
      song.offset = Math.round(GAudio.now() * 1000) / 1000;
      el.offset.value = song.offset.toFixed(2);
      dirty = true;
      restartMetroIfOn();
      toast('첫 박을 ' + song.offset.toFixed(2) + '초로 맞췄어요.');
    });
    el.beats.addEventListener('change', function () {
      song.beatsPerBar = parseInt(el.beats.value, 10) || 4;
      dirty = true;
      restartMetroIfOn();
    });
    el.snap.addEventListener('change', function () { song.snap = el.snap.value; });
    el.metro.addEventListener('change', function () {
      if (el.metro.checked) GAudio.startMetro(song.bpm, song.offset, song.beatsPerBar);
      else GAudio.stopMetro();
    });
    el.rate.addEventListener('change', function () { GAudio.setRate(parseFloat(el.rate.value)); });
    el.zoom.addEventListener('input', function () {
      const center = (el.timeline.scrollLeft + el.timeline.clientWidth / 2) / pxPerSec;
      pxPerSec = parseInt(el.zoom.value, 10);
      layout();
      el.timeline.scrollLeft = Math.max(0, center * pxPerSec - el.timeline.clientWidth / 2);
    });
    el.prog = $('edProg');
    el.progUnit = $('edProgUnit');
    el.progTimes = $('edProgTimes');
    el.progToEnd = $('edProgToEnd');
    el.progClear = $('edProgClear');
    el.progFill = $('edProgFill');
    el.progFill.addEventListener('click', fillProgression);
    el.prog.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); fillProgression(); }
    });
    el.progToEnd.addEventListener('change', function () {
      el.progTimes.disabled = el.progToEnd.checked;
    });

    /* 누르는 순간(pointerdown)에 받습니다 — click 은 손을 뗄 때라 박자가 밀립니다 */
    el.tap.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      tapTempo(e.timeStamp);
    });
    el.tap.addEventListener('click', function (e) { e.preventDefault(); });
    el.place.addEventListener('click', function () { placeAt(GAudio.now(), true); });

    el.canvas.addEventListener('pointerdown', onCanvasDown);
    el.canvas.addEventListener('pointermove', onCanvasMove);
    el.canvas.addEventListener('pointerleave', function () { hoverT = null; });
    global.addEventListener('pointerup', onCanvasUp);
    global.addEventListener('pointercancel', onCanvasUp);
    el.canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();                       // no browser menu on long-press either
      if (lastPointerType === 'touch') return;  // a finger long-press must not delete
      const hit = hitNote(e);
      if (hit >= 0) removeNote(hit);
    });
    global.addEventListener('resize', function () { if (active) layout(); });
    document.addEventListener('keydown', onKey);
  }

  function clampNum(v, lo, hi, dflt) {
    if (!isFinite(v)) return dflt;
    return Math.max(lo, Math.min(hi, v));
  }

  function toast(msg) { if (global.GMain) GMain.toast(msg); }

  /* ---------- open / close ---------- */
  function open(s) {
    song = s;
    if (!song.snap) song.snap = '1';
    if (!song.beatsPerBar) song.beatsPerBar = 4;
    if (!song.bpm) song.bpm = 90;
    if (song.offset == null) song.offset = 0;
    if (!song.notes) song.notes = [];
    selected = -1;
    dirty = false;
    taps = [];
    active = true;

    el.title.value = song.title || '';
    el.file.textContent = song.audio || '(mp3 없음)';
    el.bpm.value = song.bpm;
    el.offset.value = Number(song.offset).toFixed(2);
    el.beats.value = String(song.beatsPerBar);
    el.snap.value = song.snap;
    el.metro.checked = false;
    el.tap.textContent = '탭 템포 (T)';
    taps = [];
    el.rate.value = '1';
    GAudio.setRate(1);
    GAudio.stopMetro();

    refreshAudio();
    setBrush(brush);
    layout();
    el.timeline.scrollLeft = 0;
    renderNoteList();
    loop();
  }

  function close() {
    active = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    GAudio.pause();
    GAudio.stopMetro();
    el.playPause.textContent = '▶';
  }

  /* Recompute waveform + width after the audio changed. */
  function refreshAudio() {
    peaks = null;
    song.duration = GAudio.duration();
    el.file.textContent = song.audio || '(mp3 없음)';
    layout();
    if (!GAudio.hasAudio()) return;
    /* 파형을 그리려면 음원을 한 번 해독해야 합니다 (채보 화면에서만) */
    GAudio.ensureDecoded().then(function () {
      peaks = GAudio.peaks(PEAK_RES);
      if (!song.duration) song.duration = GAudio.duration();
    }).catch(function () { peaks = null; });
  }

  function getSong() {
    song.title = el.title.value.trim() || song.title || '제목 없는 곡';
    return song;
  }

  function save() {
    getSong();
    song.notes.sort(function (a, b) { return a.t - b.t; });
    if (!hooks.onSave) return;
    const done = hooks.onSave(song);
    if (done && done.then) done.then(function () { dirty = false; }).catch(function () {});
    else dirty = false;
  }

  function exportJson() {
    getSong();
    const data = {
      format: 'gchord-chart-v1',
      title: song.title,
      audio: song.audio || '',
      bpm: song.bpm,
      offset: song.offset,
      beatsPerBar: song.beatsPerBar,
      duration: song.duration,
      notes: song.notes.map(function (n) { return { t: Math.round(n.t * 1000) / 1000, chord: n.chord }; }),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (song.title || 'chart').replace(/[\\/:*?"<>|]/g, '_') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------- palette ---------- */
  function buildPalette() {
    const frag = document.createDocumentFragment();
    GChords.names().forEach(function (name) {
      const col = GChords.colorOf(name);
      const b = document.createElement('button');
      b.className = 'pal-btn';
      b.textContent = name;
      b.style.background = col.main;
      b.dataset.chord = name;
      b.addEventListener('click', function () {
        setBrush(name);
        if (GAudio.isPlaying()) placeAt(GAudio.now(), true);
      });
      frag.appendChild(b);
    });
    el.palette.appendChild(frag);
  }

  function setBrush(name) {
    brush = name;
    Array.prototype.forEach.call(el.palette.children, function (b) {
      b.classList.toggle('sel', b.dataset.chord === name);
    });
    el.brushBox.innerHTML = GChords.diagramSvg(name, { width: 120 });
  }

  /* ---------- grid helpers ---------- */
  function secPerBeat() { return 60 / (song.bpm || 90); }

  function snapUnitBeats() {
    const s = song.snap;
    if (s === 'bar') return song.beatsPerBar;
    if (s === 'half') return song.beatsPerBar / 2;
    if (s === '0') return 0;
    return parseFloat(s) || 1;
  }

  function snapTime(t) {
    const beats = snapUnitBeats();
    if (!beats) return Math.max(0, t);
    const unit = secPerBeat() * beats;
    const n = Math.round((t - song.offset) / unit);
    return Math.max(0, song.offset + n * unit);
  }

  /* ---------- 코드 진행 한 번에 채우기 ----------
     동요는 같은 진행이 계속 반복됩니다. 하나씩 찍는 대신 'C G Am F' 를 적고
     한 코드당 길이와 반복 횟수만 정하면 한 번에 깔립니다. */
  function parseProgression(text) {
    const known = GChords.names();
    const chords = String(text || '').split(/[\s,|]+/).filter(Boolean);
    const unknown = chords.filter(function (c) { return known.indexOf(c) < 0; });
    return { chords: chords, unknown: unknown };
  }

  /* 한 코드가 차지하는 시간 */
  function fillStepSec() {
    const u = el.progUnit.value;
    const beats = u === '2bar' ? song.beatsPerBar * 2
      : u === 'bar' ? song.beatsPerBar
      : u === 'half' ? song.beatsPerBar / 2
      : 1;
    return secPerBeat() * beats;
  }

  function fillProgression() {
    if (!song) return;
    const p = parseProgression(el.prog.value);
    if (!p.chords.length) { toast('코드 진행을 적어주세요. 예: C G Am F'); return; }
    if (p.unknown.length) {
      toast('팔레트에 없는 코드예요: ' + p.unknown.join(', '));
      return;
    }

    const step = fillStepSec();
    if (!(step > 0)) { toast('BPM 과 박자를 먼저 맞춰주세요.'); return; }

    /* 멈춰 있는 지점부터. 맨 앞이면 첫 박부터 */
    const nowT = GAudio.hasAudio() ? GAudio.now() : 0;
    const start = snapTime(nowT > 0.05 ? nowT : song.offset);
    const dur = song.duration || GAudio.duration() || 0;

    let count;
    if (el.progToEnd.checked) {
      if (!dur) { toast('음원 길이를 몰라서 끝까지 채울 수 없어요.'); return; }
      count = Math.floor((dur - start) / step);
      if (count < 1) { toast('여기서부터는 채울 자리가 없어요.'); return; }
    } else {
      const times = clampNum(parseInt(el.progTimes.value, 10), 1, 200, 1);
      count = p.chords.length * times;
    }

    const end = start + count * step;
    if (el.progClear.checked) {
      song.notes = song.notes.filter(function (n) { return n.t < start - 0.001 || n.t > end - 0.001; });
    }

    let placed = 0;
    for (let i = 0; i < count; i++) {
      const t = Math.round((start + i * step) * 1000) / 1000;
      if (dur && t > dur - 0.05) break;
      const chord = p.chords[i % p.chords.length];
      const j = song.notes.findIndex(function (n) { return Math.abs(n.t - t) < 0.015; });
      if (j >= 0) song.notes[j].chord = chord;
      else song.notes.push({ t: t, chord: chord });
      placed++;
    }

    song.notes.sort(function (a, b) { return a.t - b.t; });
    selected = -1;
    dirty = true;
    renderNoteList();
    GAudio.sfx.click();
    toast(placed ? placed + '개를 채웠어요 (' + start.toFixed(2) + '초부터)' : '채울 자리가 없어요.');
  }

  /* ---------- notes ---------- */
  function placeAt(t, snap) {
    const time = snap === false ? Math.max(0, t) : snapTime(t);
    const i = song.notes.findIndex(function (n) { return Math.abs(n.t - time) < 0.015; });
    if (i >= 0) {
      song.notes[i].chord = brush;
      selected = i;
    } else {
      song.notes.push({ t: time, chord: brush });
      song.notes.sort(function (a, b) { return a.t - b.t; });
      selected = song.notes.findIndex(function (n) { return n.t === time; });
    }
    dirty = true;
    GAudio.sfx.click();
    renderNoteList();
  }

  function removeNote(i) {
    if (i < 0 || i >= song.notes.length) return;
    song.notes.splice(i, 1);
    if (selected === i) selected = -1;
    else if (selected > i) selected--;
    dirty = true;
    renderNoteList();
  }

  function noteWidthPx() {
    return Math.max(26, Math.min(pxPerSec * 0.45, 84));
  }

  function hitNote(e) {
    const r = el.canvas.getBoundingClientRect();
    const y = e.clientY - r.top;
    if (y < NOTE_TOP - 4) return -1;
    const t = (e.clientX - r.left + el.timeline.scrollLeft) / pxPerSec;
    const w = noteWidthPx() / pxPerSec;
    for (let i = song.notes.length - 1; i >= 0; i--) {
      const n = song.notes[i];
      if (t >= n.t && t <= n.t + w) return i;
    }
    return -1;
  }

  function onCanvasDown(e) {
    lastPointerType = e.pointerType || 'mouse';
    if (e.pointerId != null && el.canvas.setPointerCapture) {
      try { el.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    const r = el.canvas.getBoundingClientRect();
    const y = e.clientY - r.top;
    const t = (e.clientX - r.left + el.timeline.scrollLeft) / pxPerSec;

    if (y < NOTE_TOP - 4) {   // 파형·마디 영역 → 재생선 이동 (끌면 계속 따라옵니다)
      scrubbing = true;
      GAudio.seek(Math.max(0, t));
      if (el.metro.checked) restartMetroIfOn();
      return;
    }
    const hit = hitNote(e);
    if (hit >= 0) {
      selected = hit;
      dragging = { index: hit, grabDt: t - song.notes[hit].t };
      setBrush(song.notes[hit].chord);
      renderNoteList();
      return;
    }
    placeAt(t, true);
  }

  function onCanvasMove(e) {
    const r = el.canvas.getBoundingClientRect();
    const y = e.clientY - r.top;
    const t = (e.clientX - r.left + el.timeline.scrollLeft) / pxPerSec;
    hoverT = y >= NOTE_TOP - 4 ? snapTime(t) : null;

    if (scrubbing) {
      GAudio.seek(Math.max(0, t));
      return;
    }

    if (dragging) {
      const n = song.notes[dragging.index];
      if (!n) { dragging = null; return; }
      n.t = snapTime(Math.max(0, t - dragging.grabDt));
      dirty = true;
    }
  }

  function onCanvasUp() {
    if (scrubbing) {
      scrubbing = false;
      if (el.metro.checked) restartMetroIfOn();
    }
    if (!dragging) return;
    const moved = song.notes[dragging.index];
    dragging = null;
    song.notes.sort(function (a, b) { return a.t - b.t; });
    selected = song.notes.indexOf(moved);
    renderNoteList();
  }

  function onKey(e) {
    if (!active) return;
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

    if (e.code === 'Space' && !typing) {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (e.code === 'Enter' && !typing) {
      e.preventDefault();
      placeAt(GAudio.now(), true);
      return;
    }
    if (typing) return;

    if (e.code === 'KeyT') {
      e.preventDefault();
      if (!e.repeat) tapTempo(e.timeStamp);
      return;
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      e.preventDefault();
      removeNote(selected);
      return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : secPerBeat();
      GAudio.seek(GAudio.now() + (e.code === 'ArrowRight' ? step : -step));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
      e.preventDefault();
      save();
    }
  }

  function togglePlay() {
    GAudio.resume().then(function () {
      if (GAudio.isPlaying()) {
        GAudio.pause();
        GAudio.stopMetro();
        el.playPause.textContent = '▶';
      } else {
        if (GAudio.now() >= GAudio.duration() - 0.05) GAudio.seek(0);
        GAudio.play(GAudio.now());
        if (el.metro.checked) GAudio.startMetro(song.bpm, song.offset, song.beatsPerBar);
        el.playPause.textContent = '❚❚';
      }
    });
  }

  /* 재생선 근처에서 '소리가 시작되는 지점'을 찾아 정확히 옮깁니다.
     박 위치를 눈대중으로 맞추지 않아도 되게 해주는 기능입니다. */
  /* t 근처에서 '소리가 시작되는 지점'을 찾습니다. 없으면 null. */
  function nearestOnset(t, win) {
    if (!peaks) return null;
    const res = peaks.perSecond;
    const from = Math.max(2, Math.floor((t - win) * res));
    const to = Math.min(peaks.count - 1, Math.ceil((t + win) * res));
    if (to <= from) return null;
    const cands = [];
    let peakJump = 0;
    for (let i = from; i <= to; i++) {
      const energy = peaks.max[i] - peaks.min[i];
      const prev = ((peaks.max[i - 1] - peaks.min[i - 1]) + (peaks.max[i - 2] - peaks.min[i - 2])) / 2;
      const jump = energy - prev * 1.15;
      if (jump > peakJump) peakJump = jump;
      if (jump > 0.02) cands.push({ i: i, jump: jump });
    }
    if (!cands.length) return null;
    const strong = cands.filter(function (c) { return c.jump >= peakJump * 0.35; });
    const pick = (strong.length ? strong : cands).reduce(function (a, b) {
      return Math.abs(b.i / res - t) < Math.abs(a.i / res - t) ? b : a;
    });
    return Math.max(0, pick.i / res);
  }

  function snapToOnset() {
    if (!peaks) { toast('파형을 아직 읽는 중이에요. 잠시 뒤 다시 눌러주세요.'); return; }
    const t = GAudio.now();
    const res = peaks.perSecond;
    const win = 0.45;                        // 앞뒤로 살펴볼 범위(초)
    const at = nearestOnset(t, win);
    if (at == null) { toast('가까운 곳에서 뚜렷한 소리를 찾지 못했어요.'); return; }
    GAudio.seek(at);
    restartMetroIfOn();
    toast('소리 시작점 ' + fmt(at) + ' 으로 맞췄어요.');
  }

  function restartMetroIfOn() {
    if (!el.metro.checked) return;
    GAudio.stopMetro();
    GAudio.startMetro(song.bpm, song.offset, song.beatsPerBar);
  }

  /* 탭 템포.
     노래를 재생한 채로 두드리면 BPM 과 첫박을 함께 잡아줍니다.
     (각 탭의 '노래 시각'을 모아 직선으로 맞추는 방식이라 몇 번만 쳐도 안정적입니다) */
  function tapTempo(stamp) {
    const ms = stamp != null ? stamp : performance.now();
    const playing = GAudio.isPlaying();
    const songT = playing ? GAudio.now() : null;

    if (taps.length && ms - taps[taps.length - 1].ms > 2500) taps = [];   // 쉬었다 치면 새로 시작
    taps.push({ ms: ms, songT: songT });
    if (taps.length > 12) taps.shift();

    GAudio.tickNow(taps.length === 1);
    flashTap();

    if (taps.length < 2) {
      el.tap.textContent = '탭 1…';
      toast('노래를 재생한 채 박자에 맞춰 계속 두드리세요 (T)');
      return;
    }

    /* 직선 맞춤: 시각 ≈ 첫박 + 순번 × 한박길이 */
    const useSong = taps.every(function (t) { return t.songT != null; });
    const xs = [];
    taps.forEach(function (t, i) { xs.push(i); });
    const ys = taps.map(function (t) { return useSong ? t.songT : t.ms / 1000; });
    const mx = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
    const my = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length;
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) * (xs[i] - mx);
    }
    if (den <= 0) return;
    const spb = num / den;                       // 한 박의 길이(초)
    if (!(spb > 0.15 && spb < 2.5)) return;      // 24~400 BPM 범위 밖이면 무시

    const bpm = Math.round((60 / spb) * 10) / 10;
    song.bpm = clampNum(bpm, 30, 300, song.bpm);
    el.bpm.value = song.bpm;
    dirty = true;

    let msg = '탭 ' + taps.length + '회 · ' + song.bpm + ' BPM';
    if (useSong && taps.length >= 3) {
      let first = Math.max(0, my - spb * mx);    // 첫 번째로 두드린 박의 노래 시각

      /* 귀로 듣고 손으로 치면 일정하게 늦습니다.
         각 박 근처의 '소리 시작점'과 얼마나 어긋났는지 모아 가운데값만큼 통째로 당겨줍니다. */
      const win = Math.min(0.18, spb * 0.3);
      const deltas = [];
      for (let k = 0; k < taps.length; k++) {
        const predicted = first + k * spb;
        const onset = nearestOnset(predicted, win);
        if (onset != null) deltas.push(onset - predicted);
      }
      let note = '';
      if (deltas.length >= 3) {
        deltas.sort(function (a, b) { return a - b; });
        const mid = deltas.length % 2
          ? deltas[(deltas.length - 1) / 2]
          : (deltas[deltas.length / 2 - 1] + deltas[deltas.length / 2]) / 2;
        first = Math.max(0, first + mid);
        note = ' (소리에 맞춤)';
      } else {
        const snapped = nearestOnset(first, win);
        if (snapped != null) { first = snapped; note = ' (소리에 맞춤)'; }
      }

      song.offset = Math.round(first * 1000) / 1000;
      el.offset.value = song.offset.toFixed(2);
      msg += ' · 첫박 ' + song.offset.toFixed(2) + '초' + note;
    }
    el.tap.textContent = '탭 ' + taps.length + ' · ' + song.bpm;
    restartMetroIfOn();
    toast(msg);
  }

  function flashTap() {
    el.tap.classList.add('tap-hit');
    setTimeout(function () { el.tap.classList.remove('tap-hit'); }, 90);
  }

  /* ---------- note list ---------- */
  function renderNoteList() {
    el.notes.innerHTML = '';
    const frag = document.createDocumentFragment();
    song.notes.forEach(function (n, i) {
      const col = GChords.colorOf(n.chord);
      const chip = document.createElement('div');
      chip.className = 'note-chip' + (i === selected ? ' sel' : '');
      chip.style.background = col.main;
      chip.innerHTML = '<b>' + n.chord + '</b><span>' + fmt(n.t) + '</span>';
      chip.addEventListener('click', function (e) {
        if (e.target.tagName === 'BUTTON') return;
        selected = i;
        GAudio.seek(Math.max(0, n.t - 0.4));
        follow(true);
        renderNoteList();
      });
      const x = document.createElement('button');
      x.textContent = '×';
      x.title = '삭제';
      x.addEventListener('click', function (ev) { ev.stopPropagation(); removeNote(i); });
      chip.appendChild(x);
      frag.appendChild(chip);
    });
    el.notes.appendChild(frag);
  }

  function fmt(t) {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  /* ---------- drawing ---------- */
  function layout() {
    const dur = Math.max(GAudio.duration(), 10);
    el.wrap.style.width = Math.ceil(dur * pxPerSec) + 'px';
    dpr = global.devicePixelRatio || 1;
    const w = el.timeline.clientWidth || 800;
    el.canvas.style.width = w + 'px';
    el.canvas.width = Math.floor(w * dpr);
    el.canvas.height = Math.floor(H * dpr);
  }

  function follow(forceCenter) {
    const w = el.timeline.clientWidth;
    const x = GAudio.now() * pxPerSec;
    const target = x - w * (forceCenter ? 0.4 : 0.35);
    if (forceCenter || x - el.timeline.scrollLeft > w * 0.72 || x < el.timeline.scrollLeft) {
      el.timeline.scrollLeft = Math.max(0, target);
    }
  }

  function loop() {
    if (!active) return;
    if (GAudio.isPlaying()) follow(false);
    draw();
    const t = GAudio.now();
    el.time.textContent = fmt(t) + ' / ' + fmt(GAudio.duration());
    if (!GAudio.isPlaying() && el.playPause.textContent !== '▶') el.playPause.textContent = '▶';
    rafId = requestAnimationFrame(loop);
  }

  function draw() {
    const ctx = el.canvas.getContext('2d');
    const w = el.canvas.width / dpr;
    const scroll = el.timeline.scrollLeft;
    const t0 = scroll / pxPerSec;
    const t1 = (scroll + w) / pxPerSec;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, H);
    ctx.fillStyle = '#0d1527';
    ctx.fillRect(0, 0, w, H);

    /* beat + bar grid */
    const spb = secPerBeat();
    const bpb = song.beatsPerBar || 4;
    if (spb > 0.05 && pxPerSec * spb > 4) {
      let b = Math.floor((t0 - song.offset) / spb) - 1;
      const bEnd = Math.ceil((t1 - song.offset) / spb) + 1;
      for (; b <= bEnd; b++) {
        const t = song.offset + b * spb;
        if (t < 0) continue;
        const x = Math.round(t * pxPerSec - scroll) + 0.5;
        const isBar = ((b % bpb) + bpb) % bpb === 0;
        ctx.strokeStyle = isBar ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.09)';
        ctx.lineWidth = isBar ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
        if (isBar) {
          ctx.fillStyle = 'rgba(255,255,255,.45)';
          ctx.font = '700 10px Nunito, sans-serif';
          ctx.fillText(String(Math.floor(b / bpb) + 1), x + 3, RULER_TOP + 14);
        }
      }
    }

    /* waveform */
    if (peaks) {
      ctx.fillStyle = 'rgba(126,181,255,.55)';
      const mid = WAVE_TOP + WAVE_H / 2;
      const half = WAVE_H / 2 - 2;
      for (let px = 0; px < w; px++) {
        const ts = (scroll + px) / pxPerSec;
        const te = (scroll + px + 1) / pxPerSec;
        let i0 = Math.floor(ts * peaks.perSecond);
        let i1 = Math.max(i0 + 1, Math.floor(te * peaks.perSecond));
        if (i0 < 0 || i0 >= peaks.count) continue;
        if (i1 > peaks.count) i1 = peaks.count;
        let lo = 0, hi = 0;
        for (let i = i0; i < i1; i++) {
          if (peaks.min[i] < lo) lo = peaks.min[i];
          if (peaks.max[i] > hi) hi = peaks.max[i];
        }
        const y0 = mid - hi * half;
        const y1 = mid - lo * half;
        ctx.fillRect(px, y0, 1, Math.max(1, y1 - y0));
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.font = '800 13px Nunito, sans-serif';
      ctx.fillText('mp3를 불러오면 파형이 보여요', 14, WAVE_TOP + WAVE_H / 2);
    }

    /* note lane background */
    ctx.fillStyle = 'rgba(255,255,255,.04)';
    ctx.fillRect(0, NOTE_TOP, w, NOTE_H);

    /* hover ghost */
    if (hoverT != null && !dragging) {
      const gx = hoverT * pxPerSec - scroll;
      ctx.globalAlpha = 0.35;
      drawNoteBox(ctx, gx, brush, false);
      ctx.globalAlpha = 1;
    }

    /* notes */
    const nw = noteWidthPx();
    for (let i = 0; i < song.notes.length; i++) {
      const n = song.notes[i];
      if (n.t > t1 + 1 || n.t * pxPerSec + nw < scroll - 1) continue;
      drawNoteBox(ctx, n.t * pxPerSec - scroll, n.chord, i === selected);
    }

    /* playhead */
    const px = GAudio.now() * pxPerSec - scroll;
    ctx.strokeStyle = '#ffa502';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();
    ctx.fillStyle = '#ffa502';
    ctx.beginPath();
    ctx.moveTo(px - 6, 0);
    ctx.lineTo(px + 6, 0);
    ctx.lineTo(px, 9);
    ctx.closePath();
    ctx.fill();
  }

  function drawNoteBox(ctx, x, chord, isSel) {
    const w = noteWidthPx();
    const col = GChords.colorOf(chord);
    roundRect(ctx, x, NOTE_TOP + 4, w, NOTE_H - 10, 9);
    ctx.fillStyle = col.main;
    ctx.fill();
    ctx.strokeStyle = isSel ? '#fff' : col.dark;
    ctx.lineWidth = isSel ? 3 : 2;
    ctx.stroke();
    ctx.fillStyle = '#10203a';
    ctx.font = '900 16px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(chord, x + w / 2, NOTE_TOP + NOTE_H / 2 + 4, w - 6);
    ctx.textAlign = 'left';
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  global.GEditor = {
    init: init,
    open: open,
    close: close,
    getSong: getSong,
    refreshAudio: refreshAudio,
    isDirty: function () { return dirty; },
  };
})(window);
