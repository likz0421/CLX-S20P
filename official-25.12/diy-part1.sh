#!/bin/bash
#
# CLX-S20P — 官方 OpenWrt 25.12.6 构建 DIY part1
#
# 与 25.12/ 那条流水线的区别: 基线是 **openwrt/openwrt 官方 tag v25.12.6**,
# 不是 ImmortalWrt 衍生分支。设备支持由 official-25.12/port/ 提供
# (厂商公开 DTS + 自制配方 + base-files, 见 port/README.md)。
#
# 做什么:
#   1. 克隆 openwrt/openwrt @ v25.12.6
#   2. 应用 S20P 移植包 (DTS + 配方 + base-files)
#   3. Argon 主题 v3.1.0 (jerrykuku tag, 覆盖 feed 里的旧版)
#   4. Lucky (官方 luci-app-lucky v3.3.3 + 预编译静态核心 Makefile)
#   5. 更新并安装 feeds
#   6. 【崩溃守卫】未注册函数 + POSIX ERE 逆序字符范围
#   7. 把镜像默认主题改为 Argon
#
# 为什么必须自己做第 2 步: 官方 OpenWrt 的 mediatek/filogic 目标里有 52 个
# mt7986a-* 设备, 但没有 clx_s20p —— 设备定义、配方、base-files 全缺。
#
# WiFi 说明: 官方没有 package/mtk, 拿不到 kmod-mt_wifi/conninfra/warp/hnat。
# 本配置改用官方 mediatek 目标的上游 mt76 栈 (kmod-mt7915e + mt7986-firmware
# + mt7986-wo-firmware), 与官方 acer-w6 等同平台设备一致。
#
set -eo pipefail

echo "==================== diy-part1 (official 25.12.6): 开始 ===================="

# ---------------------------------------------------------
# 1. 克隆官方 OpenWrt 25.12.6
#    用 tag 而不是分支, 保证拿到的是 25.12.6 这个发布点本身
# ---------------------------------------------------------
if [ ! -f include/version.mk ]; then
	git clone --depth=1 -b v25.12.6 https://github.com/openwrt/openwrt.git .
	echo "官方 OpenWrt tag: $(git describe --tags 2>/dev/null || git rev-parse --short HEAD)"
fi

# ---------------------------------------------------------
# 2. 应用 S20P 移植包 (DTS + 设备配方 + base-files)
# ---------------------------------------------------------
echo "-------------------- 应用 S20P 移植包 --------------------"
bash "$GITHUB_WORKSPACE/official-25.12/port/apply.sh" "$(pwd)"

# 应用后立刻校验设备真的进了构建树, 否则后面会编出一个没有 clx_s20p 的固件
[ -f target/linux/mediatek/dts/mt7986a-clx-s20p.dts ] \
	|| { echo "::error::移植包未放入 DTS"; exit 1; }
grep -q "TARGET_DEVICES += clx_s20p" target/linux/mediatek/image/filogic.mk \
	|| { echo "::error::移植包未注册设备"; exit 1; }
echo "S20P 设备已注册: clx_s20p"


# ---------------------------------------------------------
# 3. Argon 主题 v3.1.0
#    feed 里的 argon 是旧版, 按 tag 克隆指定版本, 并在 feeds install
#    **之前**删掉 feed 副本, 避免两个同名包打架
# ---------------------------------------------------------
ARGON_TAG="v3.1.0"
rm -rf package/custom/luci-theme-argon
git clone --depth=1 -b "$ARGON_TAG" \
  https://github.com/jerrykuku/luci-theme-argon.git \
  package/custom/luci-theme-argon

[ -f package/custom/luci-theme-argon/Makefile ] \
  || { echo "::error::Argon 主题克隆失败"; exit 1; }
grep -q "PKG_VERSION:=3.1.0" package/custom/luci-theme-argon/Makefile \
  || { echo "::error::Argon 版本不是 3.1.0 (tag $ARGON_TAG 可能变了)"; exit 1; }
echo "Argon 主题 $ARGON_TAG 已加入编译树"

# ---------------------------------------------------------
# 4. Lucky: 官方 luci-app-lucky v3.3.3
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
# 5. feeds 更新 + 安装
#    安装前先删掉 feed 自带的 luci-theme-argon (与 package/custom 的同名冲突)
# ---------------------------------------------------------
./scripts/feeds update -a

if [ -d feeds/luci/luci-theme-argon ]; then
	rm -rf feeds/luci/luci-theme-argon
	echo "移除 feed 自带的 luci-theme-argon (只保留 v3.1.0 克隆)"
fi
find feeds -maxdepth 6 -type d -name luci-theme-argon -prune -exec rm -rf {} + 2>/dev/null || true

./scripts/feeds install -a

# 硬校验: 全树只允许一个 luci-theme-argon 包根目录, 且必须是 custom 那个
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


# ---------------------------------------------------------
# 6. 崩溃守卫 + 默认主题
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
# 7. POSIX ERE 守卫: 禁止逆序字符范围的正则
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
# 只把**逆序范围**当致命错误 —— 上游 luci-app-homeproxy 也写了
# `[A-Za-z0-9\+\-\_\.]`, 但那是退化范围 (`\`..`\`, 同字符), regcomp
# 能编译通过, 所以只作 ::warning:: 告警, 否则会把能用的上游代码拦在构建期。
if [ -n "${GITHUB_WORKSPACE:-}" ] && [ -f "$GITHUB_WORKSPACE/official-25.12/posix_re_check.py" ]; then
	POSIX_RE_CHECK="$GITHUB_WORKSPACE/official-25.12/posix_re_check.py"
else
	POSIX_RE_CHECK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/official-25.12/posix_re_check.py"
fi
python3 "$POSIX_RE_CHECK" feeds/luci package/custom

echo "==================== diy-part1 (official 25.12.6): 完成 ===================="
