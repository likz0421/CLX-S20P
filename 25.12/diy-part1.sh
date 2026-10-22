#!/bin/bash
#
# CLX-S20P — ImmortalWrt 25.12 (mtk k6.12) DIY part1
#
# 做什么:
#   1. 灌入 Lucky: 官方 luci-app-lucky v3.3.3 + 预编译静态核心 Makefile
#   2. 灌入 Argon 主题: jerrykuku/luci-theme-argon v3.1.0 (指定 tag 克隆)
#      feed 里的 argon 只有 2.4.7, 所以克隆后移除 feed 副本避免同包名冲突
#   3. 更新并安装 feeds
#   4. 【崩溃守卫】扫描所有 ucode 源码 (.ut 模板 + .uc 控制器 + rpcd 脚本),
#      禁止调用 ucode 里不存在的函数; 并扫描 POSIX ERE, 禁止逆序字符范围
#   5. 把镜像默认主题改为 Argon
#
# 已下线的插件 (2026-10-22 清理): 琉璃 Liuli 主题/看板、SmartDNS、LXC 容器、
# WireGuard、组播转换 (msd_lite)。仅保留 Lucky 与 UPnP。
#
# 关于第 5 条 —— 这是真·根因防线, 而且已经抓到过两轮:
#
#   第一轮 (left-hand side is not a function):
#     根因是 ucode 的全局函数表里**没有 String()**
#     (jow-/ucode 的 lib.c 只注册了 71 个内置)。调用 String(x) 等于调用
#     undefined, 直接抛异常; 而 sysauth 的渲染同时被 dispatcher.uc:953(主题
#     sysauth) 和 :960(base sysauth 回退) 两条路走到, 两条都炸, 整个 LuCI
#     就 500 了。
#
#   第二轮 (Invalid character range):
#     同一个病在 rpcd 后端复发 (当时的 luci.liuli 里 4 处 String() + 1 处
#     unixtime()), 说明守卫只扫 .ut 模板是盲区 —— 现已覆盖 .ut/.uc/rpcd。
#     修掉 String() 之后又暴露了第三层: ucode 的 match() 走 glibc
#     regcomp(REG_EXTENDED), 而 POSIX 规定**括号表达式内的反斜杠是普通
#     字符, 不是转义符**, 于是 `[A-Za-z0-9\-._~...]` 变成范围
#     '\'(U+005C)..'.'(U+002E) —— 逆序 -> REG_ERANGE -> "Invalid character
#     range"。现由第 6 步的 posix_re_check.py 专门把关。
#
#   注意: 此前还误判过 getspnam。取证结果推翻了它 ——
#   /usr/lib/ucode/luci/core.so 在「可用固件」和「崩溃固件」里字符串表
#   完全一致(137 条, 零差异), getspnam 两边都导出了。
#   getspnam 守卫保留为纵深防御, 但不再是主防线。它现在保护的是 Argon:
#   jerrykuku/luci-theme-argon v3.1.0 的 header.ut:67 就有那段裸调用。
#
set -eo pipefail

echo "==================== diy-part1: 开始 ===================="

# ---------------------------------------------------------
# 1. 准备工作目录
#    (原先为 Lucky 追加的 nas / nas_luci / istore feeds 已无用 —— Lucky 现在
#     直接从 gdy666/luci-app-lucky 克隆, 配置里也没有任何 linkease/iStore
#     包, 留着只会拖慢 feeds update, 故一并移除)
# ---------------------------------------------------------
mkdir -p package/custom

# ---------------------------------------------------------
# 2. Argon 主题: jerrykuku/luci-theme-argon v3.1.0
#    feed 里的 argon 是 2.4.7, 差一个大版本, 所以按 tag 克隆指定版本,
#    并在 feeds install 之前移除 feed 副本, 避免两个同名包打架。
# ---------------------------------------------------------
ARGON_TAG="v3.1.0"
rm -rf package/custom/luci-theme-argon
git clone --depth=1 -b "$ARGON_TAG" \
  https://github.com/jerrykuku/luci-theme-argon.git \
  package/custom/luci-theme-argon

# 克隆失败必须立刻失败: 否则 CONFIG_PACKAGE_luci-theme-argon=y 会被 oldconfig
# 静默丢掉, 最后编出一个"没有主题"的固件且全程绿灯
[ -f package/custom/luci-theme-argon/Makefile ] \
  || { echo "::error::Argon 主题克隆失败"; exit 1; }
grep -q "PKG_VERSION:=3.1.0" package/custom/luci-theme-argon/Makefile \
  || { echo "::error::Argon 版本不是 3.1.0 (tag $ARGON_TAG 可能变了)"; exit 1; }
echo "Argon 主题 $ARGON_TAG 已加入编译树:"
ls package/custom/luci-theme-argon | head -8

# ---------------------------------------------------------
# 3. Lucky: 官方 luci-app-lucky v3.3.3
#    核心 lucky 包用 release.66666.host 官方 3.3.3 xiaojv 预编译静态二进制
# ---------------------------------------------------------
git clone --depth=1 -b v3.3.3 https://github.com/gdy666/luci-app-lucky.git package/custom/lucky-app

cat > package/custom/lucky-app/lucky/Makefile <<'LUCKY_EOF'
# SPDX-License-Identifier: MIT
# Lucky core - official prebuilt static binary (3.3.3 xiaojv)

include $(TOPDIR)/rules.mk

PKG_NAME:=lucky
PKG_VERSION:=3.3.3
PKG_RELEASE:=1

PKG_LICENSE:=MIT
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=GDY666 <gdy666@foxmail.com>

LUCKY_ARCH:=

ifeq ($(ARCH),aarch64)
  LUCKY_ARCH:=arm64
endif
ifeq ($(ARCH),x86_64)
  LUCKY_ARCH:=x86_64
endif

PKG_SOURCE:=lucky_$(PKG_VERSION)_Linux_$(LUCKY_ARCH)_xiaojv.tar.gz
PKG_SOURCE_URL:=https://release.66666.host/v3.3.3beta/3.3.3_xiaojv/
PKG_HASH:=a0ff1fa14a08fa9b3aefc36644ebfcfa0be93a726abc28185aa3553b04af3b58
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk

define Package/lucky
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Lucky network utility (official prebuilt 3.3.3 xiaojv)
  DEPENDS:=@(aarch64||x86_64)
  URL:=https://lucky666.cn
endef

define Package/lucky/description
 Lucky provides IPv4/IPv6 port forwarding, DDNS, Wake-on-LAN,
 reverse proxy, ACME automation and related network services.
 Prebuilt static binary from the official release server.
endef

define Package/lucky/conffiles
/etc/config/lucky
endef

define Build/Prepare
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	gzip -dc $(DL_DIR)/$(PKG_SOURCE) | $(HOST_TAR) -C $(PKG_BUILD_DIR) -xf -
	$(Build/Patch)
endef

define Build/Compile
endef

define Package/lucky/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/lucky $(1)/usr/bin/lucky
	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) ./files/lucky-call $(1)/usr/libexec/lucky-call
	$(INSTALL_BIN) ./files/lucky-watchdog $(1)/usr/libexec/lucky-watchdog
	$(INSTALL_DIR) $(1)/usr/share/lucky
	echo '$(LUCKY_ARCH)' > $(1)/usr/share/lucky/arch
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/lucky.init $(1)/etc/init.d/lucky
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/luckyuci $(1)/etc/config/lucky
endef

define Package/lucky/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /usr/libexec/lucky-watchdog sync
endef

define Package/lucky/prerm
#!/bin/sh
if [ -z "$${IPKG_INSTROOT}" ] && [ "$${PKG_UPGRADE}" != 1 ]; then
	/etc/init.d/lucky stop
	/usr/libexec/lucky-watchdog remove
fi
endef

$(eval $(call BuildPackage,lucky))
LUCKY_EOF
echo "Lucky 已加入编译树"

# ---------------------------------------------------------
# 4. feeds 更新 + 安装
#    安装前必须先删掉 feed 自带的 luci-theme-argon: feeds install -a 会把它
#    软链到 package/feeds/luci/ 下, 与 package/custom/luci-theme-argon
#    同包名, OpenWrt 的包扫描对同名包的处理不确定, 不要赌。
# ---------------------------------------------------------
./scripts/feeds update -a

if [ -d feeds/luci/themes/luci-theme-argon ]; then
	echo "移除 feed 自带的 luci-theme-argon (只保留 v3.1.0 克隆):"
	echo "   $(cd feeds/luci/themes/luci-theme-argon && git describe --tags 2>/dev/null || echo '(无 tag 信息)')"
	rm -rf feeds/luci/themes/luci-theme-argon
else
	echo "::warning::feeds/luci/themes/luci-theme-argon 不存在, feed 结构可能变了"
fi
# 兜底: 万一 feed 调整了目录层级, 再把 feeds/ 下任何同名目录清掉
find feeds -maxdepth 6 -type d -name luci-theme-argon -prune -exec rm -rf {} + 2>/dev/null || true

./scripts/feeds install -a

# 硬校验: 全树只允许存在一个 luci-theme-argon **包根目录**。
# 注意不能用 `find package -name Makefile -path '*luci-theme-argon*'` ——
# 克隆下来的树里还有 compat/luci-app-argon-config/Makefile, 路径同样含
# luci-theme-argon, 会被误数成第 2 份。
ARGON_DIRS=$(find package -type d -name luci-theme-argon | sort)
ARGON_N=$(printf '%s\n' "$ARGON_DIRS" | grep -c . || true)
echo "luci-theme-argon 包根目录数量 = $ARGON_N"
printf '%s\n' "$ARGON_DIRS" | sed 's/^/   /'
if [ "$ARGON_N" != "1" ]; then
	echo "::error::luci-theme-argon 出现 $ARGON_N 份 (应为 1), 同名包冲突"
	exit 1
fi
if [ "$ARGON_DIRS" != "package/custom/luci-theme-argon" ]; then
	echo "::error::生效的不是 package/custom 下的 v3.1.0 克隆"
	exit 1
fi
if [ ! -f package/custom/luci-theme-argon/ucode/template/themes/argon/head.ut ]; then
	echo "::error::v3.1.0 应有的 ucode 模板缺失, 克隆内容不完整"
	exit 1
fi

# ---------------------------------------------------------
# 5. 崩溃守卫 + 默认主题
# ---------------------------------------------------------
python3 <<'GUARD_PYEOF'
import os
import re
import sys

ROOTS = ["feeds/luci", "package/custom"]
fails = []

# ---- 5a. 禁止调用 ucode 里不存在的函数 (JS 惯性写法) ----
# ucode 全局函数表只有 71 个, 没有 String()/Number()/Boolean() 这类 JS 构造器,
# 也没有 JSON.parse/JSON.stringify(ucode 用 json()), 更没有 parseInt/parseFloat/
# unixtime()/Date.now()/Math.*。这些名字在 ucode 里调用即抛
# "left-hand side is not a function"。
#
# 下面这份规则表对出厂固件自带的 59 个 ucode 文件 (.ut/.uc/rpcd 脚本) 以及
# jerrykuku/luci-theme-argon v3.1.0 的 13 个 ucode 文件做过假阳性对照:
# 全部零命中, 所以不会误伤上游代码。
BANNED = [
    (r"(?<![\w$.])String\s*\(",      "String()  — ucode 没有该全局函数, 用模板字面量 `${x}` 代替"),
    (r"(?<![\w$.])Number\s*\(",      "Number()  — ucode 没有该全局函数, 用 int()/乘法运算代替"),
    (r"(?<![\w$.])Boolean\s*\(",     "Boolean() — ucode 没有该全局函数, 用 !!x 代替"),
    (r"(?<![\w$.])Array\.isArray",   "Array.isArray — ucode 没有该 API, 用 type(x) == 'array'"),
    (r"(?<![\w$.])JSON\.(parse|stringify)", "JSON.* — ucode 用 json() 编解码"),
    (r"(?<![\w$.])unixtime\s*\(",    "unixtime() — ucode 没有该全局函数, 用 time() 取 Unix 时间戳"),
    (r"(?<![\w$.])parseInt\s*\(",    "parseInt() — ucode 没有该全局函数, 用 int()"),
    (r"(?<![\w$.])parseFloat\s*\(",  "parseFloat() — ucode 没有该全局函数, 用 `s * 1`"),
    (r"(?<![\w$.])Object\.(keys|values|entries|assign)", "Object.* — ucode 用 keys()/values()"),
    (r"(?<![\w$.])Date\.now",        "Date.now — ucode 用 time()"),
    (r"(?<![\w$.])Math\.(max|min|round|floor|abs|pow)", "Math.* — ucode 用 max()/min() 或算术"),
]

# ucode 模板代码块: {% ... %} 与 {{ ... }}
CODE_SPAN = re.compile(r"\{%(-?)(.*?)(-?)%\}|\{\{(.*?)\}\}", re.S)


def strip_comments(s):
    """剥掉 /* */ 与 // 注释, 保留字符串字面量内容。

    必须先剥注释再扫描: 之前守卫扫到自己写在 {% %} 块里的说明注释
    (注释里含字面量 String(), 直接让构建 exit 1)。
    用逐字符扫描而不是正则, 因为 ucode 字符串可以嵌套
    (双引号里出现单引号, 正则按顺序剥离会错位)。
    """
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
    """按文件类型取出「纯 ucode 代码」部分。

    .ut  模板 -> 只取 {% %}/{{ }} 块, 避开 CSS 里的 blur()/rgba()/url()
    .uc  控制器 -> 整个文件都是 ucode
    无扩展名的 rpcd 脚本 (root/usr/share/rpcd/ucode/*) -> 整个文件都是 ucode
    """
    if path.endswith(".ut"):
        return "\n".join(
            (m.group(2) or "") + "\n" + (m.group(4) or "")
            for m in CODE_SPAN.finditer(src)
        )
    return src


stats = {".ut": 0, ".uc": 0, "rpcd": 0}

for root in ROOTS:
    if not os.path.isdir(root):
        continue
    for dirpath, _, files in os.walk(root):
        # 归一化分隔符: Windows 下 os.sep 是 '\', 不能直接 endswith 正斜杠路径
        norm = dirpath.replace(os.sep, "/")
        is_rpcd = norm.endswith("usr/share/rpcd/ucode")
        for fn in files:
            p = os.path.join(dirpath, fn)
            if is_rpcd:
                kind = "rpcd"
            elif fn.endswith(".ut"):
                kind = ".ut"
            elif fn.endswith(".uc"):
                kind = ".uc"
            else:
                continue
            try:
                src = open(p, encoding="utf-8").read()
            except Exception:
                continue
            stats[kind] += 1
            code = strip_comments(ucode_of(p, src))
            for pat, why in BANNED:
                m = re.search(pat, code)
                if m:
                    line = code.count("\n", 0, m.start()) + 1
                    fails.append(f"{p}:{line} 命中 {why}")

print("=" * 66)
print(f"崩溃守卫: 扫描 {stats['.ut']} 个 .ut 模板 + {stats['.uc']} 个 .uc 控制器 "
      f"+ {stats['rpcd']} 个 rpcd ucode 脚本")
print("=" * 66)
if fails:
    print("::error::以下 ucode 文件调用了不存在的函数, 会导致 LuCI 500 或 rpcd 方法崩溃:")
    for f in fails:
        print("   ", f)
    sys.exit(1)
print("  通过: 无 String()/Number()/unixtime()/parseInt()/JSON.* 等未注册调用")
print("  覆盖范围含 rpcd ucode 脚本 (历史上的 String()/unixtime() 就藏在 rpcd "
      "后端里, 只扫 .ut 模板抓不到)")

# ---- 5b. getspnam 纵深防御(曾误判为主因, 保留以防换主题/luci 版本复发) ----
# 现在真正保护的是 Argon: jerrykuku/luci-theme-argon v3.1.0 的
# ucode/template/themes/argon/header.ut:67 就是那段裸调用。
OLD = "{% if (getuid() == 0 && getspnam('root')?.pwdp === ''): %}"
NEW = ("{% if (type(getuid) == 'function' && getuid() == 0 "
       "&& type(getspnam) == 'function' && (getspnam('root')?.pwdp ?? '') === ''): %}")
patched = []
for root in ROOTS:
    if not os.path.isdir(root):
        continue
    for dirpath, _, files in os.walk(root):
        for fn in files:
            if not fn.endswith(".ut"):
                continue
            p = os.path.join(dirpath, fn)
            try:
                s = open(p, encoding="utf-8").read()
            except Exception:
                continue
            if OLD in s:
                open(p, "w", encoding="utf-8").write(s.replace(OLD, NEW))
                patched.append(p)
print(f"getspnam 守卫: 修补 {len(patched)} 个模板")
for p in patched:
    print("   patched:", p)

# ---- 5c. 镜像默认主题改为 Argon ----
cfg = "feeds/luci/modules/luci-base/root/etc/config/luci"
if os.path.isfile(cfg):
    s = open(cfg, encoding="utf-8").read()
    s2 = re.sub(r"option mediaurlbase\s+\S+",
                "option mediaurlbase /luci-static/argon", s)
    open(cfg, "w", encoding="utf-8").write(s2)
    print("默认主题 ->", [l for l in s2.splitlines() if "mediaurlbase" in l])
else:
    print("::warning:: 未找到默认主题配置:", cfg)
GUARD_PYEOF

echo "自检通过: 无 ucode 未注册函数调用"

# ---------------------------------------------------------
# 6. POSIX ERE 守卫: 禁止逆序字符范围的正则
# ---------------------------------------------------------
# 症状: 刷机后 LuCI 500, 报
#     Invalid character range
#     (runtime.uc:133 <- dispatcher.uc:960)
# 根因: ucode 的 match()/replace() 直接把模式交给 glibc regcomp(REG_EXTENDED),
# 而 POSIX 规定**括号表达式内的反斜杠是普通字符, 不是转义符**。于是
#     /^[A-Za-z0-9\-._~:\/?#\[\]@!$&*+,;=%() ]*$/
# 被解析成 class(A-Z a-z 0-9 '\') 紧跟范围('\', '.')
# = U+005C..U+002E —— 逆序 -> REG_ERANGE -> "Invalid character range"。
# 官方 idiom: '-' 放类尾, 不写 \[ 与 \]
# (dispatcher.uc:734 `/^[A-Za-z0-9_%.\/,;-]+$/`, fw4.uc:1649 `[a-zA-Z0-9\/_.-]*`)
# 该检查对出厂固件自带的 59 个 ucode 文件 + argon v3.1.0 的 13 个做过假阳性
# 对照: 致命的「逆序范围」零命中。注意只把**逆序范围**当致命错误 —— 上游
# luci-app-homeproxy 也写了 `[A-Za-z0-9\+\-\_\.]`, 但那是退化范围
# (`\`..`\`, 同字符), regcomp 能编译通过, 所以只作 ::warning:: 告警,
# 否则会把本来能用的上游代码拦在构建期。
# GITHUB_WORKSPACE 在 CI 里由 Actions 注入; 本地单独跑时按脚本位置反推。
if [ -n "${GITHUB_WORKSPACE:-}" ] && [ -f "$GITHUB_WORKSPACE/25.12/posix_re_check.py" ]; then
	POSIX_RE_CHECK="$GITHUB_WORKSPACE/25.12/posix_re_check.py"
else
	POSIX_RE_CHECK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/25.12/posix_re_check.py"
fi
python3 "$POSIX_RE_CHECK" feeds/luci package/custom

echo "自检通过: 无逆序字符范围的 POSIX ERE (告警不阻断)"
echo "==================== diy-part1: 完成 ===================="
