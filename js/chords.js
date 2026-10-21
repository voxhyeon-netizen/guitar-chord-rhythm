/* Guitar chord shapes + SVG diagram renderer.
   frets: low E -> high e. -1 = muted, 0 = open. */
(function (global) {
  const CHORDS = {
    C:       { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
    G:       { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
    D:       { frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
    A:       { frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
    E:       { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
    F:       { frets: [1, 1, 3, 3, 2, 1], fingers: [1, 1, 3, 4, 2, 1], barre: 1 },
    Am:      { frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
    Em:      { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
    Dm:      { frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
    Bm:      { frets: [-1, 2, 4, 4, 3, 2], fingers: [0, 1, 3, 4, 2, 1], barre: 2 },
    'F#m':   { frets: [2, 4, 4, 2, 2, 2], fingers: [1, 3, 4, 1, 1, 1], barre: 2 },
    Cm:      { frets: [-1, 3, 5, 5, 4, 3], fingers: [0, 1, 3, 4, 2, 1], barre: 3 },
    Gm:      { frets: [3, 5, 5, 3, 3, 3], fingers: [1, 3, 4, 1, 1, 1], barre: 3 },
    G7:      { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] },
    C7:      { frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
    D7:      { frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3] },
    A7:      { frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0] },
    E7:      { frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
    B7:      { frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] },
    Am7:     { frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
    Dm7:     { frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1] },
    Em7:     { frets: [0, 2, 2, 0, 3, 0], fingers: [0, 1, 2, 0, 3, 0] },
    Fmaj7:   { frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0] },
    Cadd9:   { frets: [-1, 3, 2, 0, 3, 3], fingers: [0, 2, 1, 0, 3, 4] },
    Asus4:   { frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] },
    Dsus4:   { frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 2, 3] },
    'F(쉬움)': { frets: [-1, -1, 3, 2, 1, 1], fingers: [0, 0, 3, 2, 1, 1] },
    'G(쉬움)': { frets: [-1, -1, 0, 0, 0, 3], fingers: [0, 0, 0, 0, 0, 3] },
  };

  /* Palette order for the editor. */
  const PALETTE = [
    'C', 'G', 'Am', 'Em', 'F', 'D', 'A', 'E', 'Dm', 'Bm',
    'G7', 'C7', 'D7', 'A7', 'E7', 'B7',
    'Am7', 'Dm7', 'Em7', 'Fmaj7', 'Cadd9', 'Asus4', 'Dsus4',
    'F(쉬움)', 'G(쉬움)', 'Cm', 'Gm', 'F#m',
  ];

  /* Stable color per chord root so a chord always looks the same. */
  const ROOT_HUE = {
    C: 8, 'C#': 22, Db: 22, D: 40, 'D#': 54, Eb: 54, E: 90,
    F: 150, 'F#': 175, Gb: 175, G: 200, 'G#': 225, Ab: 225,
    A: 255, 'A#': 285, Bb: 285, B: 315,
  };

  function rootOf(name) {
    const m = /^([A-G][#b]?)/.exec(name || '');
    return m ? m[1] : 'C';
  }

  function colorOf(name) {
    const hue = ROOT_HUE[rootOf(name)] != null ? ROOT_HUE[rootOf(name)] : 210;
    const minor = /m(?!aj)/.test(String(name).slice(1));
    return {
      hue,
      main: 'hsl(' + hue + ', ' + (minor ? 55 : 78) + '%, ' + (minor ? 52 : 58) + '%)',
      dark: 'hsl(' + hue + ', ' + (minor ? 55 : 70) + '%, 34%)',
      light: 'hsl(' + hue + ', ' + (minor ? 60 : 85) + '%, 72%)',
    };
  }

  function shape(name) {
    return CHORDS[name] || null;
  }

  function names() {
    return PALETTE.filter(function (n) { return CHORDS[n]; });
  }

  /* Render a chord box as an SVG string. */
  function diagramSvg(name, opts) {
    const o = opts || {};
    const W = o.width || 108;
    const showName = o.showName !== false;
    const sh = shape(name);
    const headH = showName ? 26 : 4;
    const padX = 12;
    const gridW = W - padX * 2;
    const strings = 6;
    const fretRows = 4;
    const cell = gridW / (strings - 1);
    const rowH = cell * 1.05;
    const gridTop = headH + 16;
    const H = gridTop + rowH * fretRows + 16;
    const col = colorOf(name);
    const parts = [];

    parts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
      '" xmlns="http://www.w3.org/2000/svg" class="chord-svg" role="img" aria-label="' + esc(name) + ' 코드">');

    if (showName) {
      parts.push('<text x="' + (W / 2) + '" y="' + (headH - 6) +
        '" text-anchor="middle" font-size="19" font-weight="900" fill="' + col.dark + '">' + esc(name) + '</text>');
    }

    if (!sh) {
      parts.push('<text x="' + (W / 2) + '" y="' + (gridTop + rowH * 2) +
        '" text-anchor="middle" font-size="12" fill="#888">운지 없음</text></svg>');
      return parts.join('');
    }

    const played = sh.frets.filter(function (f) { return f > 0; });
    const minFret = played.length ? Math.min.apply(null, played) : 1;
    const base = minFret > fretRows ? minFret : 1;

    /* open / muted markers above the nut */
    for (let s = 0; s < strings; s++) {
      const x = padX + s * cell;
      const f = sh.frets[s];
      if (f === 0) {
        parts.push('<circle cx="' + x + '" cy="' + (gridTop - 8) + '" r="4" fill="none" stroke="#2d3436" stroke-width="2"/>');
      } else if (f < 0) {
        parts.push('<path d="M' + (x - 4) + ' ' + (gridTop - 12) + 'l8 8M' + (x + 4) + ' ' + (gridTop - 12) +
          'l-8 8" stroke="#8d99a6" stroke-width="2" stroke-linecap="round"/>');
      }
    }

    /* nut or position number */
    if (base === 1) {
      parts.push('<rect x="' + padX + '" y="' + (gridTop - 3) + '" width="' + gridW + '" height="4" rx="2" fill="#2d3436"/>');
    } else {
      parts.push('<text x="' + (padX - 6) + '" y="' + (gridTop + rowH * 0.7) +
        '" text-anchor="end" font-size="11" font-weight="800" fill="#2d3436">' + base + '</text>');
    }

    /* grid */
    for (let r = 0; r <= fretRows; r++) {
      const y = gridTop + r * rowH;
      parts.push('<line x1="' + padX + '" y1="' + y + '" x2="' + (padX + gridW) + '" y2="' + y +
        '" stroke="#b2bec3" stroke-width="1.5"/>');
    }
    for (let s = 0; s < strings; s++) {
      const x = padX + s * cell;
      parts.push('<line x1="' + x + '" y1="' + gridTop + '" x2="' + x + '" y2="' + (gridTop + rowH * fretRows) +
        '" stroke="#b2bec3" stroke-width="1.5"/>');
    }

    /* dots */
    for (let s = 0; s < strings; s++) {
      const f = sh.frets[s];
      if (f <= 0) continue;
      const row = f - base;
      if (row < 0 || row >= fretRows) continue;
      const x = padX + s * cell;
      const y = gridTop + row * rowH + rowH / 2;
      parts.push('<circle cx="' + x + '" cy="' + y + '" r="' + (cell * 0.36) + '" fill="' + col.main +
        '" stroke="' + col.dark + '" stroke-width="2"/>');
      const fin = sh.fingers && sh.fingers[s];
      if (fin) {
        parts.push('<text x="' + x + '" y="' + (y + 4) +
          '" text-anchor="middle" font-size="11" font-weight="900" fill="#fff">' + fin + '</text>');
      }
    }

    parts.push('</svg>');
    return parts.join('');
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  global.GChords = { shape: shape, names: names, colorOf: colorOf, diagramSvg: diagramSvg, all: CHORDS };
})(window);
