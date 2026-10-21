/* Web Audio transport: decode once, play with a sample-accurate clock. */
(function (global) {
  let ctx = null;
  let buffer = null;
  let source = null;
  let gainNode = null;
  let playing = false;
  let startCtxTime = 0;   // ctx.currentTime when playback started
  let startOffset = 0;    // song position at that moment
  let rate = 1;
  let pausedAt = 0;
  let endCb = null;
  let volume = 1;

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

  /* iOS(아이패드)는 화면을 누르는 그 순간에 '실제로 소리를 내야' 오디오 잠금이 풀립니다.
     resume() 만으로는 부족해서 길이 1짜리 무음을 같이 재생합니다. */
  function unlock() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) { /* 지원하지 않는 버전 */ }
    let p = Promise.resolve();
    try {
      const c = getCtx();
      if (c.state === 'suspended') p = c.resume();
      const b = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = b;
      src.connect(c.destination);
      src.start(0);
    } catch (e) { /* ignore */ }
    return p;
  }

  function state() {
    try { return getCtx().state; } catch (e) { return 'none'; }
  }

  /* 소리가 나는지 확인용 — 짧은 음 세 개 */
  function testTone() {
    unlock();
    const c = getCtx();
    [523, 659, 784].forEach(function (f, i) {
      blip(f, 0.22, 'sine', 0.2, c.currentTime + i * 0.2);
    });
  }

  function load(blob) {
    const c = getCtx();
    return blob.arrayBuffer().then(function (ab) {
      return new Promise(function (resolve, reject) {
        c.decodeAudioData(ab, function (buf) {
          stop();
          buffer = buf;
          resolve(buf);
        }, function (err) {
          reject(err || new Error('decode-failed'));
        });
      });
    });
  }

  function hasAudio() { return !!buffer; }
  function duration() { return buffer ? buffer.duration : 0; }

  function play(from) {
    if (!buffer) return;
    const c = getCtx();
    stopSource();
    const at = Math.max(0, Math.min(from != null ? from : pausedAt, buffer.duration));
    source = c.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gainNode = c.createGain();
    gainNode.gain.value = volume;
    source.connect(gainNode);
    gainNode.connect(c.destination);
    source.onended = function () {
      if (!playing) return;
      playing = false;
      pausedAt = buffer.duration;
      if (endCb) endCb();
    };
    startCtxTime = c.currentTime;
    startOffset = at;
    playing = true;
    source.start(0, at);
  }

  function stopSource() {
    if (source) {
      try { source.onended = null; source.stop(); } catch (e) { /* ignore */ }
      source = null;
    }
  }

  function pause() {
    if (!playing) return;
    pausedAt = now();
    playing = false;
    stopSource();
  }

  function stop() {
    playing = false;
    pausedAt = 0;
    stopSource();
  }

  function seek(sec) {
    const at = Math.max(0, Math.min(sec, duration()));
    if (playing) play(at); else pausedAt = at;
  }

  function now() {
    if (!buffer) return 0;
    if (!playing) return pausedAt;
    const t = startOffset + (getCtx().currentTime - startCtxTime) * rate;
    return Math.max(0, Math.min(t, buffer.duration));
  }

  function isPlaying() { return playing; }

  function setRate(r) {
    const at = now();
    rate = r;
    if (playing) play(at);
  }
  function getRate() { return rate; }

  function setVolume(v) {
    volume = v;
    if (gainNode) gainNode.gain.value = v;
  }

  function onEnd(cb) { endCb = cb; }

  /* Downsampled min/max peaks for the editor waveform (buckets per second). */
  function peaks(perSecond) {
    if (!buffer) return null;
    const data = buffer.getChannelData(0);
    const count = Math.max(1, Math.ceil(buffer.duration * perSecond));
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

  /* Short synth blips: UI feedback, metronome, count-in. */
  function blip(freq, dur, type, vol, when) {
    try {
      const c = getCtx();
      const t0 = when != null ? when : c.currentTime;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type || 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(vol != null ? vol : 0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      osc.connect(g);
      g.connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  }

  const sfx = {
    click: function () { blip(520, 0.05, 'square', 0.08); },
    good: function () { blip(880, 0.07, 'sine', 0.14); blip(1320, 0.09, 'sine', 0.1, getCtx().currentTime + 0.05); },
    soso: function () { blip(620, 0.09, 'triangle', 0.12); },
    miss: function () { blip(170, 0.18, 'sawtooth', 0.1); },
    tick: function (strong, when) { blip(strong ? 1400 : 900, 0.035, 'square', strong ? 0.16 : 0.09, when); },
    fanfare: function () {
      const c = getCtx();
      [523, 659, 784, 1047].forEach(function (f, i) { blip(f, 0.16, 'sine', 0.14, c.currentTime + i * 0.12); });
    },
  };

  /* Metronome locked to the song clock. */
  let metro = null;
  function startMetro(bpm, offset, beatsPerBar) {
    stopMetro();
    if (!bpm) return;
    const spb = 60 / bpm;
    let nextBeat = Math.max(0, Math.ceil((now() - offset) / spb));
    metro = setInterval(function () {
      if (!playing) return;
      const c = getCtx();
      const songT = now();
      for (let guard = 0; guard < 16; guard++) {
        const bt = offset + nextBeat * spb;
        if (bt > songT + 0.25) break;
        if (bt >= songT - 0.02) {
          const when = c.currentTime + (bt - songT) / rate;
          sfx.tick(nextBeat % (beatsPerBar || 4) === 0, when);
        }
        nextBeat++;
      }
    }, 60);
  }
  function stopMetro() {
    if (metro) { clearInterval(metro); metro = null; }
  }
  global.GAudio = {
    resume: resume,
    unlock: unlock,
    state: state,
    testTone: testTone,
    load: load,
    hasAudio: hasAudio,
    duration: duration,
    play: play,
    pause: pause,
    stop: stop,
    seek: seek,
    now: now,
    isPlaying: isPlaying,
    setRate: setRate,
    getRate: getRate,
    setVolume: setVolume,
    onEnd: onEnd,
    peaks: peaks,
    sfx: sfx,
    startMetro: startMetro,
    stopMetro: stopMetro,
    ctx: getCtx,
  };
})(window);
