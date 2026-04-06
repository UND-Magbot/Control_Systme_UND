from pydantic import BaseModel


class RobotTypeCount(BaseModel):
    type: str
    count: int


class TaskCounts(BaseModel):
    completed: int = 0
    failed: int = 0
    cancelled: int = 0


class TimeMinutes(BaseModel):
    operating: int = 0
    charging: int = 0
    standby: int = 0


class ErrorCounts(BaseModel):
    network: int = 0
    navigation: int = 0
    battery: int = 0
    etc: int = 0


class PerRobotStats(BaseModel):
    robot_id: int
    robot_name: str
    robot_type: str
    tasks_completed: int = 0
    tasks_total: int = 0
    errors_total: int = 0
    operating_minutes: int = 0
    charging_minutes: int = 0
    standby_minutes: int = 0


class StatisticsResponse(BaseModel):
    robot_types: list[RobotTypeCount]
    tasks: TaskCounts
    time_minutes: TimeMinutes
    errors: ErrorCounts
    per_robot: list[PerRobotStats]
