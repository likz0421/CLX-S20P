'use strict';
'require baseclass';
'require ui';

/* 琉璃 Liuli — sidenav menu renderer
 * Renders the LuCI menu tree into the glass sidenav with line icons.
 */

const LIULI_ICONS = {
	grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
	chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15l4-6 4 4 4-8 6 10"/><path d="M3 21h18"/></svg>',
	file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v16H5z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
	gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0-.34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08c.26.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09c-.68 0-1.3.4-1.51 1.03Z"/></svg>',
	key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M17 6l3 3"/></svg>',
	box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/></svg>',
	play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/></svg>',
	disk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
	spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="4"/></svg>',
	clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
	share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/></svg>',
	plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v5"/></svg>',
	wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.5a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="1.2" fill="currentColor"/></svg>',
	shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5 4 6v6c0 4.6 3.4 7.4 8 9.5 4.6-2.1 8-4.9 8-9.5V6l-8-3.5Z"/></svg>',
	globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
	users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-8 0v2"/><circle cx="12" cy="7" r="4"/><path d="M5.5 21v-1.5a3.5 3.5 0 0 1 3-3.46M18.5 21v-1.5a3.5 3.5 0 0 0-3-3.46"/></svg>',
	dot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.5"/></svg>'
};

const LIULI_TITLE_MAP = {
	'状态': 'grid', 'status': 'grid', 'overview': 'grid', '概览': 'grid',
	'realtime': 'chart', '实时流量': 'chart', 'traffic': 'chart', 'load': 'chart', '负载': 'chart',
	'system log': 'file', '系统日志': 'file', 'kernel log': 'file', '内核日志': 'file', 'log': 'file', '日志': 'file',
	'system': 'gear', '系统': 'gear', 'settings': 'gear', 'router password': 'key',
	'administration': 'key', '管理权': 'key', 'admin': 'key', 'password': 'key',
	'software': 'box', '软件包': 'box', 'packages': 'box', 'package': 'box',
	'startup': 'play', '启动项': 'play', 'init': 'play',
	'mount points': 'disk', '挂载点': 'disk', 'disk': 'disk', 'disks': 'disk', 'storage': 'disk', '存储': 'disk',
	'lucky': 'spark', 'upnp': 'clock', 'network Shares': 'share', '网络共享': 'share', 'samba': 'share', 'shares': 'share',
	'interfaces': 'plug', '接口': 'plug', 'network': 'globe', '网络': 'globe', 'wan': 'plug', 'lan': 'plug',
	'wireless': 'wifi', '无线': 'wifi', 'wifi': 'wifi',
	'firewall': 'shield', '防火墙': 'shield', 'routes': 'globe', '路由': 'globe',
	'dhcp': 'globe', 'dns': 'globe', 'hostnames': 'globe', '主机名': 'globe', 'diagnostics': 'chart', '诊断': 'chart',
	'clients': 'users', '客户端': 'users', 'arp': 'users', 'online users': 'users', '在线客户端': 'users'
};

function liuliIcon(title) {
	const key = String(title || '').toLowerCase().trim();
	for (const k in LIULI_TITLE_MAP)
		if (key === k || key.indexOf(k) !== -1)
			return LIULI_ICONS[LIULI_TITLE_MAP[k]];
	return LIULI_ICONS.dot;
}

return baseclass.extend({
	__init__() {
		ui.menu.load().then((tree) => this.render(tree));
	},

	render(tree) {
		this.renderModeMenu(tree);
	},

	renderModeMenu(tree) {
		const ul = document.querySelector('#modemenu');
		const children = ui.menu.getChildren(tree);

		children.forEach((child, index) => {
			const isActive = L.env.requestpath.length
				? child.name === L.env.requestpath[0]
				: index === 0;

			ul.appendChild(E('li', { 'class': isActive ? 'active' : '' }, [
				E('a', { 'href': L.url(child.name) }, [ _(child.title) ])
			]));

			if (isActive)
				this.renderSidenav(child);
		});

		if (ul.children.length > 1)
			ul.style.display = '';

		if (L.env.dispatchpath.length >= 3) {
			let node = tree, url = '';
			for (let i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}
			if (node)
				this.renderTabMenu(node, url);
		}
	},

	renderSidenav(mode) {
		const nav = document.querySelector('#liuli-nav');
		if (!nav)
			return;

		ui.menu.getChildren(mode).forEach(cat => {
			nav.appendChild(E('div', { 'class': 'group-label' }, [
				E('span', { 'class': 't' }, [ _(cat.title) ])
			]));

			ui.menu.getChildren(cat).forEach(page => {
				const active = (L.env.dispatchpath[1] === cat.name && L.env.dispatchpath[2] === page.name);

				const a = E('a', {
					'class': active ? 'active' : '',
					'href': L.url(mode.name, cat.name, page.name),
					'title': _(page.title)
				});

				a.insertAdjacentHTML('beforeend', liuliIcon(page.title));
				a.appendChild(E('span', { 'class': 't' }, [ _(page.title) ]));
				nav.appendChild(a);

				/* 二级页面缩进展示 */
				if (page.children) {
					ui.menu.getChildren(page).forEach(sub => {
						const subActive = active && L.env.dispatchpath[3] === sub.name;
						const sa = E('a', {
							'class': 'sub' + (subActive ? ' active' : ''),
							'href': L.url(mode.name, cat.name, page.name, sub.name),
							'title': _(sub.title)
						}, [ E('span', { 'class': 't' }, [ _(sub.title) ]) ]);
						nav.appendChild(sa);
					});
				}
			});
		});

		nav.style.display = '';
	},

	renderTabMenu(tree, url, level) {
		const container = document.querySelector('#tabmenu');
		if (!container)
			return;

		const ul = E('ul', { 'class': 'tabs' });
		const children = ui.menu.getChildren(tree);

		children.forEach(child => {
			const isActive = (L.env.dispatchpath[3 + (level || 0)] == child.name);
			ul.appendChild(E('li', { 'class': isActive ? 'active' : '' }, [
				E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ])
			]));
		});

		if (ul.children.length == 0)
			return;

		container.appendChild(ul);
		container.style.display = '';
	}
});
