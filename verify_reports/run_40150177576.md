## Verify report (run 40150177576)

```
[*] bin/targets/mediatek/filogic/s20p-25.12.6-20261025-mediatek-filogic-clx_s20p-squashfs-sysupgrade.bin: 46868744 bytes, sha256 = b4acd4ee80dce5daf2c9c675a88aa8952ec1c3f1337c6dea8bea6a17e4d9f562
[*] hsqs @ 4520448
[*] indexed 5777 files

[1] 崩溃根因复核 — 所有出厂 ucode 源码 (.ut / .uc / rpcd)
  [PASS] 扫描 22 模板 + 44 控制器 + 2 rpcd 脚本, 违规 0

[1b] POSIX ERE 复核 — 所有出厂 ucode 源码
  [PASS] 扫描 103 条正则, 逆序字符范围 0

[2] clx_s20p 设备与 Argon 主题
  [PASS] sysupgrade tar CONTROL = BOARD=clx_s20p
  [PASS] board.d/02_network 含 clx_s20p 条目
  [PASS] platform.sh 含 clx_s20p 升级路径
  [PASS] platform.sh 用 eMMC rootfs 分区升级
  [PASS] Argon 11 个模板齐全
  [PASS] head.ut 非空 — 4952 chars
  [PASS] head.ut 无裸 String()
  [PASS] Argon CSS 已打进镜像 — 267675 chars
  [PASS] Argon 设置页 — /www/luci-static/resources/view/argon-config.js
  [PASS] Argon 配置 — /etc/config/argon
  [PASS] Argon 图标 — /www/luci-static/argon/img/argon.svg

[3] Lucky 与 UPnP
  [PASS] lucky 核心二进制 — /usr/bin/lucky
  [PASS] lucky 配置 — /etc/config/lucky
  [PASS] lucky 启动脚本 — /etc/init.d/lucky
  [PASS] miniupnpd 守护进程 — /usr/sbin/miniupnpd
  [PASS] UPnP 配置 — /etc/config/upnpd
  [PASS] UPnP LuCI 页面 — /www/luci-static/resources/view/upnp/upnp.js
  [PASS] lucky LuCI 页面 — /www/luci-static/resources/view/lucky/config-3_0_0-26.js, /www/luci-static/resources/view/lucky/legacy-3_0_0-26.js

[4] 默认主题
  [PASS] mediaurlbase = /luci-static/argon

[4b] apk 安装库共 454 个包
      kmod-mt76 = 6.12.112.2026.03.19~39c960c3-r3
      kmod-mt76-connac = 6.12.112.2026.03.19~39c960c3-r3
      kmod-mt76-core = 6.12.112.2026.03.19~39c960c3-r3
      kmod-mt7603 = 6.12.112.2026.03.19~39c960c3-r3
      kmod-mt76x02-common = 6.12.112.2026.03.19~39c960c3-r3
      kmod-mt76x2 = 6.12.112.2026.03.19~39c960c3-r3
      kmod-mt76x2-common = 6.12.112.2026.03.19~39c960c3-r3
      kmod-mt7915-firmware = 6.12.112.2026.03.19~39c960c3-r3
      kmod-mt7915e = 6.12.112.2026.03.19~39c960c3-r3
      kmod-mt7986-firmware = 6.12.112.2026.03.19~39c960c3-r3
      luci-app-lucky = 3.0.0-r26
      luci-app-upnp = 26.288.56989~75a306d
      luci-theme-argon = 3.1.0-r20261022
      lucky = 3.3.3-r1
      miniupnpd-nftables = 2.3.9-r1
      mt7986-wo-firmware = 20260221-r1

[5] WiFi 栈
  [PASS] 已安装 kmod-mt76 — 6.12.112.2026.03.19~39c960c3-r3
  [PASS] 已安装 kmod-mt7915e — 6.12.112.2026.03.19~39c960c3-r3
  [PASS] 已安装 kmod-mt7915-firmware — 6.12.112.2026.03.19~39c960c3-r3
  [PASS] 已安装 kmod-mt7986-firmware — 6.12.112.2026.03.19~39c960c3-r3
  [PASS] 已安装 mt7986-wo-firmware — 20260221-r1
  [PASS] MTK 专有栈未混入 (0 个)

[6] 裸 getspnam 扫描
  [PASS] 裸 getspnam 模板数 = 0

[7] 版本
      DISTRIB_ID='S20P'
      DISTRIB_RELEASE='25.12.6'
      DISTRIB_REVISION='r33311-981c978eff'
      DISTRIB_TARGET='mediatek/filogic'
      DISTRIB_ARCH='aarch64_cortex-a53'
      DISTRIB_DESCRIPTION='S20P 25.12.6 20261025'
      DISTRIB_TAINTS='no-all busybox'
  [PASS] 目标 = mediatek/filogic
  [PASS] DISTRIB_RELEASE = 25.12.6 (期望 25.12.6)
  [PASS] 版本号不含 SNAPSHOT (25.12.6)

[8] 已下线插件复查
  [PASS] 已下线包复活 0 个
  [PASS] liuli/smartdns/lxc 路径残留 0 处

================================================================
独立复验全部通过 ✓  (clx_s20p + Argon + lucky + UPnP, 官方 25.12.6, 无残留)
================================================================
```
