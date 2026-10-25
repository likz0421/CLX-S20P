# CLX-S20P device recipe for OpenWrt 25.12 (official openwrt-25.12)
#
# Append this file to target/linux/mediatek/image/filogic.mk, or source it from
# there. Style copied from the official acer_predator-w6 block (also a
# tar-based sysupgrade.bin device on MT7986), so it matches upstream conventions.
#
# Notes on the parameters:
#   DEVICE_DTS_DIR  MUST be `../dts`.  This is the OpenWrt convention: the
#                  Device/Build/dtb rule compiles
#                    $(DEVICE_DTS_DIR)/$(DEVICE_DTS).dts
#                  with CWD = target/linux/<board>/image/, so `../dts` resolves
#                  to target/linux/mediatek/dts/ where apply.sh installs the
#                  ported mt7986a-clx-s20p.dts.
#                  *** 省略它并不会"默认成 ../dts" *** —— include/image.mk 的
#                  回退值是 $(DTS_DIR) = $(LINUX_DIR)/arch/arm64/boot/dts/
#                  mediatek/, 也就是**内核源码树里**的路径。我们只往
#                  target/linux/mediatek/dts/ 放过文件, 内核树里没有, 于是
#                  cpp 报 "No such file or directory", DTB 编不出来, 整个
#                  target/linux/install 失败 (Run 13 实测: cc1 fatal error)。
#                  上游所有 tar 型设备 (acer_predator-w6 等) 都显式写这一行。
#                  (厂商源码树用的是非标准 ../dts-ext, 官方 OpenWrt 没有。)
#   DEVICE_DTS_LOADADDR 0x47000000 is the value official MT7986 tar-based
#                  devices use. The vendor U-Boot env has loadaddr=0x46000000
#                  and the stock FIT used load=0x48000000 for the kernel; if the
#                  image fails to boot, try 0x46000000 / 0x48000000 first.
#   SUPPORTED_DEVICES  clx,s20p is the compatible string in the DTS root and
#                  what the vendor's stock firmware advertises, so a stock
#                  sysupgrade can be replaced by an official one and vice versa.
#   DEVICE_PACKAGES  mirrors the vendor's clx_s20-common (USB/NVMe/F2FS/EXT4/
#                  VFAT tooling). WiFi packages are deliberately NOT pinned
#                  here: pick them in the .config (mt76 for a pure-official
#                  build, or the MTK stack if you also ported package/mtk).
#                  `automount` 是厂商私有包, OpenWrt 25.12.6 的 feeds 里**没有**
#                  (已用 openwrt/packages @ 093d5516 全树核对过, 无此路径),
#                  会导致 per-device rootfs 的 apk 装包失败。改用官方等价物
#                  block-mount + blockd (package/system/fstools, "Block device
#                  automounting"), 行为一致。

define Device/clx_s20-common
  DEVICE_VENDOR := CLX
  DEVICE_DTS := mt7986a-clx-s20p
  DEVICE_DTS_DIR := ../dts
  DEVICE_DTS_LOADADDR := 0x47000000
  DEVICE_PACKAGES := kmod-usb3 kmod-mmc kmod-nvme \
    kmod-fs-f2fs kmod-fs-ext4 kmod-fs-vfat \
    mkf2fs f2fsck e2fsprogs blkid blockdev losetup \
    block-mount blockd
  KERNEL := kernel-bin | lzma | fit lzma $$(KDIR)/image-$$(firstword $$(DEVICE_DTS)).dtb
  KERNEL_INITRAMFS := kernel-bin | lzma | \
    fit lzma $$(KDIR)/image-$$(firstword $$(DEVICE_DTS)).dtb with-initrd | pad-to 64k
  IMAGES := sysupgrade.bin
  IMAGE/sysupgrade.bin := sysupgrade-tar | append-metadata
endef

define Device/clx_s20p
  $(call Device/clx_s20-common)
  DEVICE_MODEL := S20P
  SUPPORTED_DEVICES += clx,s20p
endef

TARGET_DEVICES += clx_s20p
