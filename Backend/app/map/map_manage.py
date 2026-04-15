"""맵 관리 라우터 (집계자).

사업장/층/맵 CRUD는 각각 businesses.py / floors.py / maps.py에 분리되어 있다.
이 파일은 `/map` prefix로 그 세 sub-router를 묶어 main.py에서 include하는 단일
진입점 역할만 한다.
"""

from fastapi import APIRouter

from app.map.businesses import router as businesses_router
from app.map.floors import router as floors_router
from app.map.maps import router as maps_router

map_manage = APIRouter(prefix="/map")
map_manage.include_router(businesses_router)
map_manage.include_router(floors_router)
map_manage.include_router(maps_router)
