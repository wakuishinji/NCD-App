# supervisord を使ったローカル起動手順

`supervisord.conf` はリポジトリ直下を基点としたテンプレートです。あらかじめ `.supervisor` ディレクトリを作成し、ログや PID をその中に置く構成にしています。

```bash
mkdir -p .supervisor
supervisord -c supervisord.conf
```

停止する場合は次のコマンドを実行します。

```bash
supervisorctl -c supervisord.conf shutdown
```

Cloudflare Wrangler の互換日やバインディングが変わる場合は、`[program:ncd-app]` セクションの `command` 行を調整してください。
