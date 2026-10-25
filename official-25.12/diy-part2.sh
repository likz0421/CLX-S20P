#!/bin/bash
#
# CLX-S20P — 官方 OpenWrt 25.12.6 DIY part2 (配置定型 + 硬校验)
#
set -eo pipefail

# 开启 ccache, 加速后续重编译 (GitHub cache 在 workflow 里持久化 ~/.ccache)
echo 'CONFIG_CCACHE=y' >> .config

echo "==================== diy-part2 (official 25.12.6): 开始 ===================="

# ---------------------------------------------------------
# 1. 版本号写入构建日期
# ---------------------------------------------------------
BUILD_DATE="$(date +%Y%m%d)"
sed -i "s/^CONFIG_VERSION_CODE=.*/CONFIG_VERSION_CODE=\"${BUILD_DATE}\"/" .config
grep -E "^CONFIG_VERSION_(DIST|NUMBER|CODE)=" .config || true

# ---------------------------------------------------------
# 2. 解析依赖 / 裁剪无效项
#    先快照, 之后才能发现哪些包被静默丢掉
# ---------------------------------------------------------
cp .config .config.pre-defconfig

# 清除官方 feeds 里的 weechat 递归依赖 (luci-app-weechat <-> weechat-full/minimal),
# 否则 make defconfig 报 "recursive dependency detected" 并误丢一批包 (含 wpad-openssl 等)
rm -rf package/feeds/packages/net/weechat \
       package/feeds/luci/applications/luci-app-weechat 2>/dev/null || true

make defconfig

echo "-------------------- 配置裁剪报告 --------------------"
# 官方 OpenWrt 没有 package/mtk, 也没有 ImmortalWrt 特有包;
# 这些在 .config 里写了 =y 但仓库里不存在时, defconfig 会**静默丢弃**。
# 不查的话就会得到一个"看起来该有的都有、实际少一堆功能"的固件。
python3 - <<'PYEOF'
import re
pre = {}
for l in open('.config.pre-defconfig', encoding='utf-8'):
    m = re.match(r'^CONFIG_PACKAGE_([A-Za-z0-9_.+-]+)=y$', l.strip())
    if m:
        pre[m.group(1)] = True
post = set()
for l in open('.config', encoding='utf-8'):
    m = re.match(r'^CONFIG_PACKAGE_([A-Za-z0-9_.+-]+)=y$', l.strip())
    if m:
        post.add(m.group(1))
dropped = sorted(set(pre) - post)
print(f"  请求 {len(pre)} 个包, defconfig 后保留 {len(post)} 个")
if dropped:
    print(f"  !! 被静默丢弃 {len(dropped)} 个 (仓库里没有这些包):")
    for d in dropped:
        print(f"       - {d}")
else:
    print("  ✓ 没有包被丢弃")
PYEOF
rm -f .config.pre-defconfig

# ---------------------------------------------------------
# 2b. 设备配方声明的包必须真实存在 (快速失败)
#     Run 13 的教训: DEVICE_PACKAGES 里的 automount 在 OpenWrt 25.12.6 的
#     feeds 里根本不存在, 但 make defconfig 对此**一声不吭** —— 它只在
#     编译收尾阶段 (target/linux/install, per-device rootfs 装包) 才由 apk
#     报 "automount (no such package)", 那时已经白白烧掉 1 小时 49 分。
#     这里用全树 PKG_NAME 索引在几秒内把它拦下来。
#     注意: kmod-* 不走 PKG_NAME 索引 (由内核构建按 Kconfig 生成), 跳过。
# ---------------------------------------------------------
echo "-------------------- 设备配方包存在性校验 --------------------"
CLX_SECTION=$(awk '/# --- CLX-S20P \(ported for OpenWrt 25\.12\) ---/{f=1} f' \
	target/linux/mediatek/image/filogic.mk)
# 把行尾续行符合并成一行, 再取出 DEVICE_PACKAGES 列表
DEV_PKGS=$(printf '%s\n' "$CLX_SECTION" \
	| sed -e ':a' -e 'N' -e '$!ba' -e 's/\\\n[[:space:]]*/ /g' \
	| grep "DEVICE_PACKAGES[[:space:]]*:=" \
	| sed 's/.*DEVICE_PACKAGES[[:space:]]*:=[[:space:]]*//' \
	| tr -s '[:space:]' '\n' | sed '/^$/d' | sort -u)

if [ -z "$DEV_PKGS" ]; then
	echo "::error::没能从 filogic.mk 里解析出 CLX-S20P 的 DEVICE_PACKAGES"
	exit 1
fi

PKGIDX=$(mktemp)
# -R 跟随符号链接, 这样 package/feeds/<feed>/* 也能被索引到。
# 两类名字都要抓:
#   1) PKG_NAME:=<name>            主包名 (注意把 ":=" 一起剥掉)
#   2) define Package/<name>/...  **子包名** —— OpenWrt 大量工具是按子包发的:
#      util-linux/Makefile 里 PKG_NAME:=util-linux, 但 blkid / blockdev /
#      losetup 都是 define Package/<name>; f2fs-tools 同理出 mkf2fs / f2fsck;
#      system/fstools 出 block-mount / blockd。只抓 PKG_NAME 会把这些
#      全误判成"不存在" (第一版守卫就这么误报的)。
{
  grep -Rh "^PKG_NAME:=" package 2>/dev/null | sed 's/^PKG_NAME:[[:space:]]*=[[:space:]]*//'
  grep -Rh "^define Package/" package 2>/dev/null | sed 's|^define Package/||; s|[/[:space:]].*||'
} | sed '/^$/d' | sort -u > "$PKGIDX"
echo "  已索引 $(wc -l < "$PKGIDX") 个包名"

BAD_PKGS=""
for p in $DEV_PKGS; do
	case "$p" in
		kmod-*) continue ;;   # 内核模块, 由内核构建生成
	esac
	if ! grep -qx "$p" "$PKGIDX"; then
		BAD_PKGS="$BAD_PKGS $p"
	fi
done
rm -f "$PKGIDX"

if [ -n "$BAD_PKGS" ]; then
	echo "::error::设备配方里的包在本版本 OpenWrt 中不存在:${BAD_PKGS}"
	echo "  -> 这些包会让 per-device rootfs 装包失败 (编译到最后一小时才炸)。"
	echo "  -> 请改用官方等价包; 例如厂商私有 automount -> block-mount + blockd"
	echo "     (package/system/fstools)。"
	exit 1
fi
echo "  [OK] DEVICE_PACKAGES 全部存在 ($(echo $DEV_PKGS | wc -w) 个)"

# ---------------------------------------------------------
# 3. 硬校验: 关键包必须真的留在 .config 里
# ---------------------------------------------------------
echo "-------------------- 关键包校验 --------------------"
MISSING=0
for pkg in luci-theme-argon luci-app-upnp lucky luci-app-lucky \
           kmod-mt7915e kmod-mt7986-firmware mt7986-wo-firmware; do
	if grep -q "^CONFIG_PACKAGE_${pkg}=y" .config; then
		echo "  [OK]      ${pkg}"
	else
		echo "  [MISSING] ${pkg}"
		MISSING=1
	fi
done

# luci 本体 + Web 服务器必须存在 (luci-light 会拉入 luci-base + uhttpd)
if grep -qE "^CONFIG_PACKAGE_luci-base=y" .config && grep -qE "^CONFIG_PACKAGE_uhttpd=y" .config; then
	echo "  [OK]      luci-base + uhttpd 已选中 (Web 界面可用)"
else
	echo "  [MISSING] luci-base/uhttpd 未入选 —— Web 界面不会被编入"
	MISSING=1
fi

# clx_s20p 设备必须被选中 (Target Profile)
#
# 这里**不能**只看 CONFIG_TARGET_MULTI_PROFILE: 若设备因故没注册成功,
# MULTI_PROFILE 依然是 y, make 会"无事可做"地成功退出, 最后 bin/targets 里
# 一个镜像都没有 —— 编译步骤却显示 success, 直到 verify 才发现找不到固件。
# 所以必须校验 clx_s20p 自己的符号真的在。
if grep -qE "^CONFIG_TARGET_mediatek_filogic_DEVICE_clx_s20p=y" .config || \
   grep -qE "^CONFIG_TARGET_DEVICE_mediatek_filogic_DEVICE_clx_s20p=y" .config; then
	echo "  [OK]      clx_s20p 设备已选中"
else
	echo "  [MISSING] clx_s20p 设备未被选中 —— 编不出镜像"
	MISSING=1
fi

# ---------------------------------------------------------
# 4. 已下线插件复查: 配置里删了, 也要确认没被依赖带回来
# ---------------------------------------------------------
echo "-------------------- 已下线插件复查 --------------------"
REVIVED=0
for pkg in luci-theme-liuli luci-app-liuli smartdns luci-app-smartdns \
           lxc luci-app-lxc rpcd-mod-lxc liblxc \
           wireguard-tools luci-proto-wireguard kmod-wireguard \
           msd_lite luci-app-msd_lite \
           kmod-mt_wifi kmod-conninfra kmod-warp kmod-mediatek_hnat \
           luci-app-mtwifi-cfg mtwifi-cfg-ucode wifi-dats mtkhqos_util \
           luci-app-turboacc-mtk; do
	if grep -q "^CONFIG_PACKAGE_${pkg}=y" .config; then
		echo "  [REVIVED] ${pkg} —— 又被带回来了"
		REVIVED=1
	else
		echo "  [OK]      ${pkg} 未入选"
	fi
done

if [ "$MISSING" = "1" ] || [ "$REVIVED" = "1" ]; then
	echo "::error::关键包未进入 .config 或已下线插件复活, 拒绝继续编译"
	grep -E "CONFIG_PACKAGE_(luci-theme-argon|luci-app-upnp|lucky|mt_wifi|mtwifi|smartdns|lxc|wireguard|msd_lite|liuli)=" .config || true
	exit 1
fi

# ---------------------------------------------------------
# 5. 打印最终主题 / 关键选择
# ---------------------------------------------------------
echo "-------------------- 主题 & 关键选择 --------------------"
grep -E "^CONFIG_PACKAGE_luci-theme-" .config || true
echo
echo "-------------------- 目标设备 --------------------"
grep -E "^CONFIG_TARGET_(BOARD|SUBTARGET)=|^CONFIG_TARGET_DEVICE_mediatek" .config | head -5
grep -E "^CONFIG_TARGET_ROOTFS" .config | head -3

echo "==================== diy-part2 (official 25.12.6): 完成 ===================="
