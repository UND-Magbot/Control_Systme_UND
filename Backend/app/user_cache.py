# 현재 로그인 사용자 캐시 (향후 인증 연동 시 교체)
cached_user = {"id": None, "UserName": None}

# 현재 연결된 로봇 캐시
cached_robot = {"id": None, "RobotName": None, "BusinessId": None}


def get_robot_id():
    return cached_robot["id"]


def get_robot_name():
    return cached_robot["RobotName"]


def get_robot_business_id():
    return cached_robot["BusinessId"]
