"""drDDS Steer 정규화 변환(m/s → [-1,1]) + 저속 상한 캡 검증. ROS2 무관."""
import elevator_align_node as node


def test_norm_identity_full_1():
    nx, ny, nyaw = node.to_steer_norm(0.5, -0.3, 0.2, 1.0, 1.0, 1.0, 1.0)
    assert abs(nx - 0.5) < 1e-9 and abs(ny + 0.3) < 1e-9 and abs(nyaw - 0.2) < 1e-9


def test_max_steer_cap():
    nx, ny, nyaw = node.to_steer_norm(0.9, -0.9, 0.9, 1.0, 1.0, 1.0, 0.08)
    assert abs(nx) <= 0.08 + 1e-9 and abs(ny) <= 0.08 + 1e-9 and abs(nyaw) <= 0.08 + 1e-9
    assert nx > 0 and ny < 0 and nyaw > 0     # 부호 보존


def test_full_scale_divides():
    nx, _, _ = node.to_steer_norm(0.5, 0.0, 0.0, 2.0, 1.0, 1.0, 1.0)
    assert abs(nx - 0.25) < 1e-9             # 0.5 m/s / 2.0 = 0.25


def test_zero_full_safe():
    nx, ny, nyaw = node.to_steer_norm(0.5, 0.5, 0.5, 0.0, 0.0, 0.0, 0.08)
    assert (nx, ny, nyaw) == (0.0, 0.0, 0.0)  # full=0 → 0 (0나눗셈 방어)
