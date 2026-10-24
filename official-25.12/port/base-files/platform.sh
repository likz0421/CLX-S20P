# CLX-S20P sysupgrade case entries for OpenWrt 25.12
#
# apply.sh inserts these two entries into
# target/linux/mediatek/filogic/base-files/lib/upgrade/platform.sh:
#   * CHECK_ENTRY  -> into platform_check_image(), just before its `*)` default
#   * UPGRADE_ENTRY-> into platform_do_upgrade(), just before its `*)` default
#
# Why these exact forms:
#   * The ported recipe builds IMAGE/sysupgrade.bin := sysupgrade-tar |
#     append-metadata, i.e. a TAR archive. So the image check must test the tar
#     magic "ustar" at offset 257 — the same way official does for its other
#     tar-based MT7986 devices (hiveton,h5000m / nradio,c8-668gl).
#     fit_check_image would reject every image we build.
#   * The device boots eMMC from a GPT layout whose rootfs partition carries
#     PARTLABEL "rootfs" (see chosen/bootargs-append in the DTS), so official's
#     eMMC helper applies verbatim: CI_ROOTPART="rootfs" + emmc_do_upgrade.
#     That overwrites the rootfs partition by label and leaves
#     bl2/uboot-env/factory/fip/kernel untouched — the stock layout.

# ==== BEGIN CHECK_ENTRY ====
	clx,s20p)
		# tar magic `ustar`
		magic="$(dd if="$1" bs=1 skip=257 count=5 2>/dev/null)"

		[ "$magic" != "ustar" ] && {
			echo "Invalid image type."
			return 1
		}

		return 0
		;;
# ==== END CHECK_ENTRY ====

# ==== BEGIN UPGRADE_ENTRY ====
	clx,s20p)
		CI_ROOTPART="rootfs"
		emmc_do_upgrade "$1"
		;;
# ==== END UPGRADE_ENTRY ====
