#!/usr/bin/env python3
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

DEFAULT_BASE_URL = os.environ.get("PPO_BASE_URL", "http://127.0.0.1:17654")
DEFAULT_API_KEY = os.environ.get("PPO_API_KEY", "")


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
    return [c.replace("ـ", "").strip() for c in raw if c.strip()]


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
            sys.stderr.write(f"\r[PPO] 进度: {progress}% - {step}...\033[K")
            sys.stderr.flush()
            last_step = step

        if status in ("success", "failed", "cancelled", "interrupted"):
            if not args.quiet:
                sys.stderr.write("\n")
            print(json.dumps(detail, ensure_ascii=False, indent=2))
            if status == "success":
                sys.exit(0)
            else:
                sys.exit(1)

        time.sleep(args.interval)

    print(f"\n错误: 查询超时 ({args.timeout} 秒)", file=sys.stderr)
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
