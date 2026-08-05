/**
 * background.js — chrome.downloads でファイルを保存する。
 * content script から直接 cross-origin fetch すると CORS で落ちる可能性があるため、
 * ブラウザ本体のダウンローダに任せる（CORS の影響を受けない）。
 */

const pending = new Map(); // downloadId -> resolve

chrome.downloads.onChanged.addListener((delta) => {
  const resolve = pending.get(delta.id);
  if (!resolve) return;

  if (delta.state && delta.state.current === 'complete') {
    pending.delete(delta.id);
    resolve({ ok: true, id: delta.id });
  } else if (delta.state && delta.state.current === 'interrupted') {
    pending.delete(delta.id);
    resolve({
      ok: false,
      error: (delta.error && delta.error.current) || 'interrupted'
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SFDL_DOWNLOAD') return;

  chrome.downloads.download(
    {
      url: msg.url,
      filename: msg.filename,
      conflictAction: 'uniquify',
      saveAs: false
    },
    (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        sendResponse({
          ok: false,
          error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'download failed'
        });
        return;
      }
      pending.set(id, sendResponse);

      // 完了イベントが来ない場合に備えて保険
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          sendResponse({ ok: true, id, note: 'timeout-assumed-ok' });
        }
      }, 45000);
    }
  );

  return true; // 非同期レスポンス
});
