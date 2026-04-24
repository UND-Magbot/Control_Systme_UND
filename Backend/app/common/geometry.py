"""2D 기하 유틸 — 위험지역(폴리곤) 교차 검사용.

점 / 폴리곤 / 선분은 모두 world 좌표(m)로 처리한다.
폴리곤은 `[(x, y), ...]` 형식의 꼭짓점 리스트이며 닫힘 여부는 무관하다
(내부적으로 마지막→처음 엣지를 자동 생성).
"""

from typing import Sequence, Tuple

Point = Tuple[float, float]


def point_in_polygon(p: Point, polygon: Sequence[Point]) -> bool:
    """Ray-casting 알고리즘. 경계 위의 점은 True로 간주한다."""
    if len(polygon) < 3:
        return False
    x, y = p
    inside = False
    n = len(polygon)
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        # 수평 반직선과의 교차 검사
        if (yi > y) != (yj > y):
            x_intersect = (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi
            if x <= x_intersect:
                inside = not inside
        j = i
    return inside


def _orient(a: Point, b: Point, c: Point) -> float:
    """2D 외적 부호: >0 반시계, <0 시계, 0 공선."""
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_segment(a: Point, b: Point, c: Point) -> bool:
    """공선일 때 c가 선분 ab 위에 있는지."""
    return (
        min(a[0], b[0]) - 1e-9 <= c[0] <= max(a[0], b[0]) + 1e-9
        and min(a[1], b[1]) - 1e-9 <= c[1] <= max(a[1], b[1]) + 1e-9
    )


def segments_intersect(a: Point, b: Point, c: Point, d: Point) -> bool:
    """선분 ab 와 cd 가 교차(경계 포함)하는지."""
    o1 = _orient(a, b, c)
    o2 = _orient(a, b, d)
    o3 = _orient(c, d, a)
    o4 = _orient(c, d, b)

    if (o1 > 0 and o2 < 0 or o1 < 0 and o2 > 0) and (o3 > 0 and o4 < 0 or o3 < 0 and o4 > 0):
        return True

    # 공선 & 선분 위에 걸침
    if o1 == 0 and _on_segment(a, b, c):
        return True
    if o2 == 0 and _on_segment(a, b, d):
        return True
    if o3 == 0 and _on_segment(c, d, a):
        return True
    if o4 == 0 and _on_segment(c, d, b):
        return True

    return False


def segment_intersects_polygon(p1: Point, p2: Point, polygon: Sequence[Point]) -> bool:
    """선분 p1→p2 가 폴리곤(변 또는 내부)과 겹치는지."""
    if len(polygon) < 3:
        return False
    if point_in_polygon(p1, polygon) or point_in_polygon(p2, polygon):
        return True
    n = len(polygon)
    for i in range(n):
        a = polygon[i]
        b = polygon[(i + 1) % n]
        if segments_intersect(p1, p2, a, b):
            return True
    return False
