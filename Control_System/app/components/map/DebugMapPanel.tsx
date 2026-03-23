"use client";

import { useState } from "react";
import { useDebugMap } from "./DebugMapContext";

export default function DebugMapPanel() {
  const {
    debugEnabled,
    toggleDebug,
    testCoordinates,
    addCoordinate,
    removeCoordinate,
    clearCoordinates,
  } = useDebugMap();

  const [inputX, setInputX] = useState("");
  const [inputY, setInputY] = useState("");

  if (!debugEnabled) return null;

  const handleAdd = () => {
    const x = parseFloat(inputX);
    const y = parseFloat(inputY);
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    addCoordinate({ x, y, label: `(${x}, ${y})` });
    setInputX("");
    setInputY("");
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 10,
        right: 10,
        zIndex: 9999,
        background: "rgba(0,0,0,0.85)",
        color: "#fff",
        padding: 12,
        borderRadius: 8,
        fontSize: 12,
        width: 220,
        maxHeight: "50vh",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <strong>Map Debug</strong>
        <button
          onClick={toggleDebug}
          style={{
            background: "#555",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "2px 6px",
            cursor: "pointer",
            fontSize: 10,
          }}
        >
          Close
        </button>
      </div>

      {/* Coordinate input */}
      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        <input
          type="number"
          placeholder="X"
          value={inputX}
          onChange={(e) => setInputX(e.target.value)}
          style={{
            width: 60,
            padding: "2px 4px",
            fontSize: 11,
            background: "#333",
            color: "#fff",
            border: "1px solid #555",
            borderRadius: 3,
          }}
        />
        <input
          type="number"
          placeholder="Y"
          value={inputY}
          onChange={(e) => setInputY(e.target.value)}
          style={{
            width: 60,
            padding: "2px 4px",
            fontSize: 11,
            background: "#333",
            color: "#fff",
            border: "1px solid #555",
            borderRadius: 3,
          }}
        />
        <button
          onClick={handleAdd}
          style={{
            background: "#e53e3e",
            color: "#fff",
            border: "none",
            borderRadius: 3,
            padding: "2px 8px",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          Add
        </button>
      </div>

      {/* Coordinate list */}
      <div style={{ marginBottom: 6 }}>
        {testCoordinates.map((c, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "2px 0",
              borderBottom: "1px solid #444",
            }}
          >
            <span>
              {c.label || `(${c.x}, ${c.y})`}
            </span>
            <button
              onClick={() => removeCoordinate(i)}
              style={{
                background: "none",
                color: "#e53e3e",
                border: "none",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {testCoordinates.length > 0 && (
        <button
          onClick={clearCoordinates}
          style={{
            background: "#555",
            color: "#fff",
            border: "none",
            borderRadius: 3,
            padding: "2px 8px",
            cursor: "pointer",
            fontSize: 11,
            width: "100%",
          }}
        >
          Clear All
        </button>
      )}
    </div>
  );
}
