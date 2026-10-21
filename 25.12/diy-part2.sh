#!/bin/bash
#
# CLX-S20P — ImmortalWrt 25.12 DIY part2 (配置定型 + 硬校验)
#
set -eo pipefail

echo "==================== diy-part2: 开始 ===================="

# ---------------------------------------------------------
# 1. 版本号写入构建日期
# ---------------------------------------------------------
BUILD_DATE="$(date +%Y%m%d)"
sed -i "s/^CONFIG_VERSION_CODE=.*/CONFIG_VERSION_CODE=\"${BUILD_DATE}\"/" .config
grep -E "^CONFIG_VERSION_(DIST|NUMBER|CODE)=" .config || true

# ---------------------------------------------------------
# 2. 解析依赖 / 裁剪无效项
# ---------------------------------------------------------
make defconfig

# ---------------------------------------------------------
# 3. 硬校验: 关键包必须真的留在 .config 里
#    (否则会编出一个"什么都没装"的绿灯固件)
# ---------------------------------------------------------
echo "-------------------- 关键包校验 --------------------"
MISSING=0
for pkg in luci-theme-liuli luci-app-liuli lucky luci-app-lucky; do
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

if [ "$MISSING" = "1" ]; then
	echo "::error::关键包未进入 .config, 拒绝继续编译"
	grep -E "CONFIG_PACKAGE_(luci-theme-liuli|luci-app-liuli|lucky|luci-app-lucky)=" .config || true
	exit 1
fi

# ---------------------------------------------------------
# 4. 打印最终主题 / 关键选择
# ---------------------------------------------------------
echo "-------------------- 主题 & 关键选择 --------------------"
grep -E "^CONFIG_PACKAGE_luci-theme-" .config || true
echo
echo "-------------------- 目标设备 --------------------"
grep -E "^CONFIG_TARGET_(BOARD|SUBTARGET)=|^CONFIG_TARGET_DEVICE_mediatek" .config | head -5

echo "==================== diy-part2: 完成 ===================="
