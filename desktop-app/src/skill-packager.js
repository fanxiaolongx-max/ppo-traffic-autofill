import zlib from 'node:zlib';

export function createZipArchive(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  const now = new Date();
  const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  for (const file of files) {
    const filenameBuf = Buffer.from(file.name, 'utf8');
    const uncompressed = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data || ''), 'utf8');
    const crc = zlib.crc32(uncompressed);
    const compressed = zlib.deflateRawSync(uncompressed);
    const mode = file.mode || 0o100644;

    // Local file header (30 bytes + name)
    const localHeader = Buffer.alloc(30 + filenameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // flags: UTF-8
    localHeader.writeUInt16LE(8, 8); // compression: Deflate
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(filenameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length
    filenameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compressed);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46 + filenameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // flags: UTF-8
    centralHeader.writeUInt16LE(8, 10); // compression: Deflate
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(filenameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE((mode << 16) >>> 0, 38); // external file attributes
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header
    filenameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(files.length, 8); // entries on this disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12); // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

export function renderSkillMd({ baseUrl = 'http://127.0.0.1:17654', apiKey = '' } = {}) {
  const safeBaseUrl = baseUrl.replace(/\/+$/, '');
  const safeKey = apiKey || 'YOUR_API_KEY';

  return `---
name: ppo-traffic
description: 查询埃及机动车交通违章（مخالفات رخص المركبات）。当用户需要查询埃及车牌违章记录、违章罚款金额（EGP）、和解金额、中国护照或埃及身份证名下车辆违章明细、或检测埃及公诉机关（PPO）服务状态时，使用此技能。
---

# 埃及车辆违章查询 Skill (PPO Traffic Violation)

此 Skill 通过与已部署的 PPO 查询中枢服务对接，自动化向埃及公诉机关（Public Prosecution Office）违章门户提交查询并解析结果。

## 服务配置信息
- **服务接口基地址 (Base URL)**: \`${safeBaseUrl}\`
- **身份认证方式**: HTTP Header \`X-API-Key: ${safeKey}\`
- **支持所有人证件**: 中国护照（Passport，签发国 10206）或 14 位埃及身份证（National ID）

## 何时触发
当用户的需求符合以下场景时触发：
- 查询指定埃及车牌是否有违章（例如："查一下车牌 أ ف س 3413 的违章"）
- 查询指定护照或身份证名下的车辆罚款（例如："护照 E12345678 的车有罚款吗？"）
- 查询具体违章总金额（إجمالي الغرامات）与违章笔数（عدد المخالفات）
- 检查当前 PPO 官方门户连通性与服务状态

## 推荐调用方式：CLI 脚本
本 Skill 的 \`scripts/ppo_cli.py\` 封装了完整的任务提交、排队轮询和结果解析逻辑，零第三方依赖。

### 1. 查询车辆违章（同步等待结果）
\`\`\`bash
python3 scripts/ppo_cli.py query \\
  --letters "أ ف س" \\
  --number 3413 \\
  --passport "E12345678" \\
  --wait
\`\`\`
参数说明：
- \`--letters\`: 2 到 3 个车牌阿拉伯字母，以空格分隔（可用字母：أ, ب, ج, د, ر, س, ص, ط, ع, ف, ق, ل, م, ن, ه, و, ي）。
- \`--number\`: 1 到 8 位纯数字车牌号。
- \`--passport\`: 车主中国护照号码（如 E12345678）。
- \`--national-id\`: 若为埃及公民，可传 14 位身份证号（与 \`--passport\` 二选一）。
- \`--wait\`: 自动排队轮询等待（通常耗时 10~25 秒），完成后输出结构化 JSON 结果。

### 2. 检查系统与官网状态
\`\`\`bash
python3 scripts/ppo_cli.py status
\`\`\`

### 3. 查看最近查询历史
\`\`\`bash
python3 scripts/ppo_cli.py history --limit 5
\`\`\`

## REST API 接口定义

如果你的 Agent 环境需要通过 HTTP 工具（如 curl / fetch）直接调用：

### 1. 提交违章查询任务
- **Endpoint**: \`POST ${safeBaseUrl}/api/v1/queries\`
- **Headers**:
  - \`Content-Type: application/json\`
  - \`X-API-Key: ${safeKey}\`
- **Body 格式**:
\`\`\`json
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
\`\`\`
- **响应示例 (202 Accepted)**:
\`\`\`json
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
\`\`\`

### 2. 获取任务结果与状态
- **Endpoint**: \`GET ${safeBaseUrl}/api/v1/queries/:id\`
- **Headers**: \`X-API-Key: ${safeKey}\`
- **响应示例 (200 OK，成功时)**:
\`\`\`json
{
  "id": "qu_c1a2...",
  "status": "success",
  "result": {
    "totalFine": "350 جنيه",
    "violationCount": "2",
    "reconcileFine": "175 جنيه"
  }
}
\`\`\`

## 结果状态与诊断提示
- \`totalFine\`: 总计违章罚金（含币种，如 "350 جنيه" 或 "0 جنيه" 表示无违章）。
- \`violationCount\`: 违章总笔数（如 "2" 或 "0"）。
- \`reconcileFine\`: 快速和解优惠罚金。
- 若状态为 \`failed\`，关注 \`error.code\`：
  - \`LICENSE_DATA_UPDATE_REQUIRED\`: 埃及官网提示该车辆近期没有登记数据，需车主前往所属交通检察机关更新。
  - \`IDENTITY_MISMATCH\`: 车牌与证件号码不匹配或未登记在此证件名下。
  - \`OFFICIAL_AUTH_ERROR\` / \`OFFICIAL_MAINTENANCE\`: 官网服务繁忙或会话异常，通常夜间开罗时间维护较多，可稍后重试。
`;
}

export function renderCliScript({ baseUrl = 'http://127.0.0.1:17654', apiKey = '' } = {}) {
  const safeBaseUrl = baseUrl.replace(/\/+$/, '');
  const safeKey = apiKey || '';

  return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PPO 埃及车辆违章查询 CLI 客户端
零外部依赖，使用 Python 3 标准库
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error

DEFAULT_BASE_URL = os.environ.get("PPO_BASE_URL", "${safeBaseUrl}")
DEFAULT_API_KEY = os.environ.get("PPO_API_KEY", "${safeKey}")


def make_request(url, method="GET", data=None, api_key=None):
    headers = {
        "User-Agent": "PPO-Agent-Skill-CLI/1.0",
        "Accept": "application/json"
    }
    if api_key:
        headers["X-API-Key"] = api_key
    body = None
    if data is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            res_body = response.read().decode("utf-8")
            return json.loads(res_body) if res_body else {}
    except urllib.error.HTTPError as err:
        err_body = err.read().decode("utf-8")
        try:
            parsed = json.loads(err_body)
            err_msg = parsed.get("error", {}).get("message", err_body)
        except Exception:
            err_msg = err_body
        raise RuntimeError(f"HTTP {err.code}: {err_msg}")
    except Exception as exc:
        raise RuntimeError(f"网络请求失败: {exc}")


def normalize_letters(letters_input):
    if not letters_input:
        return []
    raw = letters_input.replace(",", " ").split()
    return [c.replace("\u0640", "").strip() for c in raw if c.strip()]


def cmd_query(args):
    base_url = args.base_url.rstrip("/")
    api_key = args.api_key
    letters = normalize_letters(args.letters)
    if len(letters) < 2 or len(letters) > 3:
        print(f"错误: 车牌阿拉伯字母必须为 2~3 个，当前为: {letters}", file=sys.stderr)
        sys.exit(2)

    owner_type = "national_id" if args.national_id else "passport"
    doc_number = (args.national_id or args.passport or "").strip()
    if not doc_number:
        print("错误: 必须提供 --passport 或 --national-id", file=sys.stderr)
        sys.exit(2)

    payload = {
        "plate": {
            "letters": letters,
            "number": str(args.number).strip()
        },
        "owner": {
            "type": owner_type,
            "documentNumber": doc_number,
            "country": args.country,
            "foreignType": "citizen" if owner_type == "national_id" else "foreign"
        }
    }

    submit_url = f"{base_url}/api/v1/queries"
    res = make_request(submit_url, method="POST", data=payload, api_key=api_key)
    query_id = res.get("query", {}).get("id")
    if not query_id:
        print("错误: 未返回任务 ID", file=sys.stderr)
        print(json.dumps(res, ensure_ascii=False, indent=2))
        sys.exit(1)

    if not args.wait:
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return

    # 轮询等待
    status_url = f"{base_url}/api/v1/queries/{query_id}"
    start_time = time.time()
    last_step = ""

    while time.time() - start_time < args.timeout:
        detail = make_request(status_url, method="GET", api_key=api_key)
        status = detail.get("status")
        step = detail.get("step")
        progress = detail.get("progress", 0)

        if step != last_step and not args.quiet:
            sys.stderr.write(f"\\r[PPO] 进度: {progress}% - {step}...\\033[K")
            sys.stderr.flush()
            last_step = step

        if status in ("success", "failed", "cancelled", "interrupted"):
            if not args.quiet:
                sys.stderr.write("\\n")
            print(json.dumps(detail, ensure_ascii=False, indent=2))
            if status == "success":
                sys.exit(0)
            else:
                sys.exit(1)

        time.sleep(args.interval)

    print(f"\\n错误: 查询超时 ({args.timeout} 秒)", file=sys.stderr)
    sys.exit(1)


def cmd_status(args):
    base_url = args.base_url.rstrip("/")
    status_url = f"{base_url}/api/v1/status"
    res = make_request(status_url, method="GET", api_key=args.api_key)
    print(json.dumps(res, ensure_ascii=False, indent=2))


def cmd_history(args):
    base_url = args.base_url.rstrip("/")
    history_url = f"{base_url}/api/v1/history?limit={args.limit}"
    res = make_request(history_url, method="GET", api_key=args.api_key)
    print(json.dumps(res, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description="PPO 埃及车辆违章查询 CLI")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help=f"服务 Base URL (默认: {DEFAULT_BASE_URL})")
    parser.add_argument("--api-key", default=DEFAULT_API_KEY, help="API Key (默认从配置或环境变量读取)")

    subparsers = parser.add_subparsers(dest="command", required=True)

    # query
    p_query = subparsers.add_parser("query", help="提交违章查询")
    p_query.add_argument("--letters", required=True, help="车牌阿拉伯字母，空格分隔，如 'أ ف س'")
    p_query.add_argument("--number", required=True, help="车牌数字，如 3413")
    p_query.add_argument("--passport", help="中国护照号，如 E12345678")
    p_query.add_argument("--national-id", help="埃及 14 位身份证号")
    p_query.add_argument("--country", default="10206", help="护照国家编码 (默认 10206 中国)")
    p_query.add_argument("--wait", action="store_true", default=True, help="同步等待查询完成 (默认: True)")
    p_query.add_argument("--no-wait", dest="wait", action="store_false", help="仅提交进入队列，不等待结果")
    p_query.add_argument("--timeout", type=int, default=90, help="轮询超时时间(秒，默认: 90)")
    p_query.add_argument("--interval", type=float, default=2.5, help="轮询间隔(秒，默认: 2.5)")
    p_query.add_argument("--quiet", action="store_true", help="静默模式，不输出进度条")
    p_query.set_defaults(func=cmd_query)

    # status
    p_status = subparsers.add_parser("status", help="获取服务运行与官网健康状态")
    p_status.set_defaults(func=cmd_status)

    # history
    p_history = subparsers.add_parser("history", help="获取查询历史记录")
    p_history.add_argument("--limit", type=int, default=10, help="查询条数限制 (默认: 10)")
    p_history.set_defaults(func=cmd_history)

    args = parser.parse_args()
    try:
        args.func(args)
    except Exception as exc:
        print(f"执行出错: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
`;
}

export function renderReadme({ baseUrl = 'http://127.0.0.1:17654', apiKey = '' } = {}) {
  const safeBaseUrl = baseUrl.replace(/\/+$/, '');
  const safeKey = apiKey || 'YOUR_API_KEY';

  return `# 埃及车辆违章查询 Agent Skill (PPO Traffic)

这是一个为 AI Agent（Google Antigravity、Claude Code、Cursor 等）打包的离线安装技能扩展，方便在其他项目或助手环境中直接调用埃及车辆违章查询中枢服务。

## 预配置信息
- **服务基地址**: \`${safeBaseUrl}\`
- **预配 API KEY**: \`${safeKey}\`

## 目录结构
\`\`\`text
ppo-traffic/
├── SKILL.md            # Agent 指令定义与调用规范
├── README.md           # 安装与配置指南
└── scripts/
    └── ppo_cli.py      # 免第三方依赖的 Python 3 命令行客户端
\`\`\`

## 安装方法

### 方式一：安装至 Antigravity 项目工作区
将解压后的 \`ppo-traffic/\` 文件夹复制到你当前工作区的 skills 目录：
\`\`\`bash
mkdir -p .gemini/skills
cp -r ppo-traffic .gemini/skills/
\`\`\`

### 方式二：全局安装给 Antigravity（所有工作区通用）
\`\`\`bash
mkdir -p ~/.gemini/antigravity/skills
cp -r ppo-traffic ~/.gemini/antigravity/skills/
\`\`\`

### 方式三：安装至 Claude Code 项目工作区
\`\`\`bash
mkdir -p .claude/skills
cp -r ppo-traffic .claude/skills/
\`\`\`

### 方式四：在终端直接使用 Python CLI
无需安装任何三方依赖，直接运行：
\`\`\`bash
# 提交并等待结果
python3 scripts/ppo_cli.py query --letters "أ ف س" --number 3413 --passport "E12345678" --wait

# 检查系统与 PPO 官网健康度
python3 scripts/ppo_cli.py status

# 查看历史查询
python3 scripts/ppo_cli.py history --limit 5
\`\`\`
`;
}

export function createSkillPackage({ baseUrl = 'http://127.0.0.1:17654', apiKey = '' } = {}) {
  const skillMd = renderSkillMd({ baseUrl, apiKey });
  const cliPy = renderCliScript({ baseUrl, apiKey });
  const readme = renderReadme({ baseUrl, apiKey });

  return createZipArchive([
    { name: 'ppo-traffic/SKILL.md', data: skillMd },
    { name: 'ppo-traffic/scripts/ppo_cli.py', data: cliPy, mode: 0o100755 },
    { name: 'ppo-traffic/README.md', data: readme }
  ]);
}
