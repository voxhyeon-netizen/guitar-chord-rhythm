/* 재생 엔진.

   아이패드(iOS)에서는 Web Audio 로 낸 소리가 무음 처리되는 경우가 있어,
   노래와 효과음을 모두 <audio> 요소(음악 앱과 같은 경로)로 냅니다.
   Web Audio 는 파형 분석과 메트로놈에만 씁니다(맥의 채보 화면 전용). */
(function (global) {
  let el = null;            // 노래 재생용 <audio>
  let objectUrl = null;
  let rate = 1;
  let volume = 1;
  let endCb = null;
  let unlocked = false;

  /* 재생 위치 보간용 — currentTime 은 띄엄띄엄 갱신돼서 그대로 쓰면 노트가 끊겨 보입니다 */
  let lastCt = -1;
  let lastCtAt = 0;

  function element() {
    if (el) return el;
    el = document.createElement('audio');
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');
    el.addEventListener('ended', function () { if (endCb) endCb(); });
    el.style.display = 'none';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  /* ---------- 불러오기 ---------- */
  function load(src) {
    const a = element();
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    decoded = null;
    decodedFor = null;
    srcBlob = (global.Blob && src instanceof Blob) ? src : null;
    const url = srcBlob ? (objectUrl = URL.createObjectURL(srcBlob)) : String(src);

    return new Promise(function (resolve, reject) {
      let done = false;
      function finish(ok, err) {
        if (done) return;
        done = true;
        a.removeEventListener('loadedmetadata', onMeta);
        a.removeEventListener('durationchange', onMeta);
        a.removeEventListener('error', onErr);
        clearTimeout(timer);
        ok ? resolve() : reject(err || new Error('audio-load-failed'));
      }
      function onMeta() { if (isFinite(a.duration) && a.duration > 0) finish(true); }
      function onErr() { finish(false, new Error('이 파일을 재생할 수 없어요')); }
      const timer = setTimeout(function () { finish(isFinite(a.duration) && a.duration > 0); }, 15000);

      a.addEventListener('loadedmetadata', onMeta);
      a.addEventListener('durationchange', onMeta);
      a.addEventListener('error', onErr);
      a.src = url;
      a.load();
    });
  }

  function hasAudio() { return !!(el && el.src); }
  function duration() { return (el && isFinite(el.duration)) ? el.duration : 0; }

  /* ---------- 재생 ---------- */
  function play(from) {
    const a = element();
    if (from != null) {
      try { a.currentTime = Math.max(0, Math.min(from, duration() || from)); } catch (e) { /* ignore */ }
    }
    a.playbackRate = rate;
    a.volume = volume;
    lastCt = -1;
    const p = a.play();
    if (p && p.catch) p.catch(function () { /* 사용자 제스처가 필요한 경우 */ });
    unlocked = true;
  }

  function pause() { if (el) el.pause(); }

  function stop() {
    if (!el) return;
    el.pause();
    try { el.currentTime = 0; } catch (e) { /* ignore */ }
  }

  function seek(sec) {
    const a = element();
    try { a.currentTime = Math.max(0, Math.min(sec, duration() || sec)); } catch (e) { /* ignore */ }
    lastCt = -1;
  }

  /* 부드럽게 보간한 현재 위치 */
  function now() {
    if (!el) return 0;
    const t = el.currentTime || 0;
    if (el.paused) { lastCt = -1; return t; }
    const ms = performance.now();
    if (t !== lastCt) { lastCt = t; lastCtAt = ms; return t; }
    return t + ((ms - lastCtAt) / 1000) * rate;
  }

  function isPlaying() { return !!(el && !el.paused && !el.ended); }

  function setRate(r) {
    rate = r;
    if (el) {
      el.playbackRate = r;
      /* 느리게 연습해도 음정은 그대로 유지 */
      el.preservesPitch = true;
      el.webkitPreservesPitch = true;
      el.mozPreservesPitch = true;
    }
  }
  function getRate() { return rate; }

  function setVolume(v) { volume = v; if (el) el.volume = v; }
  function onEnd(cb) { endCb = cb; }

  /* ---------- 아이패드 잠금 해제 ---------- */
  function unlock() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
    unlockSfx();
    if (el && el.paused && el.src) {
      const wasMuted = el.muted;
      el.muted = true;
      const p = el.play();
      if (p && p.then) {
        p.then(function () {
          el.pause();
          el.muted = wasMuted;
          unlocked = true;
        }).catch(function () { el.muted = wasMuted; });
      } else {
        el.pause();
        el.muted = wasMuted;
      }
    }
    try {
      const c = getCtx();
      if (c.state === 'suspended') c.resume();
    } catch (e) { /* ignore */ }
    return Promise.resolve();
  }

  function state() { return unlocked ? 'running' : 'suspended'; }

  /* ---------- 효과음 : 작은 WAV 를 만들어 <audio> 로 재생 ---------- */
  function wavUri(notes, totalDur) {
    const sr = 11025;
    const n = Math.max(1, Math.round(totalDur * sr));
    const data = new Float32Array(n);
    notes.forEach(function (nt) {
      const start = Math.round(nt.t * sr);
      const len = Math.round(nt.d * sr);
      for (let i = 0; i < len; i++) {
        const idx = start + i;
        if (idx >= n) break;
        const ph = 2 * Math.PI * nt.f * i / sr;
        let v;
        if (nt.type === 'square') v = Math.sin(ph) >= 0 ? 0.6 : -0.6;
        else if (nt.type === 'saw') v = (((ph / Math.PI) % 2) - 1) * 0.6;
        else v = Math.sin(ph);
        data[idx] += v * nt.g * Math.exp(-(nt.decay || 8) * i / sr);
      }
    });

    const bytes = new Uint8Array(44 + n * 2);
    const view = new DataView(bytes.buffer);
    function str(off, s) { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sr, true); view.setUint32(28, sr * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      let s = Math.max(-1, Math.min(1, data[i]));
      view.setInt16(44 + i * 2, s * 32000, true);
    }
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return 'data:audio/wav;base64,' + btoa(bin);
  }

  const SFX_SPEC = {
    click:   { dur: 0.09, notes: [{ f: 520, t: 0, d: 0.08, g: 0.5, decay: 30, type: 'square' }] },
    good:    { dur: 0.30, notes: [
                 { f: 880, t: 0, d: 0.12, g: 0.55 },
                 { f: 1320, t: 0.07, d: 0.2, g: 0.45 }] },
    soso:    { dur: 0.22, notes: [{ f: 620, t: 0, d: 0.2, g: 0.5, decay: 12, type: 'square' }] },
    miss:    { dur: 0.30, notes: [{ f: 170, t: 0, d: 0.28, g: 0.6, decay: 7, type: 'saw' }] },
    tick:    { dur: 0.08, notes: [{ f: 900, t: 0, d: 0.06, g: 0.5, decay: 40, type: 'square' }] },
    tickHi:  { dur: 0.08, notes: [{ f: 1400, t: 0, d: 0.06, g: 0.6, decay: 40, type: 'square' }] },
    fanfare: { dur: 0.80, notes: [
                 { f: 523, t: 0, d: 0.2, g: 0.5 }, { f: 659, t: 0.15, d: 0.2, g: 0.5 },
                 { f: 784, t: 0.3, d: 0.2, g: 0.5 }, { f: 1047, t: 0.45, d: 0.3, g: 0.5 }] },
  };

  const pools = {};
  function pool(name) {
    if (pools[name]) return pools[name];
    const spec = SFX_SPEC[name];
    if (!spec) return null;
    const uri = wavUri(spec.notes, spec.dur);
    const list = [];
    for (let i = 0; i < 2; i++) {
      const a = new Audio(uri);
      a.preload = 'auto';
      a.setAttribute('playsinline', '');
      list.push(a);
    }
    pools[name] = { list: list, i: 0 };
    return pools[name];
  }

  function playSfx(name) {
    const p = pool(name);
    if (!p) return;
    const a = p.list[p.i];
    p.i = (p.i + 1) % p.list.length;
    try {
      a.currentTime = 0;
      const r = a.play();
      if (r && r.catch) r.catch(function () { /* ignore */ });
    } catch (e) { /* ignore */ }
  }

  let sfxUnlocked = false;
  function unlockSfx() {
    if (sfxUnlocked) return;
    sfxUnlocked = true;
    Object.keys(SFX_SPEC).forEach(function (name) {
      const p = pool(name);
      if (!p) return;
      p.list.forEach(function (a) {
        a.muted = true;
        const r = a.play();
        if (r && r.then) {
          r.then(function () { a.pause(); a.currentTime = 0; a.muted = false; })
           .catch(function () { a.muted = false; });
        } else { a.pause(); a.muted = false; }
      });
    });
  }

  const sfx = {
    click: function () { playSfx('click'); },
    good: function () { playSfx('good'); },
    soso: function () { playSfx('soso'); },
    miss: function () { playSfx('miss'); },
    tick: function (strong) { playSfx(strong ? 'tickHi' : 'tick'); },
    fanfare: function () { playSfx('fanfare'); },
  };

  function testTone() { unlock(); playSfx('fanfare'); }

  /* ---------- Web Audio : 파형 분석 + 메트로놈 (맥 채보 화면 전용) ---------- */
  let ctx = null;
  let decoded = null;
  let decodedFor = null;
  let srcBlob = null;

  function getCtx() {
    if (!ctx) ctx = new (global.AudioContext || global.webkitAudioContext)();
    return ctx;
  }

  function resume() {
    try {
      const c = getCtx();
      if (c.state === 'suspended') return c.resume();
    } catch (e) { /* ignore */ }
    return Promise.resolve();
  }

  /* 파형을 그리려면 한 번 해독해야 합니다 (채보 화면에서만 호출) */
  function ensureDecoded() {
    if (decoded && decodedFor === (el && el.src)) return Promise.resolve(decoded);
    const want = el && el.src;
    const get = srcBlob ? Promise.resolve(srcBlob) : fetch(want).then(function (r) { return r.blob(); });
    return get.then(function (b) { return b.arrayBuffer(); }).then(function (ab) {
      return new Promise(function (resolve, reject) {
        getCtx().decodeAudioData(ab, function (buf) {
          decoded = buf;
          decodedFor = want;
          resolve(buf);
        }, reject);
      });
    });
  }

  function peaks(perSecond) {
    if (!decoded) return null;
    const data = decoded.getChannelData(0);
    const count = Math.max(1, Math.ceil(decoded.duration * perSecond));
    const block = data.length / count;
    const min = new Float32Array(count);
    const max = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const s = Math.floor(i * block);
      const e = Math.min(data.length, Math.floor((i + 1) * block));
      let lo = 0, hi = 0;
      for (let j = s; j < e; j += 2) {
        const v = data[j];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[i] = lo;
      max[i] = hi;
    }
    return { min: min, max: max, perSecond: perSecond, count: count };
  }

  /* 메트로놈은 정확도가 중요해서 Web Audio 로 예약합니다 (맥에서만 씀) */
  let metro = null;
  function metroTick(strong, when) {
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'square';
      osc.frequency.value = strong ? 1400 : 900;
      g.gain.setValueAtTime(strong ? 0.16 : 0.09, when);
      g.gain.exponentialRampToValueAtTime(0.0008, when + 0.035);
      osc.connect(g); g.connect(c.destination);
      osc.start(when); osc.stop(when + 0.06);
    } catch (e) { /* ignore */ }
  }

  function startMetro(bpm, offset, beatsPerBar) {
    stopMetro();
    if (!bpm) return;
    resume();
    const spb = 60 / bpm;
    let next = Math.max(0, Math.ceil((now() - offset) / spb));
    metro = setInterval(function () {
      if (!isPlaying()) return;
      const c = getCtx();
      const songT = now();
      for (let guard = 0; guard < 16; guard++) {
        const bt = offset + next * spb;
        if (bt > songT + 0.25) break;
        if (bt >= songT - 0.02) metroTick(next % (beatsPerBar || 4) === 0, c.currentTime + (bt - songT) / rate);
        next++;
      }
    }, 60);
  }

  function stopMetro() { if (metro) { clearInterval(metro); metro = null; } }

  global.GAudio = {
    load: load, hasAudio: hasAudio, duration: duration,
    play: play, pause: pause, stop: stop, seek: seek, now: now, isPlaying: isPlaying,
    setRate: setRate, getRate: getRate, setVolume: setVolume, onEnd: onEnd,
    unlock: unlock, resume: resume, state: state, testTone: testTone,
    ensureDecoded: ensureDecoded, peaks: peaks, sfx: sfx,
    startMetro: startMetro, stopMetro: stopMetro, ctx: getCtx,
  };
})(window);
