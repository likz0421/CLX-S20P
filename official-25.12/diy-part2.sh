#!/bin/bash
#
# CLX-S20P — 官方 OpenWrt 25.12.6 DIY part2 (配置定型 + 硬校验)
#
set -eo pipefail

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

# luci 本体必须存在(否则整个 Web 界面没有)
if grep -qE "^CONFIG_PACKAGE_(luci|luci-light)=[ym]" .config; then
	echo "  [OK]      luci 集合已选中"
else
	echo "  [MISSING] luci 集合 —— Web 界面不会被编入"
	MISSING=1
fi

# clx_s20p 设备必须被选中 (Target Profile)
if grep -q "^CONFIG_TARGET_MULTI_PROFILE=y" .config || \
   grep -q "^CONFIG_TARGET_mediatek_filogic_DEVICE_clx_s20p=y" .config; then
	echo "  [OK]      clx_s20p 设备已选中"
else
	echo "  [WARN]    未见 clx_s20p 的 DEVICE 符号, 依赖 multi-profile 默认选中"
	echo "            (Target Profile 若为 Generic, 编出的镜像仍可用 sysupgrade 刷入)"
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
