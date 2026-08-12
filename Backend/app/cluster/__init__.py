"""인스턴스 간 조율 — 관제 백엔드가 여러 대 떠 있어도 로봇 하나는 한 대만 조종한다.

설계: 06_Planning/IMPL-Robot-Ownership-Across-Instances.md

- db_lock   : MariaDB 네임드 락 (인스턴스 간 배타)
- instance  : 이 프로세스가 개발인지 운영인지 (DB 이름으로 판정)
- deps      : 토큰 없이 소유권만 검사하는 FastAPI 의존성
- routes    : 조회 API
"""
