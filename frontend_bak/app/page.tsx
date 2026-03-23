"use client";

import { useEffect, useState } from "react";
import axios from "axios";

const API = process.env.NEXT_PUBLIC_API_URL;

export default function Dashboard() {
  const [robots, setRobots] = useState<any>({});
  const [selected, setSelected] = useState<string>("");
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [theta, setTheta] = useState("");
  const [logs, setLogs] = useState<string[]>([]);

  // 로봇 목록 가져오기
  const loadRobots = async () => {
    try {
      const { data } = await axios.get(`${API}/robots`);
      setRobots(data);
    } catch (e) {
      console.error(e);
    }
  };

  // WebSocket 연결
  useEffect(() => {
    loadRobots();
    const ws = new WebSocket(`${API?.replace("http", "ws")}/ws`);
    ws.onmessage = (e) => setLogs((prev) => [e.data, ...prev]);
    ws.onopen = () => setLogs((prev) => ["[연결됨]", ...prev]);
    ws.onclose = () => setLogs((prev) => ["[연결 종료]", ...prev]);
    return () => ws.close();
  }, []);

  const sendMove = async () => {
    if (!selected) return alert("로봇을 선택하세요!");
    await axios.post(`${API}/robots/${selected}/move`, {
      x: parseFloat(x),
      y: parseFloat(y),
      theta: parseFloat(theta),
    });
    setLogs((prev) => [`명령 전송: ${selected}`, ...prev]);
  };

  return (
    <main style={{ padding: 20 }}>
      <h1>🚗 로봇 관제 대시보드</h1>
      <div style={{ display: "flex", gap: 20 }}>
        {/* 좌측 로봇 목록 */}
        <div>
          <h3>로봇 목록</h3>
          {Object.entries(robots).map(([id, r]: any) => (
            <div
              key={id}
              style={{
                padding: 8,
                cursor: "pointer",
                background: selected === id ? "#e0e0ff" : "#f9f9f9",
                marginBottom: 4,
              }}
              onClick={() => setSelected(id)}
            >
              <b>{id}</b> — 배터리 {r.battery}% ({r.status})
            </div>
          ))}
        </div>

        {/* 제어 영역 */}
        <div style={{ flex: 1 }}>
          <h3>명령 전송</h3>
          <div>
            <input
              placeholder="x"
              value={x}
              onChange={(e) => setX(e.target.value)}
            />
            <input
              placeholder="y"
              value={y}
              onChange={(e) => setY(e.target.value)}
            />
            <input
              placeholder="theta"
              value={theta}
              onChange={(e) => setTheta(e.target.value)}
            />
            <button onClick={sendMove}>전송</button>
          </div>

          <h3>로그</h3>
          <div
            style={{
              border: "1px solid #ccc",
              height: 200,
              overflowY: "scroll",
              padding: 5,
            }}
          >
            {logs.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
