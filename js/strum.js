/* 주법(스트럼 패턴).
   한 글자가 8분음표 한 칸입니다. D=아래로(↓), U=위로(↑), - = 안 침. */
(function (global) {
  const PRESETS = [
    { id: '1',  name: '한 번만',     pat: 'D-------' },
    { id: '2',  name: '2비트',       pat: 'D---D---' },
    { id: '4',  name: '4비트',       pat: 'D-D-D-D-' },
    { id: '8',  name: '8비트',       pat: 'DUDUDUDU' },
    { id: '8s', name: '느린 8비트',  pat: 'D-DUD-DU' },
    { id: '8c', name: '8비트 변형',  pat: 'D-DU-UDU' },
    { id: 'w',  name: '왈츠(3박)',   pat: 'D-U-U-' },
  ];

  function get(id) {
    for (let i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }

  function name(id) {
    const p = get(id);
    return p ? p.name : '8비트';
  }

  /* 박자에 맞춰 길이를 맞춘 패턴 문자열 */
  function pattern(id, beatsPerBar) {
    const p = get(id) || get('8');
    const want = Math.max(2, (beatsPerBar || 4) * 2);
    let s = p.pat;
    while (s.length < want) s += p.pat;
    return s.slice(0, want);
  }

  /* [t0, t1) 안에서 실제로 치는 시각들 — 마디 격자에 맞춰 계산합니다 */
  function times(song, patId, t0, t1) {
    const bpm = song.bpm || 90;
    const bpb = song.beatsPerBar || 4;
    const offset = song.offset || 0;
    const eighth = (60 / bpm) / 2;
    const pat = pattern(patId, bpb);
    const slots = pat.length;
    const out = [];
    /* 채보 시각이 격자보다 몇 밀리초 어긋나 있어도 마디 첫 칸을 놓치지 않게
       (아주 조금 앞선 격자 칸까지 이 코드의 것으로 봅니다) */
    let k = Math.ceil((t0 - offset) / eighth - 0.25);
    for (let guard = 0; guard < 400; guard++) {
      const t = offset + k * eighth;
      /* 끝 경계는 다음 코드의 몫이라 살짝 앞에서 끊습니다 (화살표 중복 방지) */
      if (t >= t1 - eighth * 0.25) break;
      const ch = pat[((k % slots) + slots) % slots];
      if (ch === 'D' || ch === 'U') out.push({ t: t, dir: ch });
      k++;
    }
    return out;
  }

  /* 이 노트에 적용되는 주법: 노트 개별 → 구간 변경 → 곡 기본 */
  function forNote(song, note) {
    if (note && note.strum && get(note.strum)) return note.strum;
    const changes = (song.strumChanges || []).slice().sort(function (a, b) { return a.t - b.t; });
    let id = song.strum || '8';
    const t = note ? note.t : 0;
    for (let i = 0; i < changes.length; i++) {
      if (changes[i].t <= t + 1e-6) id = changes[i].strum;
      else break;
    }
    return get(id) ? id : '8';
  }

  function arrow(dir) { return dir === 'U' ? '↑' : '↓'; }

  global.GStrum = {
    PRESETS: PRESETS,
    get: get,
    name: name,
    pattern: pattern,
    times: times,
    forNote: forNote,
    arrow: arrow,
  };
})(window);
