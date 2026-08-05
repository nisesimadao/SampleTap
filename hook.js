/**
 * hook.js — ページ本体(MAIN world)で動く。
 *
 * SampleFocus は各サンプルの mp3 URL を、React on Rails が吐く
 * <script type="application/json"> のペイロードに `sample_mp3_url` として
 * 最初から埋め込んでいる。つまり再生しなくても正解の URL が分かる。
 *
 * ここではその索引を作り、content script からの問い合わせ（slug / sample id）に
 * 答える。ページ送りやフィルタで後から来る分は fetch/XHR のレスポンスを見て
 * 足し、それでも無ければ React の fiber から拾う。
 *
 * content script (ISOLATED world) からは page のプロパティ（__reactFiber$… 等）が
 * 見えないので、この係だけは MAIN world に居る必要がある。
 */
(() => {
  if (window.__sfdlHookInstalled) return;
  window.__sfdlHookInstalled = true;

  const bySlug = new Map();
  const byId = new Map();

  function addEntry(o) {
    if (!o || typeof o.sample_mp3_url !== 'string') return false;
    const e = {
      mp3: o.sample_mp3_url,
      name: typeof o.name === 'string' ? o.name : '',
      slug: typeof o.slug === 'string' ? o.slug : '',
      id: o.id != null ? String(o.id) : ''
    };
    if (e.slug) bySlug.set(e.slug, e);
    if (e.id) byId.set(e.id, e);
    return true;
  }

  // 任意の JSON から sample_mp3_url を持つオブジェクトを掘り出す
  function harvest(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 8) return 0;
    let n = 0;
    if (Array.isArray(obj)) {
      for (const v of obj) n += harvest(v, depth + 1);
      return n;
    }
    if (addEntry(obj)) n++;
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') n += harvest(v, depth + 1);
    }
    return n;
  }

  /* --- 1) 埋め込み JSON（初期表示ぶん） ---------------------------------- */
  const scannedScripts = new WeakSet();

  function scanEmbeddedJson() {
    document.querySelectorAll('script[type="application/json"]').forEach((s) => {
      if (scannedScripts.has(s)) return;
      scannedScripts.add(s);
      const t = s.textContent;
      if (!t || t.indexOf('sample_mp3_url') === -1) return;
      try {
        harvest(JSON.parse(t), 0);
      } catch (_) {}
    });
  }

  scanEmbeddedJson();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanEmbeddedJson);
  }

  /* --- 2) 後から来るぶん（ページ送り・フィルタ・無限スクロール） ---------- */
  try {
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const p = origFetch.apply(this, arguments);
      return p.then((res) => {
        try {
          const ct = res.headers && res.headers.get && res.headers.get('content-type');
          if (ct && ct.indexOf('json') !== -1) {
            res
              .clone()
              .json()
              .then((j) => harvest(j, 0))
              .catch(() => {});
          }
        } catch (_) {}
        return res;
      });
    };
  } catch (_) {}

  try {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
      this.addEventListener('load', function () {
        try {
          const t = this.responseType;
          if (t && t !== 'text' && t !== 'json') return;
          const body = t === 'json' ? this.response : this.responseText;
          if (!body) return;
          if (typeof body === 'string') {
            if (body.indexOf('sample_mp3_url') === -1) return;
            harvest(JSON.parse(body), 0);
          } else {
            harvest(body, 0);
          }
        } catch (_) {}
      });
      return origOpen.apply(this, arguments);
    };
  } catch (_) {}

  /* --- 3) 最後の砦: React fiber から拾う -------------------------------- */
  function matches(o, slug, id) {
    if (!o || typeof o.sample_mp3_url !== 'string') return false;
    if (slug && o.slug === slug) return true;
    if (id && o.id != null && String(o.id) === id) return true;
    return false;
  }

  function scanProps(obj, slug, id, depth) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;
    if (Array.isArray(obj)) {
      for (const v of obj) {
        const r = scanProps(v, slug, id, depth + 1);
        if (r) return r;
      }
      return null;
    }
    if (matches(obj, slug, id)) return obj;
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') {
        const r = scanProps(v, slug, id, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  function fromFiber(el, slug, id) {
    if (!el) return null;
    const key = Object.keys(el).find((k) => k.indexOf('__reactFiber$') === 0);
    if (!key) return null;
    let node = el[key];
    let hops = 0;
    while (node && hops++ < 30) {
      const props = node.memoizedProps || node.pendingProps;
      const hit = scanProps(props, slug, id, 0);
      if (hit) {
        addEntry(hit);
        return hit;
      }
      node = node.return;
    }
    return null;
  }

  /* --- content script との窓口 ------------------------------------------ */
  function reply(reqId, entry) {
    window.postMessage(
      {
        __sfdl: 'page->cs',
        type: 'RESOLVED',
        reqId,
        url: entry ? entry.sample_mp3_url || entry.mp3 : null,
        name: entry ? entry.name || '' : ''
      },
      location.origin
    );
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__sfdl !== 'cs->page') return;

    if (d.type === 'RESOLVE') {
      const slug = d.slug || '';
      const id = d.id ? String(d.id) : '';

      let entry = (slug && bySlug.get(slug)) || (id && byId.get(id)) || null;

      if (!entry) {
        scanEmbeddedJson();
        entry = (slug && bySlug.get(slug)) || (id && byId.get(id)) || null;
      }
      if (!entry && d.reqId != null) {
        const el = document.querySelector('[data-sfdl-req="' + d.reqId + '"]');
        entry = fromFiber(el, slug, id);
      }
      reply(d.reqId, entry);
    }
  });
})();
