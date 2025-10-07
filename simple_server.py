#!/usr/bin/env python3
import http.server
import socketserver
import json
import os
import sys

class NCDHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        
        if self.path == '/api/listClinics':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response = {
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
            }
            self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
            return
        elif self.path == '/api/settings':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response = {
                "model": "gpt-4o-mini",
                "prompt": "医療説明用のサンプルを作ってください",
                "prompt_exam": "",
                "prompt_diagnosis": ""
            }
            self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
            return
        elif self.path.startswith('/api/listCategories'):
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response = {
                "ok": True,
                "categories": ["テスト分類1", "テスト分類2", "テスト分類3"]
            }
            self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
            return
        elif self.path.startswith('/api/listMaster'):
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response = {
                "ok": True,
                "items": [
                    {
                        "type": "test",
                        "category": "内科一般検査",
                        "name": "血液検査",
                        "status": "approved",
                        "count": 5
                    }
                ]
            }
            self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
            return
        else:
            # 静的ファイル配信
            super().do_GET()
    
    def do_POST(self):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        response = {"ok": True}
        self.wfile.write(json.dumps(response).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

if __name__ == "__main__":
    os.chdir("web")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 7000
    with socketserver.TCPServer(("0.0.0.0", port), NCDHandler) as httpd:
        print(f"Server running at http://0.0.0.0:{port}")
        httpd.serve_forever()
