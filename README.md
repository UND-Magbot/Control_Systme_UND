# Control System UND
> 로봇 관제 시스템 — 다중 로봇 위치/상태 모니터링, 맵·경로·스케줄 관리, 영상 녹화, 사용자/공지 관리

Next.js Web UI + FastAPI 관제 서버 + ROS2 UDP 중계기로 구성된 다중 로봇 관제 시스템.

---

## 구성

| 컴포넌트 | 경로 | 스택 | 진입점 / 포트 |
|----------|------|------|----------------|
| Frontend (Web UI) | `Frontend/` | Next.js 15.5.7, React 18, TypeScript 5, Tailwind 4, Three.js | `app/` (App Router) · 3000(dev) / 3001(docker) |
| Backend (관제 서버) | `Backend/` | FastAPI, Python 3.10.9, SQLAlchemy + PyMySQL, OpenCV, FFmpeg | `app/main.py` · 8000 |
| robot_receiver (ROS2 중계) | `robot_receiver/` | ROS2 (rclpy), 표준 라이브러리 | `receiver.py` UDP 40000 · `relay_map.py` UDP 50000 · `relay_charge.py` UDP 50001 |
| Docker | `docker-compose.yml` | frontend(3001) + backend(host network, volumes: data/static/recordings) | — |

### 1. Frontend (`Frontend/`)
Next.js 15 App Router 기반 정적 사이트(`output: 'export'`).
주요 페이지: 대시보드 / 알림 / 데이터관리 / 맵관리 / 운영관리 / 스케줄관리 / 설정.
개발 모드에서는 `next.config`의 프록시로 `localhost:8000` Backend에 붙음.

### 2. Backend (`Backend/`)
FastAPI 관제 서버. 주요 모듈 — `auth`, `map`, `navigation`, `robot_control`, `robot_io`(UDP/ASDU), `recording`(FFmpeg), `alerts`, `notices`, `scheduler`, `statistics`, `backup`, `users`, `businesses`. DB는 MySQL/MariaDB.

### 3. robot_receiver (`robot_receiver/`)
로봇 PC(ROS2 환경)에서 실행되는 UDP 중계기.
- `receiver.py` — Backend에서 오는 명령을 UDP 40000으로 수신
- `relay_map.py` — ROS2 `/odom` + PointCloud2 → UDP 50000
- `relay_charge.py` — ROS2 `/CHARGE_STATUS` → UDP 50001

> `frontend_bak/`는 이전 버전 백업 폴더 (사용 안 함).

---

## 빌드 & 실행

### Docker (전체) — 권장
```bash
docker compose up -d --build
# frontend → http://localhost:3001
# backend  → http://localhost:8000  (host network)
```

### Frontend (개별)
```bash
cd Frontend
npm install
npm run dev        # 개발 서버 :3000
npm run build      # 정적 export
npm run start      # 프로덕션
```

### Backend (개별)
```bash
cd Backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### robot_receiver (로봇 PC, ROS2 환경)
```bash
# ROS2 환경 source 후 실행
python3 receiver.py        # 명령 수신 :40000
python3 relay_map.py       # 맵/odom 중계 → :50000
python3 relay_charge.py    # 충전 상태 중계 → :50001
```

---

## 환경변수 (`Backend/.env`)

> 실제 값은 레포에 포함되지 않음. `.env`는 `.gitignore` 처리됨.

| 키 | 용도 |
|----|------|
| `JWT_SECRET_KEY` | 인증 토큰 서명 키 |
| `CORS_ALLOWED_ORIGINS` | 허용 오리진 (localhost:3000, 3001 등) |
| `CORS_ALLOWED_ORIGIN_REGEX` | 사설망 IP 대역 (10.x, 192.168.x, 172.16-31.x) |

---

## 데이터 볼륨 (Docker)

| 경로 | 용도 |
|------|------|
| `Backend/data/` | DB 백업, 영구 데이터 |
| `Backend/static/` | 맵 이미지 등 정적 자원 |
| `Backend/recordings/` | 영상 녹화 산출물 (FFmpeg) |

---

## 트러블슈팅

| 증상 | 원인 | 조치 |
|------|------|------|
| `docker compose` 시 frontend ↔ backend 연결 안 됨 | backend가 host network 모드라 frontend 컨테이너에서 호스트 IP로 접근해야 함 | Frontend 빌드 시 API base URL을 호스트 IP로 지정 |
| 영상 녹화 시작 실패 | FFmpeg 미설치 / PATH 누락 | `Backend/ffmpeg_bin/` 사용 또는 시스템 PATH에 ffmpeg 추가 |
| Backend 기동 시 DB 연결 실패 | MySQL/MariaDB 미기동 또는 `.env` DB 설정 누락 | DB 서비스 확인, `Backend/.env` 채움 |
| robot_receiver 데이터 안 들어옴 | ROS2 토픽 미수신 또는 UDP 50000/50001 방화벽 차단 | `ros2 topic echo /odom` 확인, 해당 포트 개방 |

---

## 주요 설계 포인트

- **컴포넌트 분리** — 관제 PC (FE+BE) ↔ 로봇 PC (robot_receiver/ROS2) UDP 통신으로 ROS2 의존성을 로봇 PC에만 격리
- **Frontend Static Export** — `output: 'export'`로 정적 사이트 빌드 → CDN/Nginx 손쉽게 배포, dev 모드에서만 `next.config` 프록시 사용
- **Backend host network** — 로봇과 같은 사설망에서 직접 UDP 송수신해야 하므로 host network 모드
- **권한 정책** — 대시보드는 `dashboard` 권한 하나로만 통제 (내부 섹션 추가 필터 없음)
- **데이터 영속화** — `Backend/data/`, `Backend/recordings/`, `Backend/static/` 볼륨 마운트로 컨테이너 재시작 시에도 보존

---

## 라이선스
Private / UND-Magbot 내부 사용
