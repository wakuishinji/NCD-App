# === NCD-APP Web フォルダ初期化スクリプト ===
# 管理者権限 PowerShell で実行してください

$root = "C:\ncd-app\nakano-medical"
$css  = "$root\css"
$js   = "$root\js"

Write-Host "=== Web構成を初期化します ==="

# 1. フォルダ作成
foreach ($dir in @($root, $css, $js)) {
    if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Write-Host "作成: $dir"
    } else {
        Write-Host "存在: $dir"
    }
}

# 2. index.html
@"
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>中野区医師会 診療所データベース</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header>
    <h1>中野区医師会 診療所データベース</h1>
    <nav>
      <button onclick="loadPage('home.html')">ホーム</button>
      <button onclick="loadPage('clinic.html')">診療所入力</button>
      <button onclick="loadPage('admin.html')">管理画面</button>
    </nav>
  </header>
  <main id="main"></main>
  <footer><p>&copy; 2025 中野区医師会</p></footer>
  <script src="js/scripts.js"></script>
</body>
</html>
"@ | Set-Content "$root\index.html" -Encoding UTF8

# 3. home.html
@"
<h2>ホーム</h2>
<p>こちらから診療所情報の登録や確認を行えます。</p>
<div class="cards">
  <div class="card">
    <h3>新規診療所登録</h3>
    <p>初めて登録する場合はこちらから。</p>
    <button>新規登録開始</button>
  </div>
  <div class="card">
    <h3>施設を選択</h3>
    <p>既に登録済みの診療所を選んで続きから入力できます。</p>
    <button>施設選択</button>
  </div>
</div>
"@ | Set-Content "$root\home.html" -Encoding UTF8

# 4. clinic.html
@"
<h2>診療所入力</h2>
<section>
  <h3>基本情報</h3>
  <form>
    <label>診療所名: <input type="text"></label><br>
    <label>院長名: <input type="text"></label><br>
    <label>住所: <input type="text"></label><br>
    <label>電話番号: <input type="tel"></label><br>
  </form>
</section>
<section>
  <h3>検査項目</h3>
  <button>検査を追加</button>
</section>
<section>
  <h3>診療科目</h3>
  <button>診療を追加</button>
</section>
"@ | Set-Content "$root\clinic.html" -Encoding UTF8

# 5. admin.html
@"
<h2>管理画面</h2>
<section>
  <h3>AI プロンプト設定</h3>
  <form id="promptForm">
    <label>説明種別:
      <select id="promptKey">
        <option value="exam">検査の説明</option>
        <option value="treatment">診療の説明</option>
        <option value="general">一般説明</option>
      </select>
    </label>
    <br><br>
    <label>プロンプト内容:<br>
      <textarea id="promptValue" rows="5" cols="60"></textarea>
    </label>
    <br><br>
    <button type="submit">保存</button>
  </form>
  <p id="status"></p>
</section>
"@ | Set-Content "$root\admin.html" -Encoding UTF8

# 6. style.css
@"
body { font-family: sans-serif; margin: 0; padding: 0; }
header, footer { background: #004080; color: white; padding: 1em; }
nav button { margin-right: 1em; }
main { padding: 1em; }
.cards { display: flex; gap: 1em; }
.card { background: #f0f0f0; padding: 1em; border-radius: 8px; }
"@ | Set-Content "$css\style.css" -Encoding UTF8

# 7. scripts.js
@"
function loadPage(page) {
  fetch(page)
    .then(res => res.text())
    .then(html => {
      document.getElementById('main').innerHTML = html;

      // 管理画面だけ初期化
      if (page === 'admin.html') {
        const form = document.getElementById('promptForm');
        if (form) {
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const key = document.getElementById('promptKey').value;
            const value = document.getElementById('promptValue').value;
            console.log('保存:', key, value); // TODO: Worker APIに接続
            document.getElementById('status').textContent = '保存しました ✅';
          });
        }
      }
    });
}
window.onload = () => loadPage('home.html');
"@ | Set-Content "$js\scripts.js" -Encoding UTF8

Write-Host "=== Web構成初期化 完了 ==="