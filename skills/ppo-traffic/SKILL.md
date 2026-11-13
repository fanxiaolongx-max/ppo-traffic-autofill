---
name: ppo-traffic
description: 查询埃及机动车交通违章（مخالفات رخص المركبات）。当用户需要查询埃及车牌违章记录、违章罚款金额（EGP）、和解金额、中国护照或埃及身份证名下车辆违章明细、或检测埃及公诉机关（PPO）服务状态时，使用此技能。
---

# 埃及车辆违章查询 Skill (PPO Traffic Violation)

此 Skill 通过与已部署的 PPO 查询中枢服务对接，自动化向埃及公诉机关（Public Prosecution Office）违章门户提交查询并解析结果。

## 服务配置信息
- **服务接口基地址 (Base URL)**: `http://127.0.0.1:17654`
- **身份认证方式**: HTTP Header `X-API-Key: YOUR_API_KEY`
- **支持所有人证件**: 中国护照（Passport，签发国 10206）或 14 位埃及身份证（National ID）

## 何时触发
当用户的需求符合以下场景时触发：
- 查询指定埃及车牌是否有违章（例如："查一下车牌 أ ف س 3413 的违章"）
- 查询指定护照或身份证名下的车辆罚款（例如："护照 E12345678 的车有罚款吗？"）
- 查询具体违章总金额（إجمالي الغرامات）与违章笔数（عدد المخالفات）
- 检查当前 PPO 官方门户连通性与服务状态

## 推荐调用方式：CLI 脚本
本 Skill 的 `scripts/ppo_cli.py` 封装了完整的任务提交、排队轮询和结果解析逻辑，零第三方依赖。

### 1. 查询车辆违章（同步等待结果）
```bash
python3 scripts/ppo_cli.py query \
  --letters "أ ف س" \
  --number 3413 \
  --passport "E12345678" \
  --wait
```
参数说明：
- `--letters`: 2 到 3 个车牌阿拉伯字母，以空格分隔（可用字母：أ, ب, ج, د, ر, س, ص, ط, ع, ف, ق, ل, م, ن, ه, و, ي）。
- `--number`: 1 到 8 位纯数字车牌号。
- `--passport`: 车主中国护照号码（如 E12345678）。
- `--national-id`: 若为埃及公民，可传 14 位身份证号（与 `--passport` 二选一）。
- `--wait`: 自动排队轮询等待（通常耗时 10~25 秒），完成后输出结构化 JSON 结果。

### 2. 检查系统与官网状态
```bash
python3 scripts/ppo_cli.py status
```

### 3. 查看最近查询历史
```bash
python3 scripts/ppo_cli.py history --limit 5
```

## REST API 接口定义

如果你的 Agent 环境需要通过 HTTP 工具（如 curl / fetch）直接调用：

### 1. 提交违章查询任务
- **Endpoint**: `POST http://127.0.0.1:17654/api/v1/queries`
- **Headers**:
  - `Content-Type: application/json`
  - `X-API-Key: YOUR_API_KEY`
- **Body 格式**:
```json
{
  "plate": {
    "letters": ["أ", "ف", "س"],
    "number": "3413"
  },
  "owner": {
    "type": "passport",
    "documentNumber": "E12345678",
    "country": "10206"
  }
}
```
- **响应示例 (202 Accepted)**:
```json
{
  "reused": false,
  "query": {
    "id": "qu_c1a2...",
    "traceId": "tr_9f3b...",
    "status": "queued",
    "step": "queued",
    "progress": 0
  }
}
```

### 2. 获取任务结果与状态
- **Endpoint**: `GET http://127.0.0.1:17654/api/v1/queries/:id`
- **Headers**: `X-API-Key: YOUR_API_KEY`
- **响应示例 (200 OK，成功时)**:
```json
{
  "id": "qu_c1a2...",
  "status": "success",
  "result": {
    "totalFine": "350 جنيه",
    "violationCount": "2",
    "reconcileFine": "175 جنيه"
  }
}
```

## 结果状态与诊断提示
- `totalFine`: 总计违章罚金（含币种，如 "350 جنيه" 或 "0 جنيه" 表示无违章）。
- `violationCount`: 违章总笔数（如 "2" 或 "0"）。
- `reconcileFine`: 快速和解优惠罚金。
- 若状态为 `failed`，关注 `error.code`：
  - `LICENSE_DATA_UPDATE_REQUIRED`: 埃及官网提示该车辆近期没有登记数据，需车主前往所属交通检察机关更新。
  - `IDENTITY_MISMATCH`: 车牌与证件号码不匹配或未登记在此证件名下。
  - `OFFICIAL_AUTH_ERROR` / `OFFICIAL_MAINTENANCE`: 官网服务繁忙或会话异常，通常夜间开罗时间维护较多，可稍后重试。
