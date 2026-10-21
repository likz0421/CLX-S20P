/* 琉璃 Liuli — 主题色调控制
 * 三态: auto (按 19:00-07:00 自动夜间切换) / light / dark
 * 偏好存 localStorage, head.ut 里的内联脚本负责首屏预置, 本文件负责交互与跨点巡检。
 */
'use strict';

(function () {
	const KEY = 'liuli.theme';
	const ORDER = [ 'auto', 'system', 'light', 'dark' ];
	const LABEL = { auto: '自动', system: '跟随系统', light: '日间', dark: '夜间' };

	/* 夜间时段与强制模式由 head.ut 从 /etc/config/liuli 注入到 <html> 属性上 */
	function nightRange() {
		const r = document.documentElement;
		const s = parseInt(r.getAttribute('data-liuli-night-start'), 10);
		const e = parseInt(r.getAttribute('data-liuli-night-end'), 10);
		return [ isNaN(s) ? 19 : s, isNaN(e) ? 7 : e ];
	}

	function forced() {
		const f = document.documentElement.getAttribute('data-liuli-force');
		return (f == 'light' || f == 'dark') ? f : null;
	}

	function getPref() {
		try { return localStorage.getItem(KEY) || 'auto'; }
		catch (e) { return 'auto'; }
	}

	function setPref(p) {
		try {
			if (p && p !== 'auto')
				localStorage.setItem(KEY, p);
			else
				localStorage.removeItem(KEY);
		} catch (e) {}
	}

	function resolve(pref) {
		const f = forced();
		if (f)
			return f;

		if (pref == 'dark' || pref == 'light')
			return pref;

		/* 跟随系统: 只看 prefers-color-scheme, 不受时间段影响 (借鉴 argon normal 模式) */
		if (pref == 'system') {
			try {
				return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
			} catch (e) {
				return 'light';
			}
		}

		const h = new Date().getHours();
		const r = nightRange();

		if (h >= r[0] || h < r[1])
			return 'dark';

		try {
			if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
				return 'dark';
		} catch (e) {}

		return 'light';
	}

	/* 同步浏览器地址栏/状态栏配色 (借鉴 argon 的 theme-color 设置) */
	function updateThemeColor() {
		try {
			const c = getComputedStyle(document.documentElement).getPropertyValue('--liuli-primary').trim();
			let meta = document.querySelector('meta[name="theme-color"]');
			if (!c)
				return;
			if (!meta) {
				meta = document.createElement('meta');
				meta.setAttribute('name', 'theme-color');
				document.head.appendChild(meta);
			}
			meta.setAttribute('content', c);
		} catch (e) {}
	}

	function syncButtons() {
		const pref = getPref();
		const mode = document.documentElement.getAttribute('data-liuli-theme');
		const nodes = document.querySelectorAll('[data-liuli-toggle]');
		const f = forced();

		for (let i = 0; i < nodes.length; i++) {
			const el = nodes[i];

			/* 设置页里已强制锁定日间/夜间, 顶栏按钮不再显示 */
			if (f) {
				el.style.display = 'none';
				continue;
			}

			el.setAttribute('title', '主题: ' + LABEL[pref] + ' (当前' + LABEL[mode] + ') — 点击切换');
			el.setAttribute('aria-label', el.getAttribute('title'));

			const lb = el.querySelector('.liuli-theme-label');
			if (lb)
				lb.textContent = LABEL[pref] + ' · ' + LABEL[mode];
		}
	}

	function apply() {
		const pref = getPref();
		const r = document.documentElement;
		r.setAttribute('data-liuli-pref', pref);
		r.setAttribute('data-liuli-theme', resolve(pref));
		syncButtons();
		updateThemeColor();
	}

	function cycle(ev) {
		if (ev) {
			ev.preventDefault();
			ev.stopPropagation();
		}
		const cur = getPref();
		setPref(ORDER[(ORDER.indexOf(cur) + 1 + ORDER.length) % ORDER.length]);
		apply();
	}

	/* 供 onclick 直接调用 */
	window.liuliThemeToggle = cycle;

	document.addEventListener('click', function (ev) {
		const t = ev.target.closest ? ev.target.closest('[data-liuli-toggle]') : null;
		if (t)
			cycle(ev);
	});

	/* 系统主题变化时即时跟随 (仅在 auto 模式) */
	try {
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const onChange = function () { apply(); };
		if (mq.addEventListener)
			mq.addEventListener('change', onChange);
		else if (mq.addListener)
			mq.addListener(onChange);
	} catch (e) {}

	/* ---------- 移动端抽屉: 遮罩 + 点外部关闭 + ESC 关闭 ---------- */

	function setupDrawer() {
		const nav = document.getElementById('mainmenu');
		if (!nav)
			return;

		let backdrop = document.querySelector('.liuli-navbackdrop');
		if (!backdrop) {
			backdrop = document.createElement('div');
			backdrop.className = 'liuli-navbackdrop';
			document.body.appendChild(backdrop);
		}

		const sync = () => backdrop.classList.toggle('show', nav.classList.contains('open'));
		const close = () => nav.classList.remove('open');

		backdrop.addEventListener('click', close);

		document.addEventListener('keydown', (ev) => {
			if (ev.key == 'Escape')
				close();
		});

		/* 侧栏类名变化同步到遮罩 */
		if (window.MutationObserver)
			new MutationObserver(sync).observe(nav, { attributes: true, attributeFilter: [ 'class' ] });
		else
			window.setInterval(sync, 200);

		/* 点击导航项后自动收起抽屉 (移动端) */
		nav.addEventListener('click', (ev) => {
			if (ev.target.closest && ev.target.closest('a') && window.matchMedia('(max-width: 980px)').matches)
				close();
		});

		/* 视口变宽时自动收起, 避免残留遮罩挡住页面 */
		const mq = window.matchMedia('(min-width: 981px)');
		const onWide = () => { if (mq.matches) close(); };
		if (mq.addEventListener)
			mq.addEventListener('change', onWide);
		else if (mq.addListener)
			mq.addListener(onWide);

		sync();
	}

	/* ---------- 侧栏折叠 (记忆到 localStorage) ---------- */

	function setupCollapse() {
		const KEY = 'liuli.nav.collapsed';
		let collapsed = false;

		try { collapsed = localStorage.getItem(KEY) === '1'; }
		catch (e) {}

		const apply = () => document.body.classList.toggle('liuli-nav-collapsed', collapsed);

		apply();

		const btn = document.getElementById('liuli-collapse');
		if (btn)
			btn.addEventListener('click', () => {
				collapsed = !collapsed;
				try { localStorage.setItem(KEY, collapsed ? '1' : '0'); }
				catch (e) {}
				apply();
			});
	}

	/* ---------- 顶栏滚动紧凑态 ---------- */

	function setupScrollState() {
		const onScroll = () => {
			const y = window.scrollY || document.documentElement.scrollTop || 0;
			document.body.classList.toggle('liuli-scrolled', y > 8);
		};

		window.addEventListener('scroll', onScroll, { passive: true });
		onScroll();
	}

	/* ---------- 滚动进入节奏 (IntersectionObserver) ---------- */

	function setupReveal() {
		if (!('IntersectionObserver' in window))
			return;

		try {
			if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
				return;
		} catch (e) {}

		const SEL = '.liuli-card, .cbi-map, .ll-card';

		const io = new IntersectionObserver((entries) => {
			let n = 0;
			for (const e of entries) {
				if (!e.isIntersecting)
					continue;
				const el = e.target;
				io.unobserve(el);
				/* 同批元素错开 60ms 依次进入, 最多错开 8 个 */
				window.setTimeout(() => el.classList.add('liuli-in'), Math.min(n++, 8) * 60);
			}
		}, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });

		let timer = null;

		const scan = () => {
			const nodes = document.querySelectorAll(SEL);
			for (let i = 0; i < nodes.length; i++) {
				const el = nodes[i];
				if (el.classList.contains('liuli-reveal'))
					continue;
				el.classList.add('liuli-reveal');
				io.observe(el);
			}
		};

		scan();

		/* LuCI 视图是异步渲染的, 内容变化后要重新扫描 */
		const mc = document.getElementById('maincontent');
		if (mc && window.MutationObserver) {
			const mo = new MutationObserver(() => {
				window.clearTimeout(timer);
				timer = window.setTimeout(scan, 120);
			});
			mo.observe(mc, { childList: true, subtree: true });
		}
	}

	/* ---------- 移动端底部快捷栏 ---------- */

	const TAB_ICONS = {
		'状态': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
		'系统': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/></svg>',
		'网络': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
		'服务': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/></svg>',
		'NAS': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
		'_': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.5"/></svg>'
	};

	function setupTabbar() {
		if (document.querySelector('.liuli-tabbar'))
			return;

		const bar = document.createElement('nav');
		bar.className = 'liuli-tabbar';
		document.body.appendChild(bar);

		const build = () => {
			const src = document.getElementById('modemenu');
			if (!src || !src.children.length)
				return false;

			bar.innerHTML = '';

			for (let i = 0; i < src.children.length; i++) {
				const li = src.children[i];
				const a = li.querySelector('a');
				if (!a)
					continue;

				const label = (li.textContent || '').trim();
				const item = document.createElement('a');
				item.href = a.getAttribute('href') || '#';
				item.innerHTML = TAB_ICONS[label] || TAB_ICONS._;

				const s = document.createElement('span');
				s.textContent = label;
				item.appendChild(s);

				if (li.classList.contains('active'))
					item.classList.add('active');

				bar.appendChild(item);
			}
			return bar.children.length > 0;
		};

		if (!build()) {
			const host = document.getElementById('modemenu') || document.body;
			if (window.MutationObserver) {
				const mo = new MutationObserver(() => { if (build()) mo.disconnect(); });
				mo.observe(host, { childList: true, subtree: true });
			}
		}
	}

	const boot = function () {
		apply();
		setupDrawer();
		setupCollapse();
		setupScrollState();
		setupReveal();
		setupTabbar();
	};

	if (document.readyState == 'loading')
		document.addEventListener('DOMContentLoaded', boot);
	else
		boot();

	/* 自动模式下每分钟巡检一次, 跨过 19:00 / 07:00 时自动换肤 */
	window.setInterval(function () {
		if (getPref() == 'auto' && document.documentElement.getAttribute('data-liuli-theme') != resolve('auto'))
			apply();
	}, 60000);
})();
