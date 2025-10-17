#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/start_test_server.sh [simple|admin] [port]
#  - simple: 起動時に simple_server.py を使い、デフォルトポートは7000
#  - admin:  起動時に simple_test_server.py を使い、デフォルトポートは9000

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="${1:-admin}"
PORT_ARG="${2:-}"

case "$MODE" in
  simple)
    SERVER_FILE="simple_server.py"
    DEFAULT_PORT=7000
    ;;
  admin)
    SERVER_FILE="simple_test_server.py"
    DEFAULT_PORT=9000
    ;;
  *)
    echo "Usage: $0 [simple|admin] [port]" >&2
    exit 1
    ;;
esac

PORT="${PORT_ARG:-$DEFAULT_PORT}"

if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "ポート$PORTは使用中です。別のポートを指定してください。" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3コマンドが見つかりません。インストールするかPATHを確認してください。" >&2
  exit 1
fi

cd "$PROJECT_ROOT"

echo "${SERVER_FILE} をポート${PORT}で起動します..."
exec python3 "$SERVER_FILE" "$PORT"
