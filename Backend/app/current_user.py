# 현재 로그인 사용자 캐시 (향후 인증 연동 시 교체)
cached_user = {"id": None, "UserName": None}

# 현재 연결된 로봇 캐시
cached_robot = {"id": None, "RobotName": None}


def get_user_id():
    """현재 사용자 id 반환 (캐시 미초기화 시 None)"""
    return cached_user["id"]


def get_user_name():
    """현재 사용자 이름 반환"""
    return cached_user["UserName"]


def get_robot_id():
    return cached_robot["id"]


def get_robot_name():
    return cached_robot["RobotName"]
