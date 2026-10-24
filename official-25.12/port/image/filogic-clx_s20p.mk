# CLX-S20P device recipe for OpenWrt 25.12 (official openwrt-25.12)
#
# Append this file to target/linux/mediatek/image/filogic.mk, or source it from
# there. Style copied from the official acer_predator-w6 block (also a
# tar-based sysupgrade.bin device on MT7986), so it matches upstream conventions.
#
# Notes on the parameters:
#   DEVICE_DTS_DIR  omitted -> OpenWrt defaults to ../dts, which is where the
#                  ported mt7986a-clx-s20p.dts lives. (The vendor tree used a
#                  non-standard ../dts-ext, which official does not have.)
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

define Device/clx_s20-common
  DEVICE_VENDOR := CLX
  DEVICE_DTS := mt7986a-clx-s20p
  DEVICE_DTS_LOADADDR := 0x47000000
  DEVICE_PACKAGES := kmod-usb3 kmod-mmc kmod-nvme \
    kmod-fs-f2fs kmod-fs-ext4 kmod-fs-vfat \
    mkf2fs f2fsck e2fsprogs blkid blockdev losetup automount
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
