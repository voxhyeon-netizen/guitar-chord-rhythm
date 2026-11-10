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
  const COOLDOWN_MS = 150;      // 한 번 친 것을 여러 번으로 세지 않게
  const BASE_UP = 0.06;         // 기준선이 커질 때 (빠르게 따라감 — 반주가 커지면 같이 올라감)
  const BASE_DOWN = 0.015;      // 작아질 때 (천천히 내려감)

  let ctx = null;
  let stream = null;
  let node = null;
  let sink = null;

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
    level = 0;
    rms = 0;
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
    onOnset: function (cb) { onsetCb = cb; },
  };
})(window);
