/* 마이크 듣기 — 혼자 연습할 때 쓰는 입력입니다.

   수업에서는 선생님이 리모컨으로 판정합니다. 이 모듈은 그 선생님이 없는 상황,
   즉 혼자 연습할 때 '제때 쳤는지'를 대신 봐주는 쪽입니다.

   무엇을 듣는가: 지금은 '코드가 맞았는지'가 아니라 '쳤는지(스트로크)' 입니다.
   타이밍만으로도 코드 바꾸기 연습은 되지만, 아무 줄이나 긁어도 성공이 된다는 한계가 있습니다.
   (코드 일치까지 보려면 크로마 분석이 필요합니다 — 혼자 치는 소리라면 해볼 만합니다.)

   반주 소리 문제: 스피커에서 나오는 노래도 마이크로 들어옵니다. 그래서 절대 음량이 아니라
   '갑자기 커졌는가'를 봅니다. 느리게 따라가는 기준선(baseline)보다 확 튀어야 한 번으로 셉니다.
   반주가 계속 흐르면 기준선이 같이 올라가서 노래 자체로는 잘 반응하지 않습니다.
   이어폰을 끼면 반주가 아예 안 들어와서 가장 정확합니다. */
(function (global) {
  const FRAMES = 512;           // 약 12ms 마다 한 번 봅니다 (44.1kHz 기준)
  const FFT = 8192;             // 화음을 보려면 주파수를 촘촘히 봐야 합니다 (약 5Hz 간격)
  const TUNING = [40, 45, 50, 55, 59, 64];  // 6번줄 E2 → 1번줄 E4 (MIDI 번호)
  const COOLDOWN_MS = 150;      // 한 번 친 것을 여러 번으로 세지 않게
  const BASE_UP = 0.06;         // 기준선이 커질 때 (빠르게 따라감 — 반주가 커지면 같이 올라감)
  const BASE_DOWN = 0.015;      // 작아질 때 (천천히 내려감)

  let ctx = null;
  let stream = null;
  let node = null;
  let sink = null;
  let analyser = null;
  let freqBuf = null;
  let templates = null;

  let running = false;
  let level = 0;                // 0~1 로 보정한 현재 소리 크기
  let rms = 0;
  let baseline = 0.005;
  let lastOnsetMs = 0;
  let sensitivity = 0.5;        // 0~1
  let onsetCb = null;

  function supported() {
    return !!(global.navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /* http://192.168… 처럼 안전하지 않은 주소에서는 브라우저가 마이크를 막습니다 */
  function secure() {
    return global.isSecureContext !== false;
  }

  function start() {
    if (running) return Promise.resolve(true);
    if (!supported()) return Promise.reject(new Error('unsupported'));
    if (!secure()) return Promise.reject(new Error('insecure'));

    /* 기타 소리를 그대로 들어야 하므로 에코 제거·잡음 제거·자동 볼륨을 모두 끕니다.
       켜두면 브라우저가 '잡음'으로 보고 기타 소리를 깎아버립니다. */
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    }).then(function (s) {
      stream = s;
      const AC = global.AudioContext || global.webkitAudioContext;
      ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume();
      const src = ctx.createMediaStreamSource(stream);

      /* 소리를 '오디오 스레드'에서 직접 봅니다.
         화면 그리기(requestAnimationFrame)에 맡기면 코드가 우르르 내려오는 동안
         프레임이 밀려서 순간적인 스트로크를 놓칩니다. 또 화면이 가려지면 아예 멈춥니다.
         ScriptProcessorNode 는 오래된 방식이지만 아이패드 사파리까지 그대로 동작합니다. */
      node = ctx.createScriptProcessor(FRAMES, 1, 1);
      node.onaudioprocess = onAudio;
      src.connect(node);

      /* 화음을 보기 위한 주파수 분석 — 칠 때마다 한 번씩 꺼내 씁니다 */
      analyser = ctx.createAnalyser();
      analyser.fftSize = FFT;
      analyser.smoothingTimeConstant = 0;
      src.connect(analyser);
      freqBuf = new Float32Array(analyser.frequencyBinCount);

      /* 어딘가에 연결돼 있어야 onaudioprocess 가 돕니다. 소리는 0으로 죽여서
         스피커로 되돌아가지 않게 합니다 — 안 그러면 하울링이 납니다. */
      sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink);
      sink.connect(ctx.destination);

      baseline = 0.005;
      running = true;
      return true;
    });
  }

  function stop() {
    running = false;
    if (node) { node.onaudioprocess = null; try { node.disconnect(); } catch (e) { /* ignore */ } node = null; }
    if (sink) { try { sink.disconnect(); } catch (e) { /* ignore */ } sink = null; }
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    if (ctx) { try { ctx.close(); } catch (e) { /* ignore */ } ctx = null; }
    analyser = null;
    freqBuf = null;
    level = 0;
    rms = 0;
  }

  /* ---------- 어떤 코드를 쳤는가 ----------
     12음(도~시)에 소리가 얼마씩 들어있는지를 세어 '크로마'를 만들고,
     코드 모양에서 계산한 표와 견줍니다. 혼자 치는 소리라서 해볼 만합니다
     (교실에서 여럿이 치면 섞여서 불가능합니다). */
  function chroma() {
    if (!analyser || !ctx) return null;
    analyser.getFloatFrequencyData(freqBuf);
    const sr = ctx.sampleRate;
    const out = new Float32Array(12);
    let total = 0;
    for (let i = 1; i < freqBuf.length; i++) {
      const f = i * sr / analyser.fftSize;
      if (f < 70 || f > 2200) continue;       // 기타 줄의 음역과 그 배음만
      const db = freqBuf[i];
      if (db < -85) continue;                 // 바닥 잡음은 버립니다
      const mag = Math.pow(10, db / 20);
      const pc = ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;
      out[pc] += mag;
      total += mag;
    }
    if (total <= 0) return null;
    return unit(out);
  }

  function unit(v) {
    let n = 0;
    for (let i = 0; i < 12; i++) n += v[i] * v[i];
    n = Math.sqrt(n);
    if (n <= 0) return null;
    for (let i = 0; i < 12; i++) v[i] /= n;
    return v;
  }

  /* 코드 모양(몇 번 줄 몇 프렛)에서 그 코드의 크로마 표를 만듭니다.
     실제 줄 소리에는 배음이 함께 울리므로 5도·장3도 배음도 조금 섞어 둡니다. */
  function buildTemplates() {
    templates = {};
    if (!global.GChords) return;
    GChords.names().forEach(function (name) {
      const sh = GChords.shape(name);
      if (!sh || !sh.frets) return;
      const v = new Float32Array(12);
      sh.frets.forEach(function (fr, i) {
        if (fr == null || fr < 0) return;     // 안 치는 줄
        const pc = (TUNING[i] + fr) % 12;
        v[pc] += 1;
        v[(pc + 7) % 12] += 0.33;             // 3배음 = 5도
        v[(pc + 4) % 12] += 0.17;             // 5배음 = 장3도
      });
      if (unit(v)) templates[name] = v;
    });
  }

  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < 12; i++) s += a[i] * b[i];
    return s;
  }

  function canMatchChord() { return !!(analyser && global.GChords); }

  /* expected 를 주면 '그 코드가 맞는지'까지 알려줍니다. */
  function matchChord(expected) {
    const c = chroma();
    if (!c) return null;
    if (!templates) buildTemplates();

    let best = '', bestS = -1, second = -1, expS = -1;
    Object.keys(templates).forEach(function (name) {
      const s = dot(c, templates[name]);
      if (s > bestS) { second = bestS; bestS = s; best = name; }
      else if (s > second) { second = s; }
      if (name === expected) expS = s;
    });

    /* 기타 코드는 구성음이 많이 겹칩니다(C 와 Am7, G 와 Em7 …).
       1등만 정답으로 치면 너무 가혹해서, 1등과 비슷하게 높으면 맞다고 봅니다. */
    const ok = !!expected && expS >= 0 && (best === expected || expS >= bestS - 0.05);
    return { best: best, score: bestS, second: second, expected: expected, expectedScore: expS, ok: ok };
  }

  /* 민감도 → 판정 기준
     높을수록 작은 소리에도, 조금만 튀어도 반응합니다. */
  function ratioOf() { return 3.0 - 1.7 * sensitivity; }   // 기준선의 몇 배로 튀어야 하는가
  function floorOf() { return 0.018 - 0.014 * sensitivity; } // 이보다 작으면 무시

  function onAudio(e) {
    if (!running) return;
    const buf = e.inputBuffer.getChannelData(0);

    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    rms = Math.sqrt(sum / buf.length);

    /* 화면 막대용 — 0.08 정도면 꽤 큰 소리라서 그 언저리를 가득 찬 것으로 봅니다 */
    level = Math.min(1, rms / 0.08);

    const now = performance.now();
    const spike = rms > baseline * ratioOf() && rms > floorOf();
    if (spike && now - lastOnsetMs > COOLDOWN_MS) {
      lastOnsetMs = now;
      if (onsetCb) onsetCb(level);
    }

    /* 기준선 갱신 — 친 순간은 빼고 따라가게 두면 반주에만 맞춰집니다 */
    const k = rms > baseline ? BASE_UP : BASE_DOWN;
    baseline = baseline + (rms - baseline) * k;
    if (baseline < 0.002) baseline = 0.002;
  }

  global.GMic = {
    supported: supported,
    secure: secure,
    start: start,
    stop: stop,
    isRunning: function () { return running; },
    level: function () { return level; },
    setSensitivity: function (v) { sensitivity = Math.max(0, Math.min(1, Number(v) || 0)); },
    canMatchChord: canMatchChord,
    matchChord: matchChord,
    chroma: chroma,
    onOnset: function (cb) { onsetCb = cb; },
  };
})(window);
