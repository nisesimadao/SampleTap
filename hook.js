/**
 * hook.js — ページ本体(MAIN world)で動く。
 * SampleFocus のプレイヤーが読み込むプレビュー音源の URL を横取りして
 * content script (ISOLATED world) に postMessage で流す。
 *
 * DOM のクラス名に依存しないので、サイト側のマークアップが変わっても壊れにくい。
 */
(() => {
  if (window.__sfdlHookInstalled) return;
  window.__sfdlHookInstalled = true;

  const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)(\?|#|$)/i;
  const seenMedia = new Set();

  function report(raw, source) {
    if (!raw || typeof raw !== 'string') return;
    if (raw.startsWith('data:')) return;
    let url;
    try {
      url = new URL(raw, location.href).href;
    } catch (_) {
      return;
    }
    window.postMessage({ __sfdl: 'page->cs', type: 'AUDIO_SRC', url, source }, location.origin);
  }

  function track(el) {
    if (el instanceof HTMLMediaElement) seenMedia.add(el);
  }

  // --- 1) <audio>/<video> の src セッター ---------------------------------
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (desc && desc.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        configurable: true,
        enumerable: desc.enumerable,
        get() {
          return desc.get.call(this);
        },
        set(value) {
          track(this);
          report(value, 'media.src');
          return desc.set.call(this, value);
        }
      });
    }
  } catch (_) {}

  // --- 2) setAttribute('src', ...) 経由 -----------------------------------
  try {
    const origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (this instanceof HTMLMediaElement && String(name).toLowerCase() === 'src') {
        track(this);
        report(value, 'setAttribute');
      } else if (this instanceof HTMLSourceElement && String(name).toLowerCase() === 'src') {
        report(value, 'source');
      }
      return origSetAttribute.apply(this, arguments);
    };
  } catch (_) {}

  // --- 3) play() 呼び出し時 -----------------------------------------------
  try {
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      track(this);
      report(this.currentSrc || this.src, 'play()');
      return origPlay.apply(this, arguments);
    };
  } catch (_) {}

  // --- 4) new Audio(url) ---------------------------------------------------
  try {
    const OrigAudio = window.Audio;
    if (typeof OrigAudio === 'function') {
      const PatchedAudio = function Audio(src) {
        const el = src === undefined ? new OrigAudio() : new OrigAudio(src);
        track(el);
        if (src) report(src, 'new Audio');
        return el;
      };
      PatchedAudio.prototype = OrigAudio.prototype;
      window.Audio = PatchedAudio;
    }
  } catch (_) {}

  // --- 5) DOM 内メディアの loadstart（キャプチャ段階で拾う） ---------------
  document.addEventListener(
    'loadstart',
    (e) => {
      if (e.target instanceof HTMLMediaElement) {
        track(e.target);
        report(e.target.currentSrc || e.target.src, 'loadstart');
      }
    },
    true
  );

  // --- 6) Web Audio 系（fetch / XHR で arraybuffer を取る実装向け） --------
  try {
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        const u = typeof input === 'string' ? input : input && input.url;
        if (u && AUDIO_EXT.test(String(u))) report(u, 'fetch');
      } catch (_) {}
      return origFetch.apply(this, arguments);
    };
  } catch (_) {}

  try {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        if (url && AUDIO_EXT.test(String(url))) report(url, 'xhr');
      } catch (_) {}
      return origOpen.apply(this, arguments);
    };
  } catch (_) {}

  // --- content script からの指示 ------------------------------------------
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__sfdl !== 'cs->page') return;

    if (d.type === 'PAUSE_ALL') {
      const all = new Set(seenMedia);
      document.querySelectorAll('audio, video').forEach((m) => all.add(m));
      all.forEach((m) => {
        try {
          if (!m.paused) {
            m.pause();
            m.currentTime = 0;
          }
        } catch (_) {}
      });
    }
  });
})();
