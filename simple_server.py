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
    "test-clinic-1": {
        "id": "test-clinic-1",
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
                "key": "clinic/test-clinic-1/logo-small.webp",
                "contentType": "image/webp",
                "width": 512,
                "height": 512,
                "fileSize": 40231,
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
            "selected": ["master:vaccination:小児定期接種|麻しん風しん混合"],
            "meta": {
                "master:vaccination:小児定期接種|麻しん風しん混合": {
                    "category": "小児定期接種",
                    "name": "麻しん風しん混合 (MR)",
                    "desc": "1歳・年長時に定期接種",
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
    "test-clinic-2": {
        "id": "test-clinic-2",
        "name": "サンプル医院",
        "postalCode": "1640012",
        "address": "東京都中野区本町2-2-2",
        "phone": "03-9876-5432",
        "fax": "",
        "doctors": {
            "fulltime": 1,
            "parttime": 2,
            "qualifications": "日本小児科学会 専門医",
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
        "departments": {"master": ["小児科"], "others": ["予防接種専門"]},
        "media": {},
        "access": {
            "nearestStation": ["東京メトロ中野坂上駅 徒歩8分"],
            "bus": [],
            "parking": {"available": False, "capacity": None, "notes": ""},
            "barrierFree": ["キッズスペースあり"],
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
        "vaccinations": {
            "selected": ["master:vaccination:任意接種|おたふくかぜ"],
            "meta": {
                "master:vaccination:任意接種|おたふくかぜ": {
                    "category": "任意接種",
                    "name": "おたふくかぜワクチン",
                    "desc": "任意接種 / 1歳以降",
                }
            },
        },
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


def clinic_summary(clinic):
    return {
        "id": clinic.get("id"),
        "name": clinic.get("name"),
        "address": clinic.get("address", ""),
        "postalCode": clinic.get("postalCode", ""),
        "updated_at": clinic.get("updated_at"),
        "created_at": clinic.get("created_at"),
        "schema_version": clinic.get("schema_version", 1),
    }


def find_clinic(id_param=None, name_param=None):
    clinic = None
    if id_param:
        clinic = SAMPLE_CLINICS.get(id_param)
    if not clinic and name_param:
        for item in SAMPLE_CLINICS.values():
            if item.get("name") == name_param:
                clinic = item
                break
    return deepcopy(clinic) if clinic else None


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
            clinics = [clinic_summary(data) for data in SAMPLE_CLINICS.values()]
            self.send_json({"ok": True, "clinics": clinics})
        elif path == '/api/clinicDetail':
            id_param = (query.get('id') or [''])[0].strip()
            name_param = (query.get('name') or [''])[0].strip()
            clinic = find_clinic(id_param or None, name_param or None)
            if clinic:
                self.send_json({"ok": True, "clinic": clinic})
            else:
                self.send_json({"ok": False, "error": "clinic not found"}, status=404)
        elif path == '/api/modes':
            self.send_json({"ok": True, "modes": SAMPLE_MODES})
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
