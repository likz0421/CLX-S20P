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
# 覆盖 .ut 模板 + .uc 控制器 + rpcd 脚本。rpcd 脚本是第二轮的审计盲区:
# luci.liuli 的 4 处 String() 和 1 处 unixtime() 就藏在那里, 只扫 .ut 抓不到。
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

# ---- 2. 琉璃主题模板齐全且已修复 ----
print("\n[2] 琉璃 Liuli 主题")
for name in ("footer.ut", "head.ut", "header.ut", "page_scripts.ut", "sysauth.ut"):
    p = f"/usr/share/ucode/luci/template/themes/liuli/{name}"
    chk(p in files, f"模板 {name}")
hdr = rd("/usr/share/ucode/luci/template/themes/liuli/head.ut") or ""
chk("const liuli_str" in hdr, "head.ut 含 liuli_str helper")
chk(not re.search(r"(?<![\w$.])String\s*\(", hdr), "head.ut 无裸 String()")
sysauth = rd("/usr/share/ucode/luci/template/themes/liuli/sysauth.ut") or ""
chk("const liuli_str" in sysauth, "sysauth.ut 含 liuli_str helper")
css = rd("/www/luci-static/liuli/css/cascade.css")
chk(css is not None and len(css) > 10000, "琉璃 CSS 已打进镜像",
    f"{len(css or '')} chars")

# ---- 2b. rpcd 后端 (第二轮审计的修复点) ----
print("\n[2b] 琉璃看板 rpcd 后端 luci.liuli")
rp = rd("/usr/share/rpcd/ucode/luci.liuli") or ""
chk("const liuli_str" in rp, "luci.liuli 含 liuli_str helper")
chk(not re.search(r"(?<![\w$.])String\s*\(", rp), "luci.liuli 无裸 String()")
chk(not re.search(r"(?<![\w$.])unixtime\s*\(", rp), "luci.liuli 无 unixtime()")
chk("ts: time()" in rp, "ping 方法用 time() 取时间戳")
chk("f[col.cpu]" in rp, "processes() 按表头名定位 %CPU 列")
chk("n != n" in rp, "num()/toNum() 显式判 NaN")
chk("const ubus = connect();" in rp and
    "\t\t\ttry {\n\t\t\t\tconst ubus = connect();" not in rp,
    "readStations() 循环外只建一次 ubus 连接",
    f"connect() 调用点 = {rp.count('connect()')}")
th = rd("/usr/share/rpcd/ucode/luci.liuli-theme") or ""
chk('return { "liuli-theme": methods }' in th, "luci.liuli-theme 导出 luci-theme 对象")
chk("ubus.call('uci', 'commit', { config: 'liuli' })" in th,
    "luci.liuli-theme setConfig 提交 uci")

# ---- 3. 默认主题必须是琉璃 ----
print("\n[3] 默认主题")
cfg = rd("/etc/config/luci") or ""
m = re.search(r"option\s+mediaurlbase\s+(\S+)", cfg)
media = m.group(1) if m else "(none)"
chk(media == "/luci-static/liuli", f"mediaurlbase = {media}")

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
for p, label in [("/usr/bin/lucky", "lucky 核心二进制"),
                 ("/etc/config/lucky", "lucky 配置"),
                 ("/etc/init.d/lucky", "lucky 启动脚本"),
                 ("/www/luci-static/resources/view/lucky/config-3_0_0-26.js", "lucky LuCI 页面"),
                 ("/www/luci-static/resources/view/liuli/dashboard.js", "琉璃看板页面"),
                 ("/usr/share/rpcd/ucode/luci.liuli", "琉璃看板 rpcd"),
                 ("/etc/config/liuli", "琉璃主题配置")]:
    chk(p in files, label, p)

# ---- 6. 版本信息 ----
print("\n[6] 版本")
rel = rd("/etc/openwrt_release") or ""
for line in rel.splitlines():
    if line.strip():
        print("     ", line)
chk("mediatek/filogic" in rel, "目标 = mediatek/filogic")

# ---- 7. 已安装包 (liuli/lucky) ----
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
    if re.search(r"(liuli|lucky)", name):
        print(f"      {name} = {pkgs[name]}")
for need in ("luci-theme-liuli", "luci-app-liuli", "lucky", "luci-app-lucky"):
    chk(need in pkgs, f"已安装 {need}", pkgs.get(need, ""))

print("\n" + "=" * 64)
if FAIL:
    print("独立复验失败:")
    for f in FAIL:
        print("   -", f)
    sys.exit(1)
print("独立复验全部通过 ✓  (崩溃根因已消除, liuli 为默认主题, lucky 在位)")
print("=" * 64)
