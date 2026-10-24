#!/usr/bin/env python3
"""把 /tmp/vr.md (verify 报告) 回写到 GitHub, 供本地取证读取。

为什么需要这个脚本:
  本机代理拦截了 GitHub Actions 的 blob 存储, 日志/产物一律下载不到。
  唯一可读通道是 api.github.com, 所以构建机必须主动把报告"推"出来。

两个独立通道, 任一成功即可:
  1. 写仓库文件 verify_reports/last_run.md (Contents API)
  2. 回写 commit comment

注意: 无论如何都不能让本脚本抛异常导致 verify 步骤提前中断 ——
verify 的真实退出码由 workflow 用 $RC 决定, 这里只负责"把结果送出去"。
"""
import base64
import json
import os
import subprocess
import sys

VR = "/tmp/vr.md"
PATH = "verify_reports/last_run.md"


def gh(args, payload=None):
    """调 gh api; text=True 时 input 必须是 str。"""
    try:
        return subprocess.run(
            ["gh", "api"] + args,
            input=(json.dumps(payload) if payload is not None else None),
            capture_output=True, text=True, timeout=120,
        )
    except Exception as e:  # 绝不抛出, 否则会打断 verify 步骤
        print("gh_exc:", e)
        return None


def main():
    if not os.path.isfile(VR):
        print("no", VR)
        return
    body = open(VR, encoding="utf-8").read()
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    ref = os.environ.get("GITHUB_REF_NAME") or "openwrt-25.12"
    sha = os.environ.get("GITHUB_SHA", "")
    rid = os.environ.get("GITHUB_RUN_ID", "")
    if not repo:
        print("no GITHUB_REPOSITORY")
        return

    # ---- 通道 1: 仓库文件 ----
    exist = None
    g = gh([f"repos/{repo}/contents/{PATH}?ref={ref}"])
    if g is not None and g.returncode == 0:
        try:
            exist = json.loads(g.stdout).get("sha")
        except Exception:
            exist = None
    payload = {
        "message": f"verify report run {rid}",
        "content": base64.b64encode(body.encode()).decode(),
        "branch": ref,
    }
    if exist:
        payload["sha"] = exist
    p = gh(["-X", "PUT", f"repos/{repo}/contents/{PATH}"], payload)
    if p is None:
        print("PUT: gh 调用异常")
    else:
        print("PUT_rc=", p.returncode, (p.stdout or "")[:150], (p.stderr or "")[:250])

    # ---- 通道 2: commit comment ----
    if sha:
        c = gh(["-X", "POST", f"repos/{repo}/commits/{sha}/comments"], {"body": body})
        if c is None:
            print("COMMENT: gh 调用异常")
        else:
            print("COMMENT_rc=", c.returncode, (c.stdout or "")[:150], (c.stderr or "")[:250])

    # ---- 把发送结果本身也留在报告里, 便于本地判断通道是否真的通了 ----
    try:
        with open(VR, "a", encoding="utf-8") as f:
            f.write("\n[post_report] PUT_rc=%s COMMENT_rc=%s\n" % (
                getattr(p, "returncode", "?"), getattr(c, "returncode", "?") if sha else "n/a"))
    except Exception:
        pass


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # 兜底: 任何异常都不影响 verify 的退出码语义
        print("post_report 异常:", e)
        sys.exit(0)
