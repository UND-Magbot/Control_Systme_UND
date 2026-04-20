"use client";

import React from "react";

type Props = {
  isOpen: boolean;
  pathBuildName: string;
  setPathBuildName: (v: string) => void;
  pathBuildWorkType: string;
  setPathBuildWorkType: (v: string) => void;
  pathBuildOrder: string[];
  setPathBuildOrder: React.Dispatch<React.SetStateAction<string[]>>;
  placeCoordMap: Map<string, { x: number; y: number }>;
  onCancel: () => void;
  onSave: () => void;
};

/**
 * 경로 생성 플로팅 패널 — map 탭 오른쪽에 고정 표시.
 * 경로명/작업유형 입력 + 선택된 장소 순서 리스트 + 저장/취소.
 */
export default function PathBuildPanel({
  isOpen,
  pathBuildName,
  setPathBuildName,
  pathBuildWorkType,
  setPathBuildWorkType,
  pathBuildOrder,
  setPathBuildOrder,
  placeCoordMap,
  onCancel,
  onSave,
}: Props) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 15,
        width: 280,
        background: "var(--surface-3)",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.3)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          padding: "14px 16px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "var(--font-size-lg)",
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          경로 생성
        </span>
        <button
          onClick={onCancel}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* 폼 */}
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          flexShrink: 0,
        }}
      >
        {/* 경로명 */}
        <div>
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--text-tertiary)",
              marginBottom: 3,
              fontWeight: 600,
            }}
          >
            경로명
          </div>
          <input
            value={pathBuildName}
            onChange={(e) => setPathBuildName(e.target.value)}
            maxLength={20}
            placeholder="경로명을 입력하세요"
            style={{
              width: "100%",
              height: 32,
              borderRadius: 6,
              border: "1px solid var(--border-input)",
              background: "var(--surface-input)",
              color: "var(--text-primary)",
              padding: "0 10px",
              fontSize: "var(--font-size-sm)",
            }}
          />
        </div>
        {/* 작업유형 */}
        <div>
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--text-tertiary)",
              marginBottom: 3,
              fontWeight: 600,
            }}
          >
            작업유형
          </div>
          <select
            value={pathBuildWorkType}
            onChange={(e) => setPathBuildWorkType(e.target.value)}
            style={{
              width: "100%",
              height: 32,
              borderRadius: 6,
              border: "1px solid var(--border-input)",
              background: "var(--surface-input)",
              color: "var(--text-primary)",
              padding: "0 8px",
              fontSize: "var(--font-size-sm)",
            }}
          >
            <option value="task1">task1</option>
            <option value="task2">task2</option>
            <option value="task3">task3</option>
          </select>
        </div>
      </div>

      {/* 경로 순서 */}
      <div
        style={{
          padding: "0 16px",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--text-tertiary)",
            marginBottom: 6,
            fontWeight: 600,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>경로 순서</span>
          <span style={{ color: "var(--color-info)", fontWeight: 700 }}>
            {pathBuildOrder.length}개
          </span>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            background: "var(--surface-4)",
            borderRadius: 8,
            border: "1px solid var(--border-input)",
            padding: pathBuildOrder.length > 0 ? 8 : "20px 8px",
            minHeight: 80,
          }}
        >
          {pathBuildOrder.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: "var(--font-size-sm)",
              }}
            >
              맵에서 장소를 클릭하세요
            </div>
          ) : (
            pathBuildOrder.map((name, i) => (
              <div
                key={`${name}_${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: "var(--surface-5)",
                  fontSize: "var(--font-size-sm)",
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "#FF6B35",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>
                <span
                  style={{
                    flex: 1,
                    color: "var(--text-primary)",
                    fontWeight: 500,
                  }}
                >
                  {name}
                </span>
                {i > 0 && i < pathBuildOrder.length && (
                  <span
                    style={{
                      fontSize: "var(--font-size-2xs)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {(() => {
                      const prev = placeCoordMap.get(pathBuildOrder[i - 1]);
                      const cur = placeCoordMap.get(name);
                      if (!prev || !cur) return "";
                      const d = Math.sqrt(
                        (cur.x - prev.x) ** 2 + (cur.y - prev.y) ** 2
                      );
                      return `${d.toFixed(1)}m`;
                    })()}
                  </span>
                )}
                <button
                  onClick={() =>
                    setPathBuildOrder((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 16,
                    padding: 0,
                    lineHeight: 1,
                  }}
                  title="제거"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 하단 버튼 */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            height: 34,
            borderRadius: 8,
            border: "1px solid var(--border-input)",
            background: "var(--surface-5)",
            color: "var(--text-primary)",
            fontSize: "var(--font-size-md)",
            cursor: "pointer",
          }}
        >
          취소
        </button>
        <button
          onClick={onSave}
          disabled={pathBuildOrder.length < 2 || !pathBuildName.trim()}
          style={{
            flex: 1,
            height: 34,
            borderRadius: 8,
            border: "1px solid var(--color-info-border)",
            background: "var(--color-info-bg)",
            color: "var(--text-primary)",
            fontSize: "var(--font-size-md)",
            cursor: "pointer",
            opacity:
              pathBuildOrder.length < 2 || !pathBuildName.trim() ? 0.5 : 1,
          }}
        >
          저장
        </button>
      </div>
    </div>
  );
}
