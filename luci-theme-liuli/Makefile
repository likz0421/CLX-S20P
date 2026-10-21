#
# 琉璃 Liuli — LuCI glassmorphism theme
# Copyright 2026 likz0421
# Licensed under the Apache License 2.0
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-liuli
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=likz0421
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/luci-theme-liuli
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=4. Themes
  TITLE:=Liuli (琉璃) Glassmorphism Theme
  DEPENDS:=+luci-base
  URL:=https://github.com/likz0421
endef

define Package/luci-theme-liuli/description
  A light glassmorphism LuCI theme: frosted panels, drifting gradient
  light blobs, hairline highlights, and a status topbar with device
  name, online clients, CPU, temperature, live traffic and clock.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/luci-theme-liuli/install
	$(INSTALL_DIR) $(1)/www/luci-static/liuli
	$(CP) ./htdocs/luci-static/liuli/* $(1)/www/luci-static/liuli/
	$(INSTALL_DIR) $(1)/www/luci-static/resources
	$(INSTALL_DATA) ./htdocs/luci-static/resources/*.js $(1)/www/luci-static/resources/
	# 主题设置页 (系统 → 琉璃主题设置)
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/liuli
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/liuli/*.js $(1)/www/luci-static/resources/view/liuli/
	$(INSTALL_DIR) $(1)/usr/share/ucode/luci/template/themes/liuli
	$(INSTALL_DATA) ./ucode/template/themes/liuli/*.ut $(1)/usr/share/ucode/luci/template/themes/liuli/
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-theme-liuli.json $(1)/usr/share/luci/menu.d/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-theme-liuli.json $(1)/usr/share/rpcd/acl.d/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/ucode
	$(INSTALL_DATA) ./root/usr/share/rpcd/ucode/luci.liuli-theme $(1)/usr/share/rpcd/ucode/
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./root/etc/config/liuli $(1)/etc/config/liuli
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./root/etc/uci-defaults/30_luci-theme-liuli $(1)/etc/uci-defaults/
endef

define Package/luci-theme-liuli/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* 2>/dev/null
	/etc/init.d/rpcd restart >/dev/null 2>&1
}
exit 0
endef

$(eval $(call BuildPackage,luci-theme-liuli))
