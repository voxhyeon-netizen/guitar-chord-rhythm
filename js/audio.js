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
  let songUnlocked = false;
  let unlockToken = 0;      // 잠금 해제 중에 진짜 재생이 시작되면 건드리지 않게 하는 표식
  let unlocking = false;    // 잠금 해제용 무음 재생 중 — '재생 중'으로 세면 안 됩니다

  /* 재생 위치 보간용 — currentTime 은 띄엄띄엄 갱신돼서 그대로 쓰면 노트가 끊겨 보입니다 */
  let lastCt = -1;
  let lastCtAt = 0;
  let seekTarget = null;   // 옮긴 위치를 브라우저가 따라오기 전에도 화면에 바로 반영
  let seekAtMs = 0;        // 그 위치로 옮기라고 말한 시각
  let primed = false;      // 소리를 끈 채로 미리 틀어 두었는가 (아이패드용)
  let elGen = 0;           // 몇 번째 음원 요소인가 — 지난 요소의 신호를 가려내려고
  const SEEK_WAIT = 1000;  // 브라우저가 따라올 때까지 기다려 주는 시간(ms)

  function element() {
    if (el) return el;
    return freshElement();
  }

  /* 곡을 바꿀 때마다 요소를 새로 만듭니다.
     하나를 계속 돌려쓰면 아이패드에서 이전 곡의 상태가 남아,
     노래를 틀자마자 '끝났다' 고 알려오는 일이 있습니다. */
  function freshElement() {
    const old = el;
    if (old) {
      try { old.pause(); } catch (e) { /* ignore */ }
      try { old.removeAttribute('src'); old.load(); } catch (e) { /* ignore */ }
      if (old.parentNode) old.parentNode.removeChild(old);
    }

    const mine = ++elGen;
    const node = document.createElement('audio');
    node.preload = 'auto';
    node.setAttribute('playsinline', '');
    node.setAttribute('webkit-playsinline', '');

    /* '끝났다' 는 신호를 곧이곧대로 넘기지 않습니다.
       곡을 바꾸면 이전 음원을 정리하면서 뒤늦게 '끝났다' 가 날아오는데,
       그걸 그대로 받으면 새 곡이 시작하기도 전에 끝난 것으로 처리됩니다.
       (아이패드에서 '틀자마자 게임이 끝나던' 원인이 이것이었습니다.) */
    node.addEventListener('ended', function () {
      if (node !== el || mine !== elGen) return;                 // 지난 요소가 보낸 것
      if (!isFinite(node.duration) || node.duration <= 0) return; // 길이도 모르면서 끝났다?
      if (node.currentTime < node.duration - 1.5) return;         // 아직 끝 근처도 아님
      if (endCb) endCb();
    });

    node.style.display = 'none';
    (document.body || document.documentElement).appendChild(node);
    el = node;
    lastCt = -1;
    seekTarget = null;
    primed = false;
    return node;
  }

  /* ---------- 불러오기 ---------- */
  function load(src) {
    const a = freshElement();     // 새 요소로 시작합니다
    a.muted = false;
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
      songUnlocked = false;   // src 가 바뀌면 아이패드는 재생 허락을 다시 받아야 합니다
      a.src = url;
      a.load();
    });
  }

  /* 아이패드는 '사용자가 누른 직후' 가 아니면 재생을 막습니다.
     그런데 카운트(딱딱딱) 때문에 진짜 재생은 2~3초 뒤에야 시작합니다.
     그래서 누른 직후에 소리를 끈 채로 미리 틀어 둡니다. 멈추지 않고 계속 돌려두면
     나중에 소리를 켜고 처음으로 되감는 것은 막히지 않습니다. */
  function prime() {
    const a = element();
    if (!a.src) return Promise.resolve(false);
    a.muted = true;
    a.playbackRate = rate;
    if ((a.currentTime || 0) > 0.05) {
      try { a.currentTime = 0; } catch (e) { /* ignore */ }
      seekTarget = 0;
      seekAtMs = performance.now();
    }
    primed = false;
    const p = a.play();
    if (p && p.then) {
      return p.then(function () { primed = true; unlocked = true; songUnlocked = true; return true; })
              .catch(function () { return false; });
    }
    primed = true; unlocked = true; songUnlocked = true;
    return Promise.resolve(true);
  }

  function isPrimed() { return primed; }

  function hasAudio() { return !!(el && el.src); }

  /* 길이를 알고 데이터도 좀 받아둔 상태인가 — 이게 되어야 연주를 시작할 수 있습니다 */
  function ready() {
    return !!(el && el.src && isFinite(el.duration) && el.duration > 0);
  }
  function stateText() {
    if (!el) return '요소없음';
    return 'src' + (el.src ? 'O' : 'X') + ' ready' + el.readyState + ' net' + el.networkState
      + ' 길이' + (isFinite(el.duration) ? el.duration.toFixed(2) : 'NaN');
  }
  function duration() { return (el && isFinite(el.duration)) ? el.duration : 0; }

  /* ---------- 재생 ---------- */
  function play(from) {
    const a = element();
    if (from != null) {
      const t = Math.max(0, Math.min(from, duration() || from));
      if (Math.abs((a.currentTime || 0) - t) > 0.05) {
        seekTarget = t;
        seekAtMs = performance.now();
        try { a.currentTime = t; } catch (e) { /* ignore */ }
      }
    }
    a.playbackRate = rate;
    a.volume = volume;
    a.muted = false;
    unlockToken++;            // 진행 중이던 잠금 해제가 이 재생을 멈추지 못하게
    unlocking = false;
    songUnlocked = true;
    lastCt = -1;
    const p = a.play();
    if (p && p.catch) p.catch(function () { /* 사용자 제스처가 필요한 경우 */ });
    unlocked = true;
  }

  function pause() {
    unlockToken++;            // 해제 작업이 나중에 끼어들지 않도록
    unlocking = false;
    primed = false;
    if (el) el.pause();
  }

  function stop() {
    if (!el) return;
    el.pause();
    try { el.currentTime = 0; } catch (e) { /* ignore */ }
  }

  function seek(sec) {
    const a = element();
    const t = Math.max(0, Math.min(sec, duration() || sec));
    if (Math.abs((a.currentTime || 0) - t) <= 0.05) return;   // 이미 그 자리
    seekTarget = t;
    seekAtMs = performance.now();
    try { a.currentTime = t; } catch (e) { /* ignore */ }
    lastCt = -1;
  }

  /* 부드럽게 보간한 현재 위치 */
  function now() {
    if (!el) return 0;
    const t = el.currentTime || 0;
    if (seekTarget != null) {
      /* 브라우저가 아직 못 따라왔으면 옮긴 위치를 그대로 보여줍니다.
         재생 중이라고 해서 바로 포기하면 안 됩니다 — 옮기기 전의 위치(이전 연주의 끝)를
         한두 프레임 더 알려주는 일이 있고, 그러면 '노래 시작하자마자 끝'이 됩니다. */
      if (Math.abs(t - seekTarget) < 0.3) seekTarget = null;
      else if (performance.now() - seekAtMs < SEEK_WAIT) return seekTarget;
      else seekTarget = null;   // 너무 오래 걸리면 포기하고 실제 위치를 씁니다
    }
    if (el.paused) { lastCt = -1; return t; }
    const ms = performance.now();
    if (t !== lastCt) { lastCt = t; lastCtAt = ms; return t; }
    return t + ((ms - lastCtAt) / 1000) * rate;
  }

  function isPlaying() { return !!(el && !el.paused && !el.ended && !unlocking); }

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
    /* 노래 요소는 한 번만, 그리고 재생 중이 아닐 때만 건드립니다.
       (해제 도중에 진짜 재생이 시작되면 그대로 두어야 소리가 끊기지 않습니다) */
    if (!songUnlocked && el && el.paused && el.src) {
      songUnlocked = true;
      const token = ++unlockToken;
      const wasMuted = el.muted;
      unlocking = true;
      el.muted = true;
      const p = el.play();
      if (p && p.then) {
        p.then(function () {
          unlocked = true;
          if (token !== unlockToken) return;   // 그 사이 진짜 재생이 시작됨 → 두고 나감
          el.pause();
          el.muted = wasMuted;
          unlocking = false;
        }).catch(function () {
          if (token === unlockToken) { el.muted = wasMuted; unlocking = false; }
        });
      } else {
        if (token === unlockToken) { el.pause(); el.muted = wasMuted; }
        unlocking = false;
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
    milestone: { dur: 0.75, notes: [
                 { f: 784, t: 0, d: 0.16, g: 0.5 }, { f: 1047, t: 0.1, d: 0.18, g: 0.5 },
                 { f: 1319, t: 0.2, d: 0.22, g: 0.5 }, { f: 1568, t: 0.32, d: 0.3, g: 0.45 }] },
    fanfare: { dur: 0.80, notes: [
                 { f: 523, t: 0, d: 0.2, g: 0.5 }, { f: 659, t: 0.15, d: 0.2, g: 0.5 },
                 { f: 784, t: 0.3, d: 0.2, g: 0.5 }, { f: 1047, t: 0.45, d: 0.3, g: 0.5 }] },
  };

  /* 콤보가 이어질수록 한 음씩 올라가는 성공음 (도-레-미-솔-라-도…) */
  const STEP_HZ = [880, 988, 1109, 1319, 1480, 1760, 1976, 2217];
  STEP_HZ.forEach(function (f, i) {
    SFX_SPEC['good' + i] = {
      dur: 0.3,
      notes: [{ f: f, t: 0, d: 0.12, g: 0.5 }, { f: f * 1.5, t: 0.06, d: 0.18, g: 0.35 }],
    };
  });

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
    milestone: function () { playSfx('milestone'); },
    goodStep: function (step) {
      const i = Math.max(0, Math.min(STEP_HZ.length - 1, step | 0));
      playSfx('good' + i);
    },
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

  /* 탭 템포 같은 즉각 반응이 필요한 소리 — 맥에서는 Web Audio 가 가장 빠릅니다 */
  function tickNow(strong) {
    try {
      const c = getCtx();
      if (c.state === 'suspended') c.resume();
      metroTick(!!strong, c.currentTime);
      return;
    } catch (e) { /* ignore */ }
    sfx.tick(strong);
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
    prime: prime, isPrimed: isPrimed, ready: ready, stateText: stateText,
    setRate: setRate, getRate: getRate, setVolume: setVolume, onEnd: onEnd,
    unlock: unlock, resume: resume, state: state, testTone: testTone, tickNow: tickNow,
    ensureDecoded: ensureDecoded, peaks: peaks, sfx: sfx,
    startMetro: startMetro, stopMetro: stopMetro, ctx: getCtx,
  };
})(window);
