/**
 * content.js — samplefocus.com の各サンプルカードに赤いダウンロードボタンを追加する。
 *
 * 音源 URL の取得は 2 段構え:
 *   A) カード内の属性 / <audio> / JSON から静的に探す（即時）
 *   B) 見つからなければサイト本来の再生ボタンを一瞬だけ押し、
 *      hook.js が捕まえた実際のプレビュー URL を受け取る（クリック捕捉）
 */
(() => {
  'use strict';

  const MARK = 'sfdlDone'; // dataset flag
  const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)(\?|#|$)/i;
  const AUDIO_URL_RE = /https?:\/\/[^\s"'<>\\]+?\.(?:mp3|wav|ogg|oga|m4a|aac|flac|opus)(?:\?[^\s"'<>\\]*)?/i;
  const CTRL_RE = new RegExp('[\u0000-\u001F\u007F]', 'g');

  /* ------------------------------------------------------------------ *
   * hook.js からの音源 URL 受信
   * ------------------------------------------------------------------ */
  let lastAudio = null; // { url, at }
  const waiters = [];

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__sfdl !== 'page->cs' || d.type !== 'AUDIO_SRC') return;
    if (!d.url || d.url.startsWith('blob:')) return;

    lastAudio = { url: d.url, at: Date.now() };
    while (waiters.length) waiters.shift()(d.url);
  });

  function waitForAudio(timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const fn = (url) => {
        if (done) return;
        done = true;
        resolve(url);
      };
      waiters.push(fn);
      setTimeout(() => fn(null), timeoutMs);
    });
  }

  function pauseAll() {
    window.postMessage({ __sfdl: 'cs->page', type: 'PAUSE_ALL' }, location.origin);
    document.querySelectorAll('audio, video').forEach((m) => {
      try {
        if (!m.paused) {
          m.pause();
          m.currentTime = 0;
        }
      } catch (_) {}
    });
  }

  /* ------------------------------------------------------------------ *
   * カード検出
   * ------------------------------------------------------------------ */
  const CARD_SELECTORS = [
    '[data-sample-id]',
    '[data-sample]',
    '.sample-item',
    '.sample-card',
    '.sample-row',
    '.sample-listing-item',
    'li.sample',
    'div.sample',
    '[class*="SampleCard"]',
    '[class*="sample-list"] > li'
  ];

  const PLAY_SELECTOR = [
    '[class*="play" i]',
    '[aria-label*="play" i]',
    '[title*="play" i]',
    '[data-action*="play" i]',
    '[class*="waveform" i]'
  ].join(',');

  const DOWNLOAD_SELECTOR = [
    'a[download]',
    '[class*="download" i]',
    '[aria-label*="download" i]',
    '[title*="download" i]',
    '[href*="download" i]',
    '[data-action*="download" i]'
  ].join(',');

  function findCards() {
    const found = new Set();

    for (const sel of CARD_SELECTORS) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch (_) {
        continue;
      }
      nodes.forEach((n) => found.add(n));
    }

    // フォールバック: 「再生っぽいもの」と「ダウンロードっぽいもの」を
    // 同時に含む最小の要素をカードとみなす。
    if (found.size === 0) {
      document.querySelectorAll(DOWNLOAD_SELECTOR).forEach((dl) => {
        let el = dl;
        for (let i = 0; i < 6 && el; i++) {
          el = el.parentElement;
          if (!el || el === document.body) break;
          if (el.querySelector(PLAY_SELECTOR)) {
            found.add(el);
            break;
          }
        }
      });
    }

    // 入れ子になっているものは内側だけ残す
    return [...found].filter((c) => {
      if (!(c instanceof HTMLElement)) return false;
      if (!c.isConnected) return false;
      for (const other of found) {
        if (other !== c && c.contains(other)) return false;
      }
      return true;
    });
  }

  function findPlayControl(card) {
    for (const el of card.querySelectorAll(PLAY_SELECTOR)) {
      if (el.closest('.sfdl-btn')) continue;
      return el;
    }
    return null;
  }

  function findDownloadControl(card) {
    for (const el of card.querySelectorAll(DOWNLOAD_SELECTOR)) {
      if (el.closest('.sfdl-btn')) continue;
      return el;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 音源 URL の静的検出
   * ------------------------------------------------------------------ */
  function normalize(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s || s.startsWith('data:') || s.startsWith('blob:')) return null;
    try {
      return new URL(s, location.href).href;
    } catch (_) {
      return null;
    }
  }

  function urlFromAttributes(el) {
    if (!el.attributes) return null;
    for (const attr of el.attributes) {
      const v = attr.value;
      if (!v || v.length > 2000) continue;

      // 属性値そのものが音源 URL / パス
      if (AUDIO_EXT.test(v) && !/\s/.test(v)) {
        const u = normalize(v);
        if (u) return u;
      }
      // 属性値が JSON などで URL を内包している
      const m = v.match(AUDIO_URL_RE);
      if (m) {
        const u = normalize(m[0]);
        if (u) return u;
      }
    }
    return null;
  }

  function findUrlInCard(card) {
    const media = card.querySelector('audio[src], audio source[src], video[src]');
    if (media) {
      const u = normalize(media.currentSrc || media.src || media.getAttribute('src'));
      if (u) return u;
    }

    const direct = urlFromAttributes(card);
    if (direct) return direct;

    for (const el of card.querySelectorAll('*')) {
      const u = urlFromAttributes(el);
      if (u) return u;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * ファイル名
   * ------------------------------------------------------------------ */
  function sanitize(name) {
    return name
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(CTRL_RE, '')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 120)
      .trim();
  }

  function cardTitle(card) {
    const sel = ['[class*="title" i]', '[class*="name" i]', 'h1, h2, h3, h4, h5', 'a[href*="/samples/"]'];
    for (const s of sel) {
      const el = card.querySelector(s);
      const t = el && el.textContent ? el.textContent.trim() : '';
      if (t && t.length > 1 && t.length < 200) return t;
    }
    const own = (card.getAttribute('title') || '').trim();
    if (own) return own;
    return '';
  }

  function buildFilename(card, url) {
    let ext = 'mp3';
    try {
      const m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
      if (m) ext = m[1].toLowerCase();
    } catch (_) {}

    let base = sanitize(cardTitle(card));
    if (!base) {
      try {
        const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
        base = sanitize(last.replace(/\.[a-z0-9]+$/i, ''));
      } catch (_) {}
    }
    if (!base) base = 'samplefocus-preview';

    return 'SampleFocus/' + base + '.' + ext;
  }

  /* ------------------------------------------------------------------ *
   * ダウンロード実行
   * ------------------------------------------------------------------ */
  function requestDownload(url, filename) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (r) => {
        if (settled) return;
        settled = true;
        resolve(r);
      };
      try {
        chrome.runtime.sendMessage({ type: 'SFDL_DOWNLOAD', url, filename }, (res) => {
          if (chrome.runtime.lastError) {
            finish({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            finish(res || { ok: false, error: 'no response' });
          }
        });
      } catch (err) {
        finish({ ok: false, error: String(err) });
      }
      setTimeout(() => finish({ ok: false, error: 'timeout' }), 60000);
    });
  }

  // chrome.downloads が失敗した場合の保険: ページ側で取得して <a download>
  async function fallbackDownload(url, filename) {
    const res = await fetch(url, { credentials: 'omit', mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = obj;
    a.download = filename.split('/').pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 30000);
  }

  /* ------------------------------------------------------------------ *
   * ボタン生成
   * ------------------------------------------------------------------ */
  const ICON_DOWNLOAD =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6V3h2z"/><path d="M4 19h16v2H4z"/></svg>';
  const ICON_CHECK =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.6 16.6 5 12l1.4-1.4 3.2 3.2 8-8L19 7.2z"/></svg>';
  const ICON_ERROR =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 7h2v7h-2zm0 9h2v2h-2z"/><path d="M12 2 1 21h22L12 2zm0 4.3L19.5 19h-15L12 6.3z"/></svg>';

  function setState(btn, state, label) {
    btn.dataset.sfdlState = state;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = state === 'done' ? ICON_CHECK : state === 'error' ? ICON_ERROR : ICON_DOWNLOAD;
  }

  function makeButton(card) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sfdl-btn';
    setState(btn, 'idle', 'プレビュー音源をダウンロード');

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.sfdlState === 'busy') return;

      setState(btn, 'busy', 'ダウンロード中…');

      try {
        let url = card.dataset.sfdlUrl || findUrlInCard(card);

        // 静的に見つからない → 実際に再生させて URL を捕まえる
        if (!url) {
          const play = findPlayControl(card);
          if (play) {
            const p = waitForAudio(6000);
            play.click();
            url = await p;
            pauseAll();
          }
        }

        // 直前に鳴っていた音源を最後の頼みにする
        if (!url && lastAudio && Date.now() - lastAudio.at < 15000) {
          url = lastAudio.url;
        }

        if (!url) throw new Error('プレビュー音源の URL を特定できませんでした');

        card.dataset.sfdlUrl = url;
        const filename = buildFilename(card, url);

        const res = await requestDownload(url, filename);
        if (!res.ok) {
          await fallbackDownload(url, filename);
        }

        setState(btn, 'done', 'ダウンロード済み: ' + filename.split('/').pop());
        setTimeout(() => {
          if (btn.dataset.sfdlState === 'done') setState(btn, 'idle', 'プレビュー音源をダウンロード');
        }, 2500);
      } catch (err) {
        console.warn('[SampleTap]', err);
        setState(btn, 'error', 'ダウンロード失敗: ' + (err && err.message ? err.message : err));
        setTimeout(() => {
          if (btn.dataset.sfdlState === 'error') setState(btn, 'idle', 'プレビュー音源をダウンロード');
        }, 4000);
      }
    });

    return btn;
  }

  /* ------------------------------------------------------------------ *
   * 差し込み
   * ------------------------------------------------------------------ */
  function attach(card) {
    if (card.dataset[MARK]) return;
    const play = findPlayControl(card);
    const dl = findDownloadControl(card);
    if (!play && !dl) return; // サンプルカードではなさそう

    card.dataset[MARK] = '1';
    const btn = makeButton(card);

    if (dl && dl.parentElement) {
      dl.insertAdjacentElement('afterend', btn);
    } else if (play && play.parentElement && play.parentElement !== card) {
      play.parentElement.appendChild(btn);
    } else {
      card.classList.add('sfdl-host');
      card.appendChild(btn);
    }
  }

  function scan() {
    try {
      findCards().forEach(attach);
    } catch (err) {
      console.warn('[SampleTap] scan failed', err);
    }
  }

  let pending = null;
  function scheduleScan() {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      scan();
    }, 200);
  }

  scan();

  new MutationObserver((records) => {
    for (const r of records) {
      if (r.addedNodes && r.addedNodes.length) {
        scheduleScan();
        return;
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Turbo / pushstate 対応
  window.addEventListener('popstate', scheduleScan);
  document.addEventListener('turbo:load', scheduleScan);
  document.addEventListener('turbolinks:load', scheduleScan);
})();
