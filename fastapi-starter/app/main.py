from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

app = FastAPI(title="Control API", version="0.1.0")

@app.get("/")
def root():
    return {"msg": "FastAPI 서버가 정상적으로 실행 중입니다!"}

# (임시 DB 대용)
ROBOTS = {
    "robot1": {"battery": 96, "status": "IDLE"},
    "robot2": {"battery": 82, "status": "MOVING"},
}

class MoveCmd(BaseModel):
    x: float
    y: float
    theta: float = 0.0

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/robots")
def list_robots():
    return ROBOTS

@app.get("/robots/{rid}")
def get_robot(rid: str):
    return ROBOTS.get(rid, {"error": "not found"})

@app.post("/robots/{rid}/move")
def move_robot(rid: str, cmd: MoveCmd):
    # 실제론 ROS/MQTT로 전달하는 자리
    print(f"[CMD] {rid} -> ({cmd.x},{cmd.y},{cmd.theta})")
    return {"ok": True, "sent_to": rid, "cmd": cmd.model_dump()}

# ---- WebSocket (실시간 방송용) ----
CLIENTS: set[WebSocket] = set()

@app.websocket("/ws")
async def ws(ws: WebSocket):
    await ws.accept()
    CLIENTS.add(ws)
    try:
        while True:
            msg = await ws.receive_text()
            # echo or 브로드캐스트
            for c in list(CLIENTS):
                await c.send_text(f"echo: {msg}")
    except WebSocketDisconnect:
        pass
    finally:
        CLIENTS.discard(ws)
