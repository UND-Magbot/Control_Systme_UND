"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

export type TestCoord = { x: number; y: number; label?: string };

type DebugMapContextValue = {
  debugEnabled: boolean;
  toggleDebug: () => void;
  testCoordinates: TestCoord[];
  addCoordinate: (coord: TestCoord) => void;
  removeCoordinate: (index: number) => void;
  clearCoordinates: () => void;
};

const DEFAULT_COORDS: TestCoord[] = [
  { x: 0, y: 0, label: "Origin(0,0)" },
  { x: 5, y: 5, label: "(5,5)" },
  { x: -10, y: -10, label: "(-10,-10)" },
];

const DebugMapContext = createContext<DebugMapContextValue>({
  debugEnabled: false,
  toggleDebug: () => {},
  testCoordinates: [],
  addCoordinate: () => {},
  removeCoordinate: () => {},
  clearCoordinates: () => {},
});

export function useDebugMap() {
  return useContext(DebugMapContext);
}

export function DebugMapProvider({ children }: { children: ReactNode }) {
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [testCoordinates, setTestCoordinates] =
    useState<TestCoord[]>(DEFAULT_COORDS);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mapDebug") === "true") {
      setDebugEnabled(true);
    } else if (localStorage.getItem("mapDebug") === "true") {
      setDebugEnabled(true);
    }
  }, []);

  const toggleDebug = useCallback(() => {
    setDebugEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("mapDebug", String(next));
      return next;
    });
  }, []);

  const addCoordinate = useCallback((coord: TestCoord) => {
    setTestCoordinates((prev) => [...prev, coord]);
  }, []);

  const removeCoordinate = useCallback((index: number) => {
    setTestCoordinates((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearCoordinates = useCallback(() => {
    setTestCoordinates([]);
  }, []);

  return (
    <DebugMapContext.Provider
      value={{
        debugEnabled,
        toggleDebug,
        testCoordinates,
        addCoordinate,
        removeCoordinate,
        clearCoordinates,
      }}
    >
      {children}
    </DebugMapContext.Provider>
  );
}
