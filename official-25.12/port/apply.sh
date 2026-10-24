#!/usr/bin/env bash
# Apply the CLX-S20P port to an OpenWrt 25.12 tree (official openwrt-25.12).
#
# Usage:
#   ./apply.sh /path/to/openwrt
#
# What it does (all steps are verified, and it is safe to re-run):
#   1. copy dts/mt7986a-clx-s20p.dts  -> target/linux/mediatek/dts/
#   2. append image/filogic-clx_s20p.mk -> target/linux/mediatek/image/filogic.mk
#   3. insert the 02_network case entry into filogic base-files board.d/02_network
#   4. insert the 01_leds   case entry into filogic base-files board.d/01_leds
#   5. insert the two platform.sh case entries (check + do_upgrade)
#
# Every step prints what it did and refuses to double-apply.

set -euo pipefail

PORT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TREE="${1:?usage: apply.sh /path/to/openwrt}"

if [ ! -f "$TREE/include/version.mk" ]; then
	echo "::error:: $TREE 不是 OpenWrt 源码树 (缺少 include/version.mk)" >&2
	exit 1
fi

ok()   { echo "  [ok]   $1"; }
skip() { echo "  [skip] $1 (已应用)"; }

insert_case_entry() {  # insert_case_entry <file> <anchor> <snippet-file> <label>
	# anchor is the literal line to insert AFTER. For 02_network the case sits
	# inside mediatek_setup_interfaces(), for 01_leds it is top-level; both are
	# `case $board in`, and the first occurrence in the file is the right one.
	local file="$1" anchor="$2" snip="$3" label="$4"
	if grep -q "clx,s20p)" "$file"; then
		skip "$label"
		return 0
	fi
	"${PYTHON:-python3}" - "$file" "$anchor" "$snip" <<'PYEOF'
import sys
path, anchor, snipfile = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path, encoding="utf-8").read().split("\n")
snippet = open(snipfile, encoding="utf-8").read().rstrip("\n")
for i, ln in enumerate(lines):
	if anchor in ln:
		lines.insert(i + 1, snippet)
		break
else:
	sys.exit(f"anchor {anchor!r} not found")
open(path, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
PYEOF
	ok "$label"
}

echo "==> 目标树: $TREE"

# ---- 1. DTS -------------------------------------------------------------
DTS_DST="$TREE/target/linux/mediatek/dts/mt7986a-clx-s20p.dts"
if [ -f "$DTS_DST" ]; then
	skip "DTS"
else
	cp "$PORT_DIR/dts/mt7986a-clx-s20p.dts" "$DTS_DST"
	ok "DTS -> target/linux/mediatek/dts/mt7986a-clx-s20p.dts"
fi

# ---- 2. 设备配方 --------------------------------------------------------
MK="$TREE/target/linux/mediatek/image/filogic.mk"
if grep -q "define Device/clx_s20p" "$MK"; then
	skip "设备配方"
else
	printf '\n# --- CLX-S20P (ported for OpenWrt 25.12) ---\n' >> "$MK"
	cat "$PORT_DIR/image/filogic-clx_s20p.mk" >> "$MK"
	ok "设备配方 -> target/linux/mediatek/image/filogic.mk"
fi

# ---- 3. 02_network ------------------------------------------------------
BF="$TREE/target/linux/mediatek/filogic/base-files/etc/board.d/02_network"
if [ ! -f "$BF" ]; then
	echo "::error:: $BF 不存在" >&2
	exit 1
fi
insert_case_entry "$BF" 'case $board in' \
	"$PORT_DIR/base-files/02_network" "02_network case 条目"

# ---- 4. 01_leds ---------------------------------------------------------
LED="$TREE/target/linux/mediatek/filogic/base-files/etc/board.d/01_leds"
if [ ! -f "$LED" ]; then
	echo "::error:: $LED 不存在 (官方 filogic 未提供 01_leds), 需手动创建" >&2
	exit 1
fi
insert_case_entry "$LED" 'case $board in' \
	"$PORT_DIR/base-files/01_leds" "01_leds case 条目"

# ---- 5. platform.sh -----------------------------------------------------
PS="$TREE/target/linux/mediatek/filogic/base-files/lib/upgrade/platform.sh"
if grep -q "clx,s20p)" "$PS"; then
	skip "platform.sh"
else
	"${PYTHON:-python3}" - "$PS" "$PORT_DIR/base-files/platform.sh" <<'PYEOF'
import sys
ps, snipfile = sys.argv[1], sys.argv[2]
text = open(ps, encoding="utf-8").read()
snip = open(snipfile, encoding="utf-8").read()

def block(tag):
	s = snip.index(f"# ==== BEGIN {tag} ====")
	e = snip.index(f"# ==== END {tag} ====")
	return snip[snip.index("\n", s) + 1:e].rstrip("\n")

def insert_into(fn_name, entry):
	"""insert entry just before the `*)` default of a function's case"""
	i = text.index(fn_name + "()")
	j = text.index("*)", i)
	return text[:j] + entry + "\n\n" + text[j:]

text = insert_into("platform_check_image", block("CHECK_ENTRY"))
text = insert_into("platform_do_upgrade", block("UPGRADE_ENTRY"))
open(ps, "w", encoding="utf-8", newline="\n").write(text)
print("  [ok]   platform.sh 两个 case 条目")
PYEOF
fi

# ---- 校验 ---------------------------------------------------------------
echo
echo "==> 应用后校验"
grep -q 'compatible = "clx,s20p"' "$DTS_DST" && ok "DTS compatible = clx,s20p" || { echo "::error:: DTS 内容异常"; exit 1; }
grep -q "TARGET_DEVICES += clx_s20p" "$MK" && ok "TARGET_DEVICES += clx_s20p" || { echo "::error:: 配方未生效"; exit 1; }
grep -q "clx,s20p)" "$BF" && ok "02_network 已含 clx,s20p" || { echo "::error:: 02_network 未生效"; exit 1; }
grep -q "clx,s20p)" "$LED" && ok "01_leds 已含 clx,s20p" || { echo "::error:: 01_leds 未生效"; exit 1; }
grep -q "CI_ROOTPART=\"rootfs\"" "$PS" && ok "platform.sh emmc 升级路径" || { echo "::error:: platform.sh 未生效"; exit 1; }

echo
echo "完成。接下来:"
echo "  cd $TREE"
echo "  ./scripts/feeds update -a && ./scripts/feeds install -a"
echo "  make menuconfig   # 选 Target: MediaTek ARMv8 (Filogic) -> CLX S20P"
echo "  make -j\$(nproc)"
