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