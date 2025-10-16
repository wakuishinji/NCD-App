#!/usr/bin/env python3
import http.server
import socketserver
import json
import os
import sys
import time
from copy import deepcopy
from urllib.parse import urlparse, parse_qs

DEFAULT_TODOS = [
    {
        "category": "フロントエンド",
        "title": "フォームバリデーション実装",
        "status": "open",
        "priority": "P1",
        "createdAt": "2025-01-01T09:00:00+09:00",
    },
    {
        "category": "サーバー",
        "title": "Let’s Encrypt 自動更新",
        "status": "done",
        "priority": "P2",
        "createdAt": "2025-01-05T09:00:00+09:00",
    },
]

current_todos = deepcopy(DEFAULT_TODOS)


class NCDHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == '/api/listClinics':
            self.send_json({
                "ok": True,
                "clinics": [
                    {
                        "id": "test-clinic-1",
                        "name": "テスト診療所1",
                        "address": "中野区中央1-1-1",
                        "created_at": 1640995200,
                        "updated_at": 1640995200,
                        "schema_version": 1
                    },
                    {
                        "id": "test-clinic-2",
                        "name": "サンプル医院",
                        "address": "中野区東1-2-3",
                        "created_at": 1640995200,
                        "updated_at": 1640995200,
                        "schema_version": 1
                    }
                ]
            })
        elif path == '/api/settings':
            self.send_json({
                "model": "gpt-4o-mini",
                "prompt": "医療説明用のサンプルを作ってください",
                "prompt_exam": "",
                "prompt_diagnosis": ""
            })
        elif path == '/api/listCategories':
            type_param = (query.get('type') or [''])[0]
            if type_param == 'vaccinationType':
                categories = ["小児定期接種", "任意接種"]
            elif type_param == 'checkupType':
                categories = ["特定健診", "企業健診", "自治体健診"]
            elif type_param == 'service':
                categories = ["内科", "外科"]
            elif type_param == 'test':
                categories = ["血液検査", "画像検査"]
            else:
                categories = ["分類A", "分類B", "分類C"]
            self.send_json({
                "ok": True,
                "categories": categories
            })
        elif path == '/api/listMaster':
            master_type = (query.get('type') or [''])[0]
            if master_type == 'vaccination':
                items = [
                    {
                        "_key": "master:vaccination:小児定期接種|麻しん風しん混合",
                        "type": "vaccination",
                        "category": "小児定期接種",
                        "name": "麻しん風しん混合 (MR)",
                        "desc": "1歳・年長時に定期接種",
                        "status": "approved"
                    },
                    {
                        "_key": "master:vaccination:任意接種|おたふくかぜ",
                        "type": "vaccination",
                        "category": "任意接種",
                        "name": "おたふくかぜワクチン",
                        "desc": "任意接種 / 1歳以降",
                        "status": "candidate"
                    }
                ]
            elif master_type == 'checkup':
                items = [
                    {
                        "_key": "master:checkup:特定健診|特定健康診査",
                        "type": "checkup",
                        "category": "特定健診",
                        "name": "特定健康診査",
                        "desc": "40〜74歳対象の生活習慣病予防健診",
                        "status": "approved"
                    },
                    {
                        "_key": "master:checkup:企業健診|雇入時健診",
                        "type": "checkup",
                        "category": "企業健診",
                        "name": "雇入時健康診断",
                        "desc": "労働安全衛生規則に基づく健診",
                        "status": "approved"
                    }
                ]
            else:
                items = [
                    {
                        "_key": "master:test:内科一般検査|血液検査",
                        "type": "test",
                        "category": "内科一般検査",
                        "name": "血液検査",
                        "status": "approved",
                        "count": 5
                    }
                ]
            self.send_json({"ok": True, "items": items})
        elif path == '/api/todo/list':
            self.send_json({
                "ok": True,
                "updatedAt": int(time.time()),
                "todos": current_todos,
            })
        else:
            # 静的ファイル配信
            super().do_GET()

    def do_POST(self):
        content_length = self.headers.get('Content-Length')
        try:
            length = int(content_length) if content_length else 0
        except ValueError:
            length = 0
        raw_body = self.rfile.read(length) if length > 0 else b''

        if self.path == '/api/todo/save':
            try:
                payload = json.loads(raw_body.decode('utf-8') or '{}')
            except (json.JSONDecodeError, UnicodeDecodeError):
                payload = {}
            todos = payload.get('todos')
            global current_todos
            if isinstance(todos, list):
                current_todos = todos
            self.send_json({
                "ok": True,
                "updatedAt": int(time.time()),
                "todos": current_todos,
            })
        else:
            self.send_json({"ok": True})

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()


if __name__ == "__main__":
    os.chdir("web")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 7000
    with socketserver.TCPServer(("0.0.0.0", port), NCDHandler) as httpd:
        print(f"Server running at http://0.0.0.0:{port}")
        httpd.serve_forever()
