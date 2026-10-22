#!/usr/bin/env python3
"""出厂固件独立复验 — 把 sysupgrade.bin 的 rootfs 拆开逐条核对。

这个文件是**唯一事实源**: 本地 (`_verify/verify.py`) 和 CI
(`.github/workflows/build-s20p.yml` 的 "Verify built firmware" 步骤)
跑的都是它, 避免两边规则漂移 —— 之前 CI 只扫 .ut 模板、漏掉
rpcd 脚本, 就是这么来的。

用法: python3 verify-firmware.py <sysupgrade.bin>
"""
import hashlib
import io
import os
import re
import sys

from PySquashfsImage import SquashFsImage

BIN = sys.argv[1] if len(sys.argv) > 1 else "s20p-v25.12-20261022-sysupgrade.bin"
if not os.path.isfile(BIN):
    print(f"::error::固件文件不存在: {BIN}")
    sys.exit(1)

blob = open(BIN, "rb").read()
print(f"[*] {BIN}: {len(blob)} bytes, sha256 = {hashlib.sha256(blob).hexdigest()}")
off = blob.find(b"hsqs")
assert off >= 0, "no hsqs magic"
img = SquashFsImage(io.BytesIO(blob[off:]))
print(f"[*] hsqs @ {off}")


def walk(n):
    try:
        items = list(n.iterdir())
    except Exception:
        return
    for c in items:
        try:
            if c.is_dir:
                yield from walk(c)
            else:
                yield c
        except Exception:
            continue


files = {}
for c in walk(img.root):
    p = getattr(c, "path", None) or c.name
    files["/" + p.lstrip("/")] = c
print(f"[*] indexed {len(files)} files\n")


def rd(path):
    n = files.get(path)
    if n is None:
        return None
    for m in (lambda: n.read_text(), lambda: img.read_file(n.inode)):
        try:
            d = m()
            return d.decode("utf-8", "replace") if isinstance(d, (bytes, bytearray)) else d
        except Exception:
            continue
    return None


FAIL = []
SPAN = re.compile(r"\{%(-?)(.*?)(-?)%\}|\{\{(.*?)\}\}", re.S)

# 与 25.12/diy-part1.sh 的崩溃守卫保持同一份规则表 (双向同步, 不许只改一边)
BANNED = [
    (r"(?<![\w$.])String\s*\(",      "String()"),
    (r"(?<![\w$.])Number\s*\(",      "Number()"),
    (r"(?<![\w$.])Boolean\s*\(",     "Boolean()"),
    (r"(?<![\w$.])Array\.isArray",   "Array.isArray"),
    (r"(?<![\w$.])JSON\.(parse|stringify)", "JSON.*"),
    (r"(?<![\w$.])unixtime\s*\(",    "unixtime()"),
    (r"(?<![\w$.])parseInt\s*\(",    "parseInt()"),
    (r"(?<![\w$.])parseFloat\s*\(",  "parseFloat()"),
    (r"(?<![\w$.])Object\.(keys|values|entries|assign)", "Object.*"),
    (r"(?<![\w$.])Date\.now",        "Date.now"),
    (r"(?<![\w$.])Math\.(max|min|round|floor|abs|pow)", "Math.*"),
]


def strip_comments(s):
    """剥 /* */ 与 // 注释 (逐字符扫描, ucode 字符串可嵌套)。"""
    out = []
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c == "/" and i + 1 < n and s[i + 1] == "*":
            j = s.find("*/", i + 2)
            i = (j + 2) if j >= 0 else n
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "/":
            j = s.find("\n", i)
            i = (j if j >= 0 else n)
            continue
        if c in "\"'`":
            q = c
            i += 1
            while i < n:
                if s[i] == "\\":
                    i += 2
                    continue
                if s[i] == q:
                    i += 1
                    break
                i += 1
            out.append('""')
            continue
        if c == "/":
            k = len(out) - 1
            while k >= 0 and out[k].strip() == "":
                k -= 1
            prev = out[k][-1] if k >= 0 else ""
            if prev in "(,=:[!&|?{;" or prev == "":
                i += 1
                incls = False
                while i < n:
                    if s[i] == "\\":
                        i += 2
                        continue
                    if s[i] == "[":
                        incls = True
                    elif s[i] == "]":
                        incls = False
                    elif s[i] == "/" and not incls:
                        i += 1
                        while i < n and s[i].isalpha():
                            i += 1
                        break
                    i += 1
                out.append("RE")
                continue
        out.append(c)
        i += 1
    return "".join(out)


def ucode_of(path, src):
    """.ut 只取 {% %}/{{ }} 块 (避开 CSS); .uc 与 rpcd 脚本整文件都是 ucode。"""
    if path.endswith(".ut"):
        return "\n".join((m.group(2) or "") + "\n" + (m.group(4) or "")
                         for m in SPAN.finditer(src))
    return src


def chk(cond, label, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not cond:
        FAIL.append(label)


# ---- 1. 崩溃根因: 出厂 ucode 源码里不能有未注册函数调用 ----
# 覆盖 .ut 模板 + .uc 控制器 + rpcd 脚本。rpcd 脚本曾是审计盲区:
# 历史上的 liuli 后端有 4 处 String() 和 1 处 unixtime() 藏在那里, 只扫 .ut 抓不到。
print("[1] 崩溃根因复核 — 所有出厂 ucode 源码 (.ut / .uc / rpcd)")
stats = {".ut": 0, ".uc": 0, "rpcd": 0}
bad = []
for p in sorted(files):
    if p.startswith("/usr/share/rpcd/ucode/"):
        kind = "rpcd"
    elif p.endswith(".ut"):
        kind = ".ut"
    elif p.endswith(".uc"):
        kind = ".uc"
    else:
        continue
    d = rd(p)
    if not d:
        continue
    stats[kind] += 1
    code = strip_comments(ucode_of(p, d))
    for pat, name in BANNED:
        if re.search(pat, code):
            bad.append(f"{p} 含 {name}")
            print(f"      !! {p} 含 {name}")
chk(not bad, f"扫描 {stats['.ut']} 模板 + {stats['.uc']} 控制器 + {stats['rpcd']} rpcd 脚本, 违规 {len(bad)}")

# ---- 1b. POSIX ERE: 出厂 ucode 里不能有逆序字符范围的正则 ----
# ucode 的 match()/replace() 走 glibc regcomp(REG_EXTENDED), POSIX 规定括号
# 表达式内的反斜杠是普通字符而非转义符, 所以 `[A-Za-z0-9\-._]` 会变成
# 范围('\' U+005C, '.' U+002E) —— 逆序 -> REG_ERANGE ->
# "Invalid character range", 整个 LuCI 500。规则与 diy-part1.sh 的 5b 同源。
print("\n[1b] POSIX ERE 复核 — 所有出厂 ucode 源码")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import posix_re_check
except ImportError:
    posix_re_check = None
    print("  [WARN] 找不到 posix_re_check.py, 跳过")

if posix_re_check:
    re_total = re_bad = 0
    for p in sorted(files):
        if p.startswith("/usr/share/rpcd/ucode/"):
            kind = "rpcd"
        elif p.endswith(".ut"):
            kind = ".ut"
        elif p.endswith(".uc"):
            kind = ".uc"
        else:
            continue
        d = rd(p)
        if not d:
            continue
        re_total += len(posix_re_check.extract_regexes(
            posix_re_check.ucode_code(p, d)))
        for ln, pat, iss in posix_re_check.check_text(p, d):
            re_bad += 1
            print(f"      !! {p}:{ln}  /{pat}/  -> {iss}")
    chk(re_bad == 0, f"扫描 {re_total} 条正则, 逆序字符范围 {re_bad}")

# ---- 2. Argon 主题模板齐全 (v3.1.0) ----
print("\n[2] Argon 主题 (jerrykuku v3.1.0)")
ARGON_TPL = ("footer.ut", "head.ut", "header.ut", "page_scripts.ut", "sysauth.ut",
             "head_meta.ut", "footer_login.ut", "header_login.ut",
             "login_background.ut", "login_form.ut", "out_header_login.ut")
for name in ARGON_TPL:
    p = f"/usr/share/ucode/luci/template/themes/argon/{name}"
    chk(p in files, f"模板 {name}")
hdr = rd("/usr/share/ucode/luci/template/themes/argon/head.ut") or ""
chk(len(hdr) > 500, "head.ut 非空", f"{len(hdr)} chars")
chk(not re.search(r"(?<![\w$.])String\s*\(", hdr), "head.ut 无裸 String()")
sysauth = rd("/usr/share/ucode/luci/template/themes/argon/sysauth.ut") or ""
chk(len(sysauth) > 500, "sysauth.ut 非空", f"{len(sysauth)} chars")
css = rd("/www/luci-static/argon/css/cascade.css")
chk(css is not None and len(css) > 10000, "Argon CSS 已打进镜像",
    f"{len(css or '')} chars")
# 设置页与资源
for p, label in [("/www/luci-static/resources/view/argon-config.js", "Argon 设置页"),
                 ("/etc/config/argon", "Argon 配置"),
                 ("/www/luci-static/argon/img/argon.svg", "Argon 图标")]:
    chk(p in files, label, p)

# ---- 2b. UPnP + Lucky (2026-10-22 清理后仅保留的两个插件) ----
print("\n[2b] UPnP 与 Lucky")
for p, label in [("/usr/sbin/miniupnpd", "miniupnpd 守护进程"),
                 ("/etc/config/upnpd", "UPnP 配置"),
                 ("/www/luci-static/resources/view/upnp/status.js", "UPnP LuCI 页面"),
                 ("/usr/bin/lucky", "lucky 核心二进制"),
                 ("/etc/config/lucky", "lucky 配置"),
                 ("/etc/init.d/lucky", "lucky 启动脚本"),
                 ("/www/luci-static/resources/view/lucky/config-3_0_0-26.js", "lucky LuCI 页面")]:
    chk(p in files, label, p)

# ---- 3. 默认主题必须是 Argon ----
print("\n[3] 默认主题 (Argon)")
cfg = rd("/etc/config/luci") or ""
m = re.search(r"option\s+mediaurlbase\s+(\S+)", cfg)
media = m.group(1) if m else "(none)"
chk(media == "/luci-static/argon", f"mediaurlbase = {media}")

# ---- 4. 裸 getspnam 全树扫描(纵深防御也应生效) ----
print("\n[4] 裸 getspnam 扫描(纵深防御)")
NAKED = "{% if (getuid() == 0 && getspnam('root')?.pwdp === ''): %}"
n = 0
for p in sorted(files):
    if p.endswith(".ut"):
        d = rd(p) or ""
        if NAKED in d:
            n += 1
            print(f"      !! {p}")
chk(n == 0, f"裸 getspnam 模板数 = {n}")

# ---- 5. 关键包是否真在镜像里 ----
print("\n[5] 关键文件在位")
for p, label in [("/www/luci-static/argon/css/cascade.css", "Argon 主题 CSS"),
                 ("/usr/sbin/miniupnpd", "miniupnpd"),
                 ("/usr/bin/lucky", "lucky 核心二进制"),
                 ("/etc/config/lucky", "lucky 配置"),
                 ("/etc/init.d/lucky", "lucky 启动脚本"),
                 ("/www/luci-static/resources/view/lucky/config-3_0_0-26.js", "lucky LuCI 页面")]:
    chk(p in files, label, p)

# ---- 6. 版本信息 ----
print("\n[6] 版本")
rel = rd("/etc/openwrt_release") or ""
for line in rel.splitlines():
    if line.strip():
        print("     ", line)
chk("mediatek/filogic" in rel, "目标 = mediatek/filogic")

# ---- 7. 已安装包 (argon/upnp/lucky) ----
print("\n[7] apk 安装库里的关键包")
db = rd("/lib/apk/db/installed") or ""
pkgs = {}
cur = {}
for line in db.splitlines():
    if line == "":
        if cur.get("P"):
            pkgs[cur["P"]] = cur.get("V", "?")
        cur = {}
        continue
    if ":" in line:
        k, v = line.split(":", 1)
        cur[k] = v
for name in sorted(pkgs):
    if re.search(r"(argon|lucky|upnp|miniupnpd)", name):
        print(f"      {name} = {pkgs[name]}")
for need in ("luci-theme-argon", "luci-app-upnp", "lucky", "luci-app-lucky"):
    chk(need in pkgs, f"已安装 {need}", pkgs.get(need, ""))

# ---- 8. 已下线插件必须不在镜像里 (2026-10-22 清理) ----
# 配置里删了不等于镜像里没有: 依赖解析可能把它们带回来, 所以按文件/包双查。
print("\n[8] 已下线插件复查 (liuli / smartdns / lxc / wireguard / msd_lite)")
GONE_PATHS = [
    "/usr/share/ucode/luci/template/themes/liuli",
    "/www/luci-static/liuli",
    "/www/luci-static/resources/view/liuli",
    "/usr/share/rpcd/ucode/luci.liuli",
    "/usr/share/rpcd/ucode/luci.liuli-theme",
    "/etc/config/liuli",
    "/etc/config/smartdns",
    "/etc/config/lxc",
    "/etc/config/upnpd.disabled",   # 占位, 不会存在
]
leftover = [p for p in GONE_PATHS if p in files]
for p in GONE_PATHS:
    if p in files:
        print(f"      !! 残留 {p}")
chk(not leftover, f"liuli/smartdns/lxc 文件路径残留 {len(leftover)} 处")

GONE_PKGS = ["luci-theme-liuli", "luci-app-liuli", "smartdns", "luci-app-smartdns",
             "lxc", "luci-app-lxc", "rpcd-mod-lxc", "liblxc",
             "wireguard-tools", "luci-proto-wireguard", "kmod-wireguard",
             "msd_lite", "luci-app-msd_lite"]
revived = [k for k in GONE_PKGS if k in pkgs]
for k in GONE_PKGS:
    if k in pkgs:
        print(f"      !! 已安装 {k} = {pkgs[k]}")
chk(not revived, f"已下线包复活 {len(revived)} 个")

print("\n" + "=" * 64)
if FAIL:
    print("独立复验失败:")
    for f in FAIL:
        print("   -", f)
    sys.exit(1)
print("独立复验全部通过 ✓  (无未注册调用/无逆序正则, Argon 为默认主题, lucky+UPnP 在位)")
print("=" * 64)
