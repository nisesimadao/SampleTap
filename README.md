<div align="center">

<img src="icons/icon128.png" width="88" alt="SampleTap">

# SampleTap

**samplefocus.com のプレビュー音源を、その場で1つ落とす。**
再生ボタンの隣に赤いボタンを足すだけ。ページからは離れない。

Chrome / Edge · Manifest V3 · MIT License

</div>

---

## これは何

[SampleFocus](https://samplefocus.com) のサンプル一覧で、カードの操作列（再生 ▶ とダウンロードのある行）に**赤い丸ボタン**を1つ足す拡張機能です。押すと、そのカードが試聴に使っている音源ファイルがそのまま保存されます。

作りは引き算です。ポップアップも設定画面もオプションページもありません。権限は `downloads` と `samplefocus.com` の2つだけ。ボタン以外は何も置きません。

## できること

- **カードごとに赤いダウンロードボタン** — 既存のダウンロードボタンの右隣、同じ行に入る
- **ファイル名はサンプル名** — `ダウンロード/SampleFocus/<サンプル名>.mp3` に落ちる。拡張子は実際の URL に合わせる
- **押した結果が色で返る** — 成功で緑のチェック、失敗で暗赤。失敗理由はツールチップに出る
- **無限スクロールに追従** — 後から生えたカードにもボタンが付く
- **クラス名に賭けない** — サイトの HTML が変わってもボタンと保存が生き残るよう、URL は実行時に見つける（後述）

## 動かすもの

| | |
|---|---|
| ブラウザ | Chrome / Edge（Manifest V3、`world: "MAIN"` を使うので Chrome 111 以降） |
| 必要なもの | なし。ビルド不要・依存ゼロ |

## 入れる

インストーラーもビルドもありません。このリポジトリをそのまま読み込みます。

1. `chrome://extensions` を開く
2. 右上の **デベロッパーモード** を ON
3. **「パッケージ化されていない拡張機能を読み込む」** → このフォルダを選ぶ
4. https://samplefocus.com/tag/hardbass などを開く（開いていたらリロード）

```sh
git clone https://github.com/nisesimadao/SampleTap.git
```

## 使う

赤いボタンを押すだけです。

保存先は `ダウンロード/SampleFocus/` 配下。同名のファイルがあれば連番が付きます。

## 仕組み

作るうえで引っかかったところを残しておきます。

**クラス名を決め打ちしない**
SampleFocus は Cloudflare のチャレンジを挟むので、ブラウザの外から HTML を取れません。つまり「`.sample-card` の中の `.download-btn`」といった前提を**検証せずに書くことになる**。なのでカード検出は当て推量のセレクタ列 → それが全滅なら「再生っぽい要素とダウンロードっぽい要素を同時に含む最小の祖先」というフォールバックにしてあります。当たっても外れてもボタンは出ます。

**音源 URL は2段構えで掴む**
まずカード内の属性・`<audio>`・埋め込み JSON から `.mp3` / `.wav` を静的に探します。見つからなければ**そのカード本来の再生ボタンを一瞬だけ押し**、ページ本体で走らせたフック (`hook.js`) が横取りした実際のストリーム URL を使います。掴んだ時点で再生は止めます。前者が当たれば即座、外れても後者で必ず取れる、という組み方です。

**フックは7経路要る**
`loadstart` を `document` でキャプチャすれば大抵は拾えます。ただし `new Audio()` で作って DOM に挿さないまま鳴らす実装だと、**イベントが `document` まで飛んできません**。なので `HTMLMediaElement.prototype.src` のセッター、`setAttribute`、`play()`、`Audio` コンストラクタも合わせて見ています。Web Audio で `arrayBuffer` を取る実装に備えて `fetch` と `XHR` も。どれが当たっても同じ `postMessage` に集約されます。

**保存は `chrome.downloads` に投げる**
content script から CDN を `fetch` すると、その CDN のオリジンに `host_permissions` が要ります。ドメインが分からない以上 `<all_urls>` を要求することになり、権限としては重すぎる。`chrome.downloads` はブラウザ本体が取りに行くので**CORS の外側**にいて、追加の権限が要りません。万一失敗したときだけ、ページ側 `fetch` → `<a download>` に落とします。

**止めるほうも DOM だけでは足りない**
掴んだあと再生を止めますが、`document.querySelectorAll('audio')` では DOM に挿さっていない `Audio` を拾えません。フック側が見たメディア要素を `Set` に控えておき、そちらから止めています。

## うまく動かないとき

**ボタンが出ない** — カード検出が外れています。DevTools のコンソールで実行して、出力を [Issues](../../issues) に貼ってください。実際の DOM に合わせて直します。

```js
document.querySelectorAll('[class*="download" i], [class*="play" i]')
  .forEach(el => console.log(el.tagName, el.className, el.closest('[class]')?.className));
```

**ボタンは出るが落ちてこない** — コンソールに `[SampleTap]` 付きの警告が出ます。そこに URL とエラーが載ります。

なお**実サイトでの動作確認は取れていません**（同じ Cloudflare の都合で、手元から確認する手段がない）。壊れていたら遠慮なく投げてください。

## 注意

保存されるのは**サイトが試聴に使っている音源そのもの**です。正規のダウンロードで得られるファイルとは別物のことがあります。落とした素材の扱いは SampleFocus の利用規約と各サンプルのライセンスに従ってください。

## ライセンス

[MIT](LICENSE)
