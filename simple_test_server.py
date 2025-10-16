#!/usr/bin/env python3
"""
Simple test server for NCD-App admin screen debugging
Serves static files and provides basic API endpoints with mock data
"""
import json
import http.server
import socketserver
import urllib.parse
import sys
from pathlib import Path
from copy import deepcopy
import time

DEFAULT_PORT = 9000
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
BASE_DIR = Path(__file__).parent

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

class NCDTestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR / "web"), **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/'):
            self.handle_api_get()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/'):
            self.handle_api_post()
        else:
            self.send_response(404)
            self.end_headers()

    def handle_api_get(self):
        """Handle API GET requests with mock data"""
        if self.path == '/api/listClinics':
            self.send_json_response({
                "ok": True,
                "clinics": [
                    {
                        "id": "test001",
                        "name": "テスト診療所1",
                        "address": "東京都中野区テスト町1-1-1",
                        "updated_at": 1695388800
                    },
                    {
                        "id": "test002", 
                        "name": "テスト診療所2",
                        "address": "東京都中野区テスト町2-2-2",
                        "updated_at": 1695388900
                    }
                ]
            })
        elif self.path.startswith('/api/listCategories'):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            cat_type = query.get('type', [''])[0]
            if cat_type == 'vaccinationType':
                categories = ["小児定期接種", "任意接種"]
            elif cat_type == 'checkupType':
                categories = ["特定健診", "企業健診", "自治体健診"]
            elif cat_type == 'service':
                categories = ["内科", "外科"]
            elif cat_type == 'test':
                categories = ["血液検査", "画像検査"]
            else:
                categories = [f"{cat_type}分類1", f"{cat_type}分類2", f"{cat_type}分類3"]
            self.send_json_response({
                "ok": True,
                "categories": categories
            })
        elif self.path.startswith('/api/listMaster'):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            master_type = query.get('type', [''])[0]
            if master_type == 'vaccination':
                items = [
                    {
                        "_key": "master:vaccination:小児定期接種|ヒブワクチン",
                        "category": "小児定期接種",
                        "name": "ヒブワクチン",
                        "desc": "生後2か月から接種開始",
                        "status": "approved",
                        "sortOrder": 1
                    },
                    {
                        "_key": "master:vaccination:任意接種|帯状疱疹ワクチン",
                        "category": "任意接種",
                        "name": "帯状疱疹ワクチン",
                        "desc": "50歳以上推奨",
                        "status": "candidate",
                        "sortOrder": 10
                    }
                ]
            elif master_type == 'checkup':
                items = [
                    {
                        "_key": "master:checkup:特定健診|特定健康診査",
                        "category": "特定健診",
                        "name": "特定健康診査",
                        "desc": "生活習慣病の予防を目的とした健診",
                        "status": "approved",
                        "sortOrder": 1
                    },
                    {
                        "_key": "master:checkup:企業健診|雇用時健康診断",
                        "category": "企業健診",
                        "name": "雇用時健康診断",
                        "desc": "入社時に実施する健診",
                        "status": "approved",
                        "sortOrder": 2
                    }
                ]
            else:
                items = [
                    {
                        "_key": f"master:{master_type}:{master_type}分類|テスト{master_type}1",
                        "category": f"{master_type}分類",
                        "name": f"テスト{master_type}1",
                        "status": "approved",
                        "sortGroup": f"{master_type}系",
                        "sortOrder": 1
                    }
                ]
            self.send_json_response({
                "ok": True,
                "items": items
            })
        elif self.path == '/api/settings':
            self.send_json_response({
                "model": "gpt-4o-mini",
                "prompt": "テスト用プロンプト",
                "prompt_exam": "検査用プロンプト",
                "prompt_diagnosis": "診断用プロンプト"
            })
        elif self.path == '/api/todo/list':
            self.send_json_response({
                "ok": True,
                "updatedAt": int(time.time()),
                "todos": current_todos,
            })
        elif self.path.startswith('/api/export'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"export": "test data"}')
        else:
            self.send_json_response({"ok": False, "error": "Not implemented"}, 404)

    def handle_api_post(self):
        """Handle API POST requests"""
        header_length = self.headers.get('Content-Length')
        try:
            content_length = int(header_length) if header_length else 0
        except ValueError:
            content_length = 0
        post_data = self.rfile.read(content_length) if content_length > 0 else b''

        try:
            data = json.loads(post_data.decode('utf-8') or '{}')
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = {}

        if self.path == '/api/todo/save':
            todos = data.get('todos')
            global current_todos
            if isinstance(todos, list):
                current_todos = todos
            self.send_json_response({
                "ok": True,
                "updatedAt": int(time.time()),
                "todos": current_todos,
            })
        else:
            # Simple success response for other POST endpoints
            self.send_json_response({"ok": True, "message": "Success"})

    def send_json_response(self, data, status=200):
        response = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(response)))
        self.end_headers()
        self.wfile.write(response)

if __name__ == "__main__":
    with socketserver.TCPServer(("0.0.0.0", PORT), NCDTestHandler) as httpd:
        print(f"NCD Test Server running at http://0.0.0.0:{PORT}/")
        print(f"Admin panel: http://0.0.0.0:{PORT}/admin/admin.html")
        httpd.serve_forever()
