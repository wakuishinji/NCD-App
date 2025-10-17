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

SAMPLE_MODES = [
    {
        "id": "outpatient",
        "label": "外来診療",
        "icon": "fa-solid fa-stethoscope",
        "color": "#2563eb",
        "order": 1,
        "active": True,
    },
    {
        "id": "homecare",
        "label": "訪問診療",
        "icon": "fa-solid fa-house-medical",
        "color": "#059669",
        "order": 2,
        "active": True,
    },
]

SAMPLE_CLINICS = {
    "test001": {
        "id": "test001",
        "name": "テスト診療所1",
        "postalCode": "1640001",
        "address": "東京都中野区中央1-1-1",
        "phone": "03-1234-5678",
        "fax": "03-1234-5679",
        "doctors": {
            "fulltime": 2,
            "parttime": 1,
            "qualifications": "日本内科学会 認定内科医",
        },
        "schedule": {
            "patterns": {
                "amA": ["09:00", "12:00"],
                "amB": ["09:30", "12:30"],
                "pmA": ["14:00", "18:00"],
                "pmB": ["15:00", "19:00"],
            },
            "days": {
                "月曜": {"am": "午前A", "pm": "午後A"},
                "火曜": {"am": "午前A", "pm": "午後B"},
                "水曜": {"am": "午前B", "pm": "午後A"},
                "木曜": {"am": "午前B", "pm": "午後B"},
                "金曜": {"am": "午前A", "pm": "午後A"},
                "土曜": {"am": "午前A", "pm": "休診"},
                "日曜": {"am": "休診", "pm": "休診"},
                "祝日": {"am": "休診", "pm": "休診"},
            },
        },
        "homepage": {"available": True, "url": "https://clinic1.example.jp"},
        "reservation": {"available": True, "url": "https://clinic1.example.jp/reserve"},
        "departments": {"master": ["内科", "小児科"], "others": ["訪問診療"]},
        "media": {
            "logoSmall": {
                "key": "clinic/test001/logo-small.webp",
                "contentType": "image/webp",
                "width": 512,
                "height": 512,
                "fileSize": 40120,
                "alt": "テスト診療所1 ロゴ",
                "uploadedAt": 1695388800,
            }
        },
        "access": {
            "nearestStation": ["JR中野駅 北口 徒歩5分"],
            "bus": ["関東バス 中野駅入口 徒歩2分"],
            "parking": {"available": True, "capacity": 2, "notes": "近隣コインパーキング提携"},
            "barrierFree": ["入口段差なし", "エレベーターあり"],
            "notes": "ベビーカー対応",
        },
        "modes": {
            "selected": ["outpatient", "homecare"],
            "meta": {
                "outpatient": {
                    "label": "外来診療",
                    "icon": "fa-solid fa-stethoscope",
                    "color": "#2563eb",
                    "order": 1,
                },
                "homecare": {
                    "label": "訪問診療",
                    "icon": "fa-solid fa-house-medical",
                    "color": "#059669",
                    "order": 2,
                },
            },
        },
        "vaccinations": {
            "selected": ["master:vaccination:小児定期接種|ヒブワクチン"],
            "meta": {
                "master:vaccination:小児定期接種|ヒブワクチン": {
                    "category": "小児定期接種",
                    "name": "ヒブワクチン",
                    "desc": "生後2か月から接種開始",
                }
            },
        },
        "checkups": {
            "selected": ["master:checkup:特定健診|特定健康診査"],
            "meta": {
                "master:checkup:特定健診|特定健康診査": {
                    "category": "特定健診",
                    "name": "特定健康診査",
                    "desc": "生活習慣病予防健診",
                }
            },
        },
        "latitude": 35.7062,
        "longitude": 139.6659,
        "location": {
            "lat": 35.7062,
            "lng": 139.6659,
            "formattedAddress": "東京都中野区中央1-1-1",
            "source": "mock",
            "geocodedAt": "2025-01-01T00:00:00+09:00",
        },
        "updated_at": 1695388800,
        "created_at": 1692796800,
        "schema_version": 2,
    },
    "test002": {
        "id": "test002",
        "name": "テスト診療所2",
        "postalCode": "1640012",
        "address": "東京都中野区本町2-2-2",
        "phone": "03-9876-5432",
        "fax": "",
        "doctors": {
            "fulltime": 1,
            "parttime": 2,
            "qualifications": "日本外科学会 専門医",
        },
        "schedule": {
            "patterns": {
                "amA": ["09:00", "12:00"],
                "amB": ["10:00", "13:00"],
                "pmA": ["14:00", "17:00"],
                "pmB": ["15:00", "18:30"],
            },
            "days": {
                "月曜": {"am": "午前A", "pm": "午後A"},
                "火曜": {"am": "午前B", "pm": "午後A"},
                "水曜": {"am": "午前A", "pm": "午後A"},
                "木曜": {"am": "休診", "pm": "休診"},
                "金曜": {"am": "午前A", "pm": "午後B"},
                "土曜": {"am": "午前B", "pm": "休診"},
                "日曜": {"am": "休診", "pm": "休診"},
                "祝日": {"am": "休診", "pm": "休診"},
            },
        },
        "homepage": {"available": False, "url": ""},
        "reservation": {"available": False, "url": ""},
        "departments": {"master": ["外科"], "others": []},
        "media": {},
        "access": {
            "nearestStation": ["東京メトロ中野坂上駅 徒歩8分"],
            "bus": [],
            "parking": {"available": False, "capacity": None, "notes": ""},
            "barrierFree": ["院内エレベーターあり"],
            "notes": "",
        },
        "modes": {
            "selected": ["outpatient"],
            "meta": {
                "outpatient": {
                    "label": "外来診療",
                    "icon": "fa-solid fa-stethoscope",
                    "color": "#2563eb",
                    "order": 1,
                }
            },
        },
        "vaccinations": None,
        "checkups": None,
        "latitude": 35.695,
        "longitude": 139.683,
        "location": {
            "lat": 35.695,
            "lng": 139.683,
            "formattedAddress": "東京都中野区本町2-2-2",
            "source": "mock",
            "geocodedAt": "2025-01-01T00:00:00+09:00",
        },
        "updated_at": 1695389900,
        "created_at": 1692797800,
        "schema_version": 2,
    },
}


def clinic_summary(clinic: dict) -> dict:
    return {
        "id": clinic.get("id"),
        "name": clinic.get("name"),
        "address": clinic.get("address", ""),
        "postalCode": clinic.get("postalCode", ""),
        "updated_at": clinic.get("updated_at"),
        "created_at": clinic.get("created_at"),
        "schema_version": clinic.get("schema_version", 1),
    }


def find_clinic(id_param: str = None, name_param: str = None):
    clinic = None
    if id_param:
        clinic = SAMPLE_CLINICS.get(id_param)
    if not clinic and name_param:
        for item in SAMPLE_CLINICS.values():
            if item.get("name") == name_param:
                clinic = item
                break
    return deepcopy(clinic) if clinic else None


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
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == '/api/listClinics':
            clinics = [clinic_summary(item) for item in SAMPLE_CLINICS.values()]
            self.send_json_response({"ok": True, "clinics": clinics})
        elif path == '/api/clinicDetail':
            id_param = (query.get('id') or [''])[0].strip()
            name_param = (query.get('name') or [''])[0].strip()
            clinic = find_clinic(id_param or None, name_param or None)
            if clinic:
                self.send_json_response({"ok": True, "clinic": clinic})
            else:
                self.send_json_response({"ok": False, "error": "clinic not found"}, 404)
        elif path == '/api/modes':
            self.send_json_response({"ok": True, "modes": SAMPLE_MODES})
        elif path == '/api/listCategories':
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
        elif path == '/api/listMaster':
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
        elif path == '/api/settings':
            self.send_json_response({
                "model": "gpt-4o-mini",
                "prompt": "テスト用プロンプト",
                "prompt_exam": "検査用プロンプト",
                "prompt_diagnosis": "診断用プロンプト"
            })
        elif path == '/api/todo/list':
            self.send_json_response({
                "ok": True,
                "updatedAt": int(time.time()),
                "todos": current_todos,
            })
        elif path.startswith('/api/export'):
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
