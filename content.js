/**
 * content.js — samplefocus.com のサンプルカードに赤いダウンロードボタンを足す。
 *
 * ボタンはサイト自身のダウンロードボタンを clone して作る（色だけ赤にする）ので、
 * 大きさ・余白・角丸・波紋エフェクトは本家と完全に同じものになる。
 *
 * 音源 URL はカードの slug / sample id を鍵に hook.js へ問い合わせる。
 * 「今鳴っている音」ではなくカードに紐づいた URL を引くので、取り違えは起きない。
 */
(() => {
  'use strict';

  const CARD = '.sample-card';
  const ACTION = '.sf-card-action';
  const PLAY = '[aria-label="Play/stop"]';
  const DOWNLOAD = '[aria-label="Download"]';
  const OUR_LABEL = 'Download preview';
  const CTRL_RE = new RegExp('[\u0000-\u001F\u007F]', 'g');

  /* ------------------------------------------------------------------ *
   * hook.js への問い合わせ
   * ------------------------------------------------------------------ */
  let seq = 0;
  const pendingResolve = new Map();

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__sfdl !== 'page->cs' || d.type !== 'RESOLVED') return;
    const fn = pendingResolve.get(d.reqId);
    if (!fn) return;
    pendingResolve.delete(d.reqId);
    fn(d.url ? { url: d.url, name: d.name || '' } : null);
  });

  function resolveUrl(card, slug, id) {
    return new Promise((resolve) => {
      const reqId = ++seq;
      pendingResolve.set(reqId, resolve);
      card.setAttribute('data-sfdl-req', String(reqId));
      window.postMessage({ __sfdl: 'cs->page', type: 'RESOLVE', reqId, slug, id }, location.origin);
      setTimeout(() => {
        if (pendingResolve.has(reqId)) {
          pendingResolve.delete(reqId);
          resolve(null);
        }
        card.removeAttribute('data-sfdl-req');
      }, 4000);
    });
  }

  /* ------------------------------------------------------------------ *
   * カードから鍵を取り出す
   * ------------------------------------------------------------------ */
  function slugOf(card) {
    const a = card.querySelector('a.sample-card-link[href], a[href*="/samples/"]');
    if (!a) return '';
    const m = (a.getAttribute('href') || '').match(/\/samples\/([^/?#]+)/);
    return m ? m[1] : '';
  }

  function idOf(card) {
    const img = card.querySelector('img[data-testid="sample-waveform-image"], img[src*="sample_files/"]');
    if (!img) return '';
    const m = (img.getAttribute('src') || '').match(/sample_files\/(\d+)\//);
    return m ? m[1] : '';
  }

  function titleOf(card) {
    const h = card.querySelector('[role="heading"]');
    const t = h && h.textContent ? h.textContent.trim() : '';
    if (t) return t;
    const img = card.querySelector('img[alt$="waveform"]');
    const alt = img ? (img.getAttribute('alt') || '').replace(/\s*waveform$/, '').trim() : '';
    return alt;
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

  function buildFilename(title, url) {
    let ext = 'mp3';
    try {
      const m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
      if (m) ext = m[1].toLowerCase();
    } catch (_) {}

    let base = sanitize(title || '');
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
   * ダウンロード
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
          if (chrome.runtime.lastError) finish({ ok: false, error: chrome.runtime.lastError.message });
          else finish(res || { ok: false, error: 'no response' });
        });
      } catch (err) {
        finish({ ok: false, error: String(err) });
      }
      setTimeout(() => finish({ ok: false, error: 'timeout' }), 60000);
    });
  }

  // CDN は Referer の無い要求を 403 で弾く。拡張の service worker から
  // 直接 chrome.downloads に URL を渡すと Referer が付かないので落ちる。
  // ページ文脈の fetch なら Referer / Origin がブラウザによって自動で付き、
  // CORS もサイト自身の試聴再生と同じ条件で通る。だからまずここで取る。
  async function fetchBlob(url) {
    const res = await fetch(url, { credentials: 'omit', mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.blob();
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('read failed'));
      fr.readAsDataURL(blob);
    });
  }

  // chrome.downloads が使えない / data URL が大きすぎる場合の保険。
  // サブフォルダは付けられないが、確実に保存できる。
  function saveViaAnchor(blob, filename) {
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
   * ボタン
   * ------------------------------------------------------------------ */
  function setIcon(btn, faClass) {
    const i = btn.querySelector('i');
    if (i) i.className = faClass;
  }

  function setState(btn, state, label) {
    btn.dataset.sfdlState = state;
    btn.setAttribute('title', label);
    setIcon(
      btn,
      state === 'busy'
        ? 'fas fa-spinner fa-spin'
        : state === 'done'
          ? 'fas fa-check'
          : state === 'error'
            ? 'fas fa-exclamation-triangle'
            : 'fas fa-download'
    );
  }

  async function onClick(btn, card, e) {
    e.preventDefault();
    e.stopPropagation();
    if (btn.dataset.sfdlState === 'busy') return;

    setState(btn, 'busy', 'ダウンロード中…');
    try {
      let url = card.dataset.sfdlUrl || '';
      let title = titleOf(card);

      if (!url) {
        const hit = await resolveUrl(card, slugOf(card), idOf(card));
        if (!hit) throw new Error('この カードの音源 URL が引けませんでした');
        url = hit.url;
        if (!title) title = hit.name;
        card.dataset.sfdlUrl = url;
      }

      const filename = buildFilename(title, url);
      const blob = await fetchBlob(url);

      let saved = false;
      try {
        const dataUrl = await blobToDataUrl(blob);
        saved = (await requestDownload(dataUrl, filename)).ok;
      } catch (_) {
        saved = false;
      }
      if (!saved) saveViaAnchor(blob, filename);

      setState(btn, 'done', 'ダウンロード済み: ' + filename.split('/').pop());
      setTimeout(() => {
        if (btn.dataset.sfdlState === 'done') setState(btn, 'idle', 'プレビュー音源をダウンロード');
      }, 2000);
    } catch (err) {
      console.warn('[SampleTap]', err);
      setState(btn, 'error', 'ダウンロード失敗: ' + (err && err.message ? err.message : err));
      setTimeout(() => {
        if (btn.dataset.sfdlState === 'error') setState(btn, 'idle', 'プレビュー音源をダウンロード');
      }, 4000);
    }
  }

  // サイト自身のダウンロードボタンを複製して赤くする。
  // emotion のクラス名はビルドごとに変わるので、決め打ちせず現物を写す。
  function makeButton(source, card) {
    const btn = source.cloneNode(true);
    btn.classList.add('sfdl-btn');
    btn.setAttribute('aria-label', OUR_LABEL);
    btn.removeAttribute('data-sfdl-req');
    setState(btn, 'idle', 'プレビュー音源をダウンロード');

    btn.addEventListener('click', (e) => onClick(btn, card, e));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onClick(btn, card, e);
    });
    return btn;
  }

  /* ------------------------------------------------------------------ *
   * 差し込み
   * ------------------------------------------------------------------ */
  function attach(card) {
    if (card.dataset.sfdlDone) return;
    const action = card.querySelector(ACTION);
    if (!action) return;
    const dl = action.querySelector(DOWNLOAD);
    const play = action.querySelector(PLAY);
    const source = dl || play;
    if (!source) return;

    card.dataset.sfdlDone = '1';
    dl ? dl.insertAdjacentElement('afterend', makeButton(source, card))
       : action.appendChild(makeButton(source, card));
  }

  function scan() {
    try {
      document.querySelectorAll(CARD).forEach(attach);
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
    }, 150);
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

  window.addEventListener('popstate', scheduleScan);
})();
