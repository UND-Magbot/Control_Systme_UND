"""위치 재조정(스캔 정합) — rviz식 2D Pose Estimate 를 관제 화면 안에서 수행.

동작:
  - 스트림: 로봇 relay_map 을 띄우고, 측위 모드 정합 스캔 /LIO_ALIGNED_POINTS 를 receiver 의
    LIO_ALIGNED 액션으로 폴링해 WebSocket 으로 프론트에 중계.
  - 프론트는 정합 스캔을 저장맵 위에 겹쳐 보여주고(스캔이 벽과 어긋나면 측위 오차), 운영자가
    맵에서 pose 를 드래그로 지정하면 POST /robot/initpose {x,y,yaw} 로 주입한다.
    (수렴 검증·미확정 해제는 그 엔드포인트의 verify_and_clear 가 담당.)
  - 로봇 pose(화살표)는 프론트가 POSITION(ASDU) 로 폴링한다(측위 모드에서 동작).

측위 스택은 LIO 기반이라 매핑 토픽 /SLAM_* 은 측위 중 침묵하고 /LIO_* 가 나온다.
그래서 스캔 소스로 /LIO_ALIGNED_POINTS(map 프레임 정합 점군)를 쓴다. relay_map 은
stream/start 가 미실행 시 SSH 로 기동한다(매핑과 동일 스크립트, /LIO_ALIGNED_POINTS 구독 추가됨).
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

# 정합 스캔·pose 폴링 주기(초). 로봇 부하를 감안해 0.5s(매핑 실시간 뷰와 동일).
_POLL_SEC = 0.5


@router.post("/robot/relocalize/stream/start")
def relocalize_stream_start():
    """스캔 스트림 준비 — 로봇 relay_map(LIO/SLAM 브리지)을 미실행 시 SSH 로 기동한다.

    기동 후 pgrep 로 실제 실행을 확인하고, 실패 시 로봇 로그 tail 을 함께 반환해 진단을 돕는다.
    (start_relay_map 는 실패를 삼키므로, 여기서 실행 여부를 직접 검증한다.)
    """
    import time as _t
    from app.map.mapping_control import get_ssh_client, start_relay_map, ssh_exec, NOS_RELAY_LOG
    client = None
    try:
        client = get_ssh_client(retries=2)
        start_relay_map(client)   # 내부에서 이미 실행 중이면 생략(idempotent)
        _t.sleep(1.2)             # 기동/구독 시작 시간 확보
        running = ssh_exec(
            client,
            "sudo bash -c 'pgrep -f \"relay_[m]ap.py\" >/dev/null && echo RUNNING || echo STOPPED'",
            exec_timeout=10,
        )
        if "RUNNING" in running:
            return {"status": "ok", "msg": "스캔 스트림 준비 완료(relay 실행 중)."}
        # 기동 실패 — 로봇 로그 tail 로 사유를 되돌려준다.
        log_tail = ssh_exec(client, f"sudo tail -n 6 {NOS_RELAY_LOG} 2>/dev/null", exec_timeout=10)
        return {
            "status": "error",
            "msg": f"relay_map 기동 실패. 로봇 로그: {log_tail[:400] or '(로그 없음)'}",
        }
    except Exception as e:
        return {"status": "error", "msg": f"스캔 스트림 준비 실패(SSH/relay): {e}"}
    finally:
        if client:
            try:
                client.close()
            except Exception:
                pass


@router.post("/robot/relocalize/stream/stop")
def relocalize_stream_stop():
    """스캔 스트림 종료 — 매핑 진행 중이 아니면 relay_map 을 정리한다(매핑 중이면 유지)."""
    from app.map.mapping_control import get_ssh_client, stop_relay_map, mapping_state
    if mapping_state.get("is_running"):
        return {"status": "ok", "msg": "매핑 진행 중 — relay 유지"}
    client = None
    try:
        client = get_ssh_client(retries=2)
        stop_relay_map(client)
        return {"status": "ok", "msg": "스캔 스트림을 종료했습니다."}
    except Exception as e:
        return {"status": "error", "msg": f"스캔 스트림 종료 실패: {e}"}
    finally:
        if client:
            try:
                client.close()
            except Exception:
                pass


@router.websocket("/ws/relocalize/view")
async def relocalize_ws(ws: WebSocket):
    """정합 스캔(/SLAM_ALIGNED_POINTS)·로봇 pose(/SLAM_ODOM)를 폴링해 프론트로 중계.

    매핑 뷰(ws_mapping)의 request_mapping_data 를 재사용한다. 블로킹 UDP 는 executor 로 돌려
    이벤트 루프를 막지 않는다. 뷰어 1명 기준(위치 재조정은 단일 조작)이라 브로드캐스트 불필요.
    """
    from app.map.ws_mapping import request_mapping_data
    await ws.accept()
    loop = asyncio.get_running_loop()
    try:
        while True:
            # 측위 스캔 = LOC_BODY(/LOC_BODY_POINTS, body 프레임, 측위 중 ~10Hz 상시).
            # LIO_ALIGNED(/LIO_ALIGNED_POINTS)는 측위 중 조용해서 안 쓴다. 프론트가 이 body
            # 스캔을 로봇 pose(POSITION, ASDU)로 map 프레임 변환해 오버레이한다(rviz+TF 방식).
            body = await loop.run_in_executor(None, request_mapping_data, "LOC_BODY")
            if body:
                await ws.send_text(body)
            await asyncio.sleep(_POLL_SEC)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[RELOCALIZE-WS] {e}")
