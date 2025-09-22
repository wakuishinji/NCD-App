#!/usr/bin/env python3
"""
Simple test server for NCD-App admin screen debugging
Serves static files and provides basic API endpoints with mock data
"""
import json
import http.server
import socketserver
import urllib.parse
from pathlib import Path

PORT = 9000
BASE_DIR = Path(__file__).parent

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
            self.send_json_response({
                "ok": True,
                "categories": [f"{cat_type}分類1", f"{cat_type}分類2", f"{cat_type}分類3"]
            })
        elif self.path.startswith('/api/listMaster'):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            master_type = query.get('type', [''])[0]
            self.send_json_response({
                "ok": True,
                "items": [
                    {
                        "category": f"{master_type}分類",
                        "name": f"テスト{master_type}1",
                        "canonical_name": f"テスト{master_type}1",
                        "status": "approved",
                        "count": 5,
                        "sources": ["test"],
                        "sortGroup": f"{master_type}系",
                        "sortOrder": 1
                    }
                ]
            })
        elif self.path == '/api/settings':
            self.send_json_response({
                "model": "gpt-4o-mini",
                "prompt": "テスト用プロンプト",
                "prompt_exam": "検査用プロンプト",
                "prompt_diagnosis": "診断用プロンプト"
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
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        try:
            data = json.loads(post_data.decode('utf-8'))
        except json.JSONDecodeError:
            data = {}

        # Simple success response for all POST endpoints
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