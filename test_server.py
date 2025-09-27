#!/usr/bin/env python3
import http.server
import socketserver
import json
import os

class NCDHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
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
                        "created_at": "2025-01-01",
                        "schema_version": 1
                    }
                ]
            }
            self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
        elif self.path == '/api/settings':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response = {
                "model": "gpt-4o-mini",
                "prompt": "医療説明用のサンプルを作ってください"
            }
            self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
        else:
            # 静的ファイル配信
            super().do_GET()
    
    def do_POST(self):
        if self.path == '/api/registerClinic':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {
                    "ok": True,
                    "clinic": {
                        "id": "new-clinic-id",
                        "name": data.get("name", "新しい診療所"),
                        "created_at": "2025-09-22",
                        "schema_version": 1
                    }
                }
                self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
            except:
                self.send_response(400)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    os.chdir("web")
    PORT = 6000
    with socketserver.TCPServer(("0.0.0.0", PORT), NCDHandler) as httpd:
        print(f"Server running at http://0.0.0.0:{PORT}")
        httpd.serve_forever()