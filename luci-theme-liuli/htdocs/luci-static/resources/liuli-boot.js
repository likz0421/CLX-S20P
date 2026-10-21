'use strict';
/* 琉璃 Liuli — 主题色调首屏预置
 * 必须在 cascade.css 之前同步执行, 避免夜间模式闪白。
 * 配置由模板注入到 window.LIULI_BOOT = { n: 夜间开始小时, e: 夜间结束小时, f: 强制模式 }。
 * 判定逻辑与 resources/liuli-theme.js 的 resolve() 保持一致, 避免首屏与运行时分歧。
 */
(function () {
	var KEY = 'liuli.theme';
	var cfg = window.LIULI_BOOT || {};
	var NIGHT_START = (typeof cfg.n === 'number') ? cfg.n : 19;
	var NIGHT_END = (typeof cfg.e === 'number') ? cfg.e : 7;
	var FORCE = cfg.f || 'auto';

	function resolve(pref) {
		if (pref === 'light' || pref === 'dark')
			return pref;
		if (pref === 'system') {
			try {
				return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
			} catch (e) { return 'light'; }
		}
		/* auto: 按夜间时段优先, 否则跟随系统配色 */
		var h = new Date().getHours();
		if (h >= NIGHT_START || h < NIGHT_END)
			return 'dark';
		try {
			if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
				return 'dark';
		} catch (e) {}
		return 'light';
	}

	/* 偏好来源: 设置页锁定 > 本地存储 > 默认 auto */
	var pref;
	if (FORCE === 'light' || FORCE === 'dark')
		pref = FORCE;
	else if (FORCE === 'system')
		pref = 'system';
	else {
		pref = 'auto';
		try { pref = localStorage.getItem(KEY) || 'auto'; } catch (e) {}
	}

	var mode = resolve(pref);
	var r = document.documentElement;
	r.setAttribute('data-liuli-theme', mode);
	r.setAttribute('data-liuli-pref', pref);
	r.setAttribute('data-liuli-force', FORCE);
	r.setAttribute('data-liuli-night-start', NIGHT_START);
	r.setAttribute('data-liuli-night-end', NIGHT_END);
})();
