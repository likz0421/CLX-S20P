#
# 琉璃看板 — LuCI device dashboard for the Liuli theme
# 设备列表 / 类型识别 / 连接状态 / 今日流量排行
# Copyright 2026 likz0421
# Licensed under the Apache License 2.0
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-liuli
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=likz0421
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-liuli
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=Liuli Device Dashboard (琉璃看板)
  DEPENDS:=+luci-base +rpcd +nftables
  URL:=https://github.com/likz0421
endef

define Package/luci-app-liuli/description
  Device dashboard: online clients with vendor/type identification
  (phone / laptop / TV / NAS / IoT icons), wired or wireless status,
  signal strength, today's per-device traffic ranking via nftables
  accounting. Companion app for the Liuli glassmorphism theme.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/luci-app-liuli/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/liuli
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/liuli/dashboard.js $(1)/www/luci-static/resources/view/liuli/
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/liuli.css $(1)/www/luci-static/resources/view/
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/liuli/brands
	$(CP) ./htdocs/luci-static/resources/view/liuli/brands/* $(1)/www/luci-static/resources/view/liuli/brands/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/ucode
	$(INSTALL_DATA) ./root/usr/share/rpcd/ucode/luci.liuli $(1)/usr/share/rpcd/ucode/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-liuli.json $(1)/usr/share/rpcd/acl.d/
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-liuli.json $(1)/usr/share/luci/menu.d/
endef

define Package/luci-app-liuli/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/rpcd restart >/dev/null 2>&1 || true
exit 0
endef

$(eval $(call BuildPackage,luci-app-liuli))
