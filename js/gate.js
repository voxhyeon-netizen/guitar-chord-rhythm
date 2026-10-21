/* 접속 코드 잠금 — 맥(로컬)과 같은 와이파이에서는 묻지 않고, 웹에 올렸을 때만 물어봅니다. */
(function () {
  const cfg = window.GCHORD_GATE || {};
  const PIN = String(cfg.pin || 'voxhyeon');
  const KEY = cfg.storageKey || 'gchord-auth';

  function isLocal() {
    if (location.protocol === 'file:') return true;
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1') return true;
    if (/\.local$/i.test(h)) return true;
    /* 같은 와이파이(사설 IP)에서 여는 아이패드도 통과 */
    if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    return false;
  }

  function authed() {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch (e) { return false; }
  }

  function remember() {
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
  }

  function open() {
    document.documentElement.classList.remove('gate-on');
    const g = document.getElementById('accessGate');
    if (g) g.hidden = true;
  }

  function ask() {
    document.documentElement.classList.add('gate-on');
    const g = document.getElementById('accessGate');
    const input = document.getElementById('gateInput');
    const btn = document.getElementById('gateSubmit');
    const err = document.getElementById('gateError');
    if (!g) return;
    g.hidden = false;

    function tryUnlock() {
      const ok = String(input.value || '').trim().toLowerCase() === PIN.trim().toLowerCase();
      if (ok) { remember(); open(); return; }
      err.classList.remove('hidden');
      input.select();
    }
    btn.addEventListener('click', tryUnlock);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryUnlock(); });
    setTimeout(function () { input.focus(); }, 100);
  }

  function init() {
    if (isLocal() || authed()) { open(); return; }
    ask();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
