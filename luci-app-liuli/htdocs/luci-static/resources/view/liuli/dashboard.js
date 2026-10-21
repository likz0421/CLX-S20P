'use strict';
'require view';
'require rpc';
'require poll';
'require dom';
'require ui';

/* 琉璃看板 — Liuli router dashboard
 * 机器概况 / 系统状态 / 服务徽标 / 网络与无线 / 存储 /
 * 设备看板(品牌 logo + 今日流量排行) / 系统日志
 *
 * 注意: LuCI 的 rpc.declare({ expect }) 只使用 expect 的第一个 key,
 * 并且会用该 key 下钻返回值 (ret = ret[key])。要保留完整返回对象
 * 必须写成 expect: { '': {} }。
 */

const callDevices = rpc.declare({
	object: 'luci.liuli',
	method: 'getDevices',
	expect: { '': {} }
});

const callSystem = rpc.declare({
	object: 'luci.liuli',
	method: 'getSystem',
	expect: { '': {} }
});

const callLog = rpc.declare({
	object: 'luci.liuli',
	method: 'getLog',
	params: [ 'lines' ],
	expect: { '': {} }
});

/* Open-Box 风格的外网延迟探测 */
const callPing = rpc.declare({
	object: 'luci.liuli',
	method: 'ping',
	params: [ 'targets' ],
	expect: { '': {} }
});

/* 默认探测目标: 国内 DNS + 两家大厂域名, 直观反映出口质量 */
const PING_TARGETS = [ '223.5.5.5', 'baidu.com', 'qq.com' ];

/* LuCI 的 dom.append() 会把 children 数组里的 null / undefined 渲染成字面
 * 文本 "null" (它误判了 children 本身而非 children[i])。这里包一层,
 * 在交给 E() 之前把空项过滤掉。 */
const EE = function(tag, attrs, children) {
	const list = Array.isArray(children)
		? children
		: (children == null ? [] : [ children ]);
	return E(tag, attrs, list.filter((c) => c != null && c !== false && c !== ''));
};

/* ---------- 响应式 SVG 迷你图 (借鉴 argon-graphs 的 viewBox 缩放技巧) ---------- */

const svgWrap = function(markup) {
	const s = E('span', { 'style': 'display:inline-flex;line-height:0' });
	s.innerHTML = markup;
	return s;
};

function buildPoints(values, w, h, pad) {
	if (!values.length)
		return '';
	const max = Math.max.apply(null, values.concat([1]));
	const min = Math.min.apply(null, values.concat([0]));
	const span = (max - min) || 1;
	return values.map((v, i) => {
		const x = (values.length === 1 ? w : (i / (values.length - 1)) * w);
		const y = h - pad - ((v - min) / span) * (h - 2 * pad);
		return x.toFixed(1) + ',' + y.toFixed(1);
	}).join(' ');
}

/* 极简 sparkline: 透明背景 + 单色折线
 * 无采样时画一条虚线基线, 避免卡片看起来像坏了 (仍保持 viewBox 以防塌陷) */
function sparkSvg(values, color, w, h) {
	const pts = buildPoints(values, w, h, 2);
	const box = 'viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"';
	if (!pts)
		return '<svg width="' + w + '" height="' + h + '" ' + box + '>' +
			'<line x1="0" y1="' + (h / 2) + '" x2="' + w + '" y2="' + (h / 2) +
			'" stroke="' + color + '" stroke-width="1.8" stroke-dasharray="3 4" opacity=".5"/></svg>';
	return '<svg width="' + w + '" height="' + h + '" ' + box + '>' +
		'<polyline points="' + pts + '" fill="none" stroke="' + color +
		'" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';
}

/* 面积图: 填充 + 折线, 宽度 100% 自适应容器 (viewBox 保持比例) */
function areaSvg(values, color, w, h) {
	const pts = buildPoints(values, w, h, 5);
	const box = 'viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"';
	if (!pts)
		return '<svg width="100%" height="' + h + '" ' + box + '>' +
			'<line x1="0" y1="' + (h / 2) + '" x2="' + w + '" y2="' + (h / 2) +
			'" stroke="' + color + '" stroke-width="1.6" stroke-dasharray="3 4" opacity=".5"/></svg>';
	const area = '0,' + h + ' ' + pts + ' ' + w + ',' + h;
	return '<svg width="100%" height="' + h + '" ' + box + '>' +
		'<polygon points="' + area + '" fill="' + color + '22"/>' +
		'<polyline points="' + pts + '" fill="none" stroke="' + color +
		'" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>';
}

/* ---------- 设备类型图标 (1.7px 线性) ---------- */

const TYPE_ICONS = {
	phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 5.5h3"/></svg>',
	tablet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M10.5 19h3"/></svg>',
	laptop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4.5" width="16" height="11" rx="2"/><path d="M2 19h20l-2-2.5H4L2 19z"/></svg>',
	desktop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M9 20.5h6M12 16.5v4"/></svg>',
	tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="13" rx="2"/><path d="M8 21.5h8"/></svg>',
	nas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/></svg>',
	camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2.5h7L17 8h3a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9.5A1.5 1.5 0 0 1 4 8Z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
	printer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9V3.5h11V9"/><rect x="3.5" y="9" width="17" height="7.5" rx="1.5"/><path d="M6.5 14h11v6.5h-11z"/></svg>',
	iot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3"/></svg>',
	router: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 13V8M17 13V8M7 8l3-3.5M17 8l-3-3.5M7 16.5h.01M10.5 16.5h3"/></svg>',
	users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-8 0v2"/><circle cx="12" cy="7" r="4"/><path d="M5.5 21v-1.5a3.5 3.5 0 0 1 3-3.46M18.5 21v-1.5a3.5 3.5 0 0 0-3-3.46"/></svg>',
	down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10M12 14l-3.5-3.5M12 14l3.5-3.5"/><path d="M5 20h14"/></svg>',
	up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10M12 10l-3.5 3.5M12 10l3.5 3.5"/><path d="M5 4h14"/></svg>',
	cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3"/></svg>',
	mem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 17v3M12 17v3M17 17v3M7 11h3M14 11h3"/></svg>',
	disk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
	unknown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8v.3"/><path d="M12 17.2h.01"/></svg>'
};

const TYPE_NAMES = {
	phone: '手机', tablet: '平板', laptop: '笔记本', desktop: '电脑',
	tv: '电视', nas: 'NAS', camera: '摄像头', printer: '打印机',
	iot: '智能设备', router: '路由器', unknown: '设备'
};

/* ---------- 品牌 logo (simple-icons, CC0, 本地内置) ---------- */

const BRAND_LOGOS = {
	'Apple': 'apple', 'Samsung': 'samsung', 'Xiaomi': 'xiaomi', 'HUAWEI': 'huawei',
	'Honor': 'honor', 'OPPO': 'oppo', 'vivo': 'vivo', 'OnePlus': 'oneplus',
	'Google': 'google', 'Motorola': 'motorola', 'Nokia': 'nokia',
	'Lenovo': 'lenovo', 'Intel': 'intel', 'NVIDIA': 'nvidia', 'Sony': 'sony',
	'LG': 'lg', 'TP-Link': 'tplink', 'ASUSTek': 'asus', 'NETGEAR': 'netgear',
	'MikroTik': 'mikrotik', 'Ubiquiti': 'ubiquiti', 'Cisco': 'cisco',
	'Linksys': 'linksys', 'Fortinet': 'fortinet',
	'Raspberry Pi': 'raspberrypi', 'Synology': 'synology', 'QNAP': 'qnap',
	'Seagate': 'seagate', 'Sonos': 'sonos', 'Espressif': 'espressif',
	'Shelly': 'shelly', 'Hewlett-Packard': 'hp', 'Epson': 'epson'
};

const HOST_BRANDS = [
	[/iphone|ipad|ipod|macbook|imac|macmini|airpods|appletv|homepod/i, 'apple'],
	[/galaxy|sm-[sgatv]\d|samsung/i, 'samsung'],
	[/redmi|poco|xiaomi|miui|mijia|mitv|mi-tv|米家|小米/i, 'xiaomi'],
	[/huawei|matebook|mate\s?\d|nova\s?\d|harmony|华为/i, 'huawei'],
	[/honor/i, 'honor'],
	[/oneplus|一加/i, 'oneplus'],
	[/oppo|reno|find\s?x/i, 'oppo'],
	[/vivo|iqoo/i, 'vivo'],
	[/pixel|nexus|chromecast|nest|google/i, 'google'],
	[/thinkpad|ideapad|legion|lenovo/i, 'lenovo'],
	[/ubuntu/i, 'ubuntu'], [/debian/i, 'debian'], [/fedora/i, 'fedora'], [/linux/i, 'linux'],
	[/android/i, 'android'],
	[/synology|ds\d{3}|群晖/i, 'synology'],
	[/qnap|威联通/i, 'qnap'],
	[/truenas|freenas/i, 'truenas'],
	[/openmediavault|omv/i, 'openmediavault'],
	[/unraid/i, 'unraid'],
	[/raspberrypi|raspberry/i, 'raspberrypi'],
	[/espressif|esp32|esp8266/i, 'espressif'],
	[/shelly/i, 'shelly'],
	[/sonos/i, 'sonos'],
	[/roku/i, 'roku'],
	[/openwrt|immortalwrt|lede/i, 'openwrt'],
	[/homeassistant|home-assistant/i, 'homeassistant'],
	[/pihole/i, 'pihole'],
	[/nextcloud/i, 'nextcloud'],
	[/jellyfin/i, 'jellyfin'],
	[/alist/i, 'alist'],
	[/tplink|tp-link|水星|mercusys/i, 'tplink'],
	[/asus|rog|rt-[an]|tuf/i, 'asus'],
	[/netgear|orbi|nighthawk/i, 'netgear'],
	[/mikrotik|routeros/i, 'mikrotik'],
	[/ubiquiti|unifi|edgerouter/i, 'ubiquiti'],
	[/cisco/i, 'cisco'],
	[/linksys/i, 'linksys'],
	[/hewlett|hp-|laserjet|officejet/i, 'hp'],
	[/epson/i, 'epson']
];

const BRAND_NAMES = {
	apple: 'Apple', samsung: 'Samsung', xiaomi: 'Xiaomi', huawei: 'HUAWEI', honor: 'Honor',
	oppo: 'OPPO', vivo: 'vivo', oneplus: 'OnePlus', google: 'Google', motorola: 'Motorola',
	nokia: 'Nokia', android: 'Android', lenovo: 'Lenovo', ubuntu: 'Ubuntu', debian: 'Debian',
	fedora: 'Fedora', linux: 'Linux', synology: 'Synology', qnap: 'QNAP', truenas: 'TrueNAS',
	openmediavault: 'OpenMediaVault', unraid: 'Unraid', raspberrypi: 'Raspberry Pi',
	espressif: 'Espressif', shelly: 'Shelly', sonos: 'Sonos', roku: 'Roku', openwrt: 'OpenWrt',
	homeassistant: 'HomeAssistant', pihole: 'Pi-hole', nextcloud: 'Nextcloud', jellyfin: 'Jellyfin',
	alist: 'Alist', tplink: 'TP-Link', asus: 'ASUSTek', netgear: 'NETGEAR', mikrotik: 'MikroTik',
	ubiquiti: 'Ubiquiti', cisco: 'Cisco', linksys: 'Linksys', hp: 'Hewlett-Packard', epson: 'Epson'
};

function brandSlug(hostname, vendor) {
	const h = String(hostname || '');
	for (let i = 0; i < HOST_BRANDS.length; i++)
		if (HOST_BRANDS[i][0].test(h))
			return HOST_BRANDS[i][1];
	if (vendor && BRAND_LOGOS[vendor])
		return BRAND_LOGOS[vendor];
	return null;
}

/* ---------- MAC OUI → 厂商 ---------- */

const OUI = {
	'001A11': 'Google', '3C5AB4': 'Google', 'F4F5D8': 'Google',
	'B827EB': 'Raspberry Pi', 'DCA632': 'Raspberry Pi', 'E45F01': 'Raspberry Pi', '286AB4': 'Raspberry Pi',
	'00044B': 'NVIDIA', '48B02D': 'NVIDIA',
	'001111': 'Intel', '0012F0': 'Intel', '001320': 'Intel', '001500': 'Intel', '001517': 'Intel',
	'00166F': 'Intel', '001676': 'Intel', '0016EA': 'Intel', '0016EB': 'Intel', '001733': 'Intel',
	'0018DE': 'Intel', '001907': 'Intel', '0019D1': 'Intel', '001B21': 'Intel', '001B77': 'Intel',
	'001CBF': 'Intel', '001CC0': 'Intel', '001DE0': 'Intel', '001DE1': 'Intel', '001E64': 'Intel',
	'001E65': 'Intel', '001E67': 'Intel', '001F3B': 'Intel', '001F3C': 'Intel', '00215C': 'Intel',
	'00216A': 'Intel', '00216B': 'Intel', '0022FA': 'Intel', '0022FB': 'Intel', '0024D6': 'Intel',
	'0024D7': 'Intel', '0026C6': 'Intel', '0026C7': 'Intel', '002710': 'Intel', '3413E8': 'Intel',
	'3C970E': 'Intel', '4025C2': 'Intel', '448500': 'Intel', '4CEB42': 'Intel', '5891CF': 'Intel',
	'5C514F': 'Intel', '5CE0C5': 'Intel', '605718': 'Intel', '648099': 'Intel', '6805CA': 'Intel',
	'6C8814': 'Intel', '701CE0': 'Intel', '74E50B': 'Intel', '78929C': 'Intel', '7C7A91': 'Intel',
	'8086F2': 'Intel', '843A4B': 'Intel', '887873': 'Intel', '8C705A': 'Intel', '902E16': 'Intel',
	'9459C0': 'Intel', '984FEE': 'Intel', '9C4E36': 'Intel', 'A0369F': 'Intel', 'A4BF01': 'Intel',
	'A86DAA': 'Intel', 'AC7BA1': 'Intel', 'B46BFC': 'Intel', 'B88AEC': 'Intel', 'BC0F64': 'Intel',
	'C85B76': 'Intel', 'D07E35': 'Intel', 'D8F2CA': 'Intel', 'DC5360': 'Intel', 'E4A7A0': 'Intel',
	'E82AEA': 'Intel', 'EC8EB5': 'Intel', 'F40669': 'Intel',
	'0023DF': 'Apple', '0026BB': 'Apple', '040CCE': 'Apple', '28CFDA': 'Apple', '542696': 'Apple',
	'60C547': 'Apple', '68A86D': 'Apple', '705681': 'Apple', '7C6D62': 'Apple', '8866A5': 'Apple',
	'90B21F': 'Apple', 'A46706': 'Apple', 'ACBC32': 'Apple', 'C869CD': 'Apple', 'D023DB': 'Apple',
	'D4909C': 'Apple', 'DC2B2A': 'Apple', 'E0F5C6': 'Apple', 'F0DBF8': 'Apple', '001E52': 'Apple',
	'002500': 'Apple', '00C612': 'Apple', '3C0754': 'Apple', '40B395': 'Apple', '001CB3': 'Apple',
	'002312': 'Apple', '002332': 'Apple', '002436': 'Apple', '0025BC': 'Apple', '10DDB1': 'Apple',
	'1499E2': 'Apple', '183451': 'Apple', '1C9180': 'Apple', '20C9D0': 'Apple', '28E02C': 'Apple',
	'3408BC': 'Apple', '38C93F': 'Apple', '3C2EF9': 'Apple', '44FB42': 'Apple', '4C57CA': 'Apple',
	'50DE06': 'Apple', '54E43A': 'Apple', '5C969D': 'Apple', '645AED': 'Apple', '6C96CF': 'Apple',
	'74E2F5': 'Apple', '784F43': 'Apple', '80E650': 'Apple', '843835': 'Apple', '8C587C': 'Apple',
	'9060D1': 'Apple', '949426': 'Apple', '9801A7': 'Apple', '9C207B': 'Apple', 'A0999B': 'Apple',
	'A4B197': 'Apple', 'A88808': 'Apple', 'AC1F74': 'Apple', 'B0481A': 'Apple', 'B8098A': 'Apple',
	'BC6C21': 'Apple', 'C0847A': 'Apple', 'C4B301': 'Apple', 'C82A14': 'Apple', 'CC08E0': 'Apple',
	'D0817A': 'Apple', 'D4DCCD': 'Apple', 'D89695': 'Apple', 'DCA904': 'Apple', 'E0ACCB': 'Apple',
	'E425E7': 'Apple', 'E88D28': 'Apple', 'EC852F': 'Apple', 'F01898': 'Apple', 'F45C89': 'Apple',
	'F81EDF': 'Apple', 'FC253F': 'Apple', '000D93': 'Apple', '001124': 'Apple', '001451': 'Apple',
	'0017F2': 'Apple', '0019E3': 'Apple', '001B63': 'Apple', '001FF3': 'Apple', '002241': 'Apple',
	'002608': 'Apple', '00264A': 'Apple', '0026B0': 'Apple',
	'001A2A': 'Samsung', '3423BA': 'Samsung', '5C0A5B': 'Samsung', '8C7712': 'Samsung', 'BC1485': 'Samsung',
	'E8508B': 'Samsung', '781FDB': 'Samsung', 'A02195': 'Samsung', 'C8D778': 'Samsung', '002637': 'Samsung',
	'001599': 'Samsung', '001247': 'Samsung', '002119': 'Samsung', '8425DB': 'Samsung', 'B479A7': 'Samsung',
	'8CBEBE': 'Xiaomi', '640980': 'Xiaomi', '7811DC': 'Xiaomi', 'F0B429': 'Xiaomi', '286C07': 'Xiaomi',
	'508F4C': 'Xiaomi', 'ACC1EE': 'Xiaomi', '04CF8C': 'Xiaomi', '001216': 'Xiaomi', '34CE00': 'Xiaomi',
	'7C8DD1': 'Xiaomi', 'F8A45F': 'Xiaomi', '009EC8': 'Xiaomi', '38A4ED': 'Xiaomi', '8C53C3': 'Xiaomi',
	'C40BCB': 'Xiaomi', '00EC0A': 'Xiaomi', '14F65A': 'Xiaomi', '2082C0': 'Xiaomi',
	'009ACD': 'HUAWEI', '48DB6F': 'HUAWEI', 'F04347': 'HUAWEI', '00E0FC': 'HUAWEI', 'E0247F': 'HUAWEI',
	'80B686': 'HUAWEI', '34CDBE': 'HUAWEI', '9C52F8': 'HUAWEI',
	'346B5B': 'Honor', '485AB2': 'Honor', '9C8C6E': 'Honor',
	'4C6B1A': 'OPPO', '8CD2E9': 'OPPO', 'D04AC1': 'OPPO', '5063A1': 'OPPO', '04D9F5': 'OPPO',
	'38E1AA': 'vivo', '986FE8': 'vivo', 'B08E1E': 'vivo', '44C346': 'vivo', 'C89BAD': 'vivo',
	'64A2F9': 'OnePlus', '94E6F7': 'OnePlus', 'C0EEFB': 'OnePlus', '94B234': 'OnePlus',
	'4A5AF1': 'realme', 'B0B9C6': 'realme',
	'0050F2': 'Microsoft', '00125A': 'Microsoft', '00155D': 'Microsoft', '0017FA': 'Microsoft',
	'001DD8': 'Microsoft', '002248': 'Microsoft', '281878': 'Microsoft', '7C1E52': 'Microsoft',
	'0003FF': 'Microsoft', '000D3A': 'Microsoft', '00BD3A': 'Microsoft', '501AC5': 'Microsoft',
	'5882A8': 'Microsoft', '6045BD': 'Microsoft', '7CED8D': 'Microsoft', '9CAA1B': 'Microsoft',
	'B40B44': 'Microsoft', 'DCB4C4': 'Microsoft', 'E498D6': 'Microsoft', '000E58': 'Microsoft',
	'001A79': 'TP-Link', '50C7BF': 'TP-Link', '98DAC4': 'TP-Link', '0023CD': 'TP-Link', 'EC086B': 'TP-Link',
	'001F3F': 'ASUSTek', '08606E': 'ASUSTek', '1C872C': 'ASUSTek', '2C4D54': 'ASUSTek', '38D547': 'ASUSTek',
	'4CEDFB': 'ASUSTek', '6045CB': 'ASUSTek', '74D02B': 'ASUSTek', 'AC220B': 'ASUSTek', 'BCAEC5': 'ASUSTek',
	'D850E6': 'ASUSTek', 'E03F49': 'ASUSTek', 'F46D04': 'ASUSTek',
	'001E8C': 'D-Link', '1C7EE5': 'D-Link', '9094E4': 'D-Link', '001B11': 'D-Link', '00265A': 'D-Link',
	'000F3F': 'NETGEAR', '204E7F': 'NETGEAR', '9C3DCF': 'NETGEAR', 'A040A0': 'NETGEAR', 'E091F5': 'NETGEAR',
	'001C14': 'NETGEAR', '001463': 'NETGEAR', '00184D': 'NETGEAR', '001B2F': 'NETGEAR', '00223F': 'NETGEAR',
	'0024B2': 'NETGEAR', '0026F2': 'NETGEAR',
	'001349': 'Zyxel', '5CF4AB': 'Zyxel', 'B0B2DC': 'Zyxel', '0019CB': 'Zyxel',
	'C83A35': 'Tenda',
	'000C42': 'MikroTik', '4C5E0C': 'MikroTik', '6C3B6B': 'MikroTik', '488F5A': 'MikroTik', '744D28': 'MikroTik',
	'00156D': 'Ubiquiti', '24A43C': 'Ubiquiti', '788A20': 'Ubiquiti', 'FCECDA': 'Ubiquiti', '44D9E7': 'Ubiquiti',
	'001AA1': 'Cisco', '00260B': 'Cisco', '000A41': 'Cisco', '001BD4': 'Cisco', '001A2B': 'Cisco',
	'00BB3A': 'Amazon', '44500D': 'Amazon', '6854FD': 'Amazon', '74C246': 'Amazon', 'F0272D': 'Amazon',
	'F0D2F1': 'Amazon', '40B4CD': 'Amazon', '0C47C9': 'Amazon', 'AC63BE': 'Amazon',
	'001788': 'Philips', 'ECB5FA': 'Philips',
	'001E75': 'LG', '001C62': 'LG', '001F6B': 'LG', '0021FB': 'LG', '002483': 'LG', '0026E2': 'LG',
	'2C598A': 'LG',
	'0013A9': 'Sony', '001DBA': 'Sony', '0024BE': 'Sony', '30F9ED': 'Sony', '78843C': 'Sony',
	'A8E3EE': 'Sony', 'FC0FE6': 'Sony',
	'001BA9': 'Brother', '008077': 'Brother', '3055C3': 'Brother',
	'000085': 'Canon', '8891DD': 'Canon',
	'00215A': 'Hewlett-Packard', '001F29': 'Hewlett-Packard', '0025B3': 'Hewlett-Packard',
	'3CD92B': 'Hewlett-Packard', '000F20': 'Hewlett-Packard', '00110A': 'Hewlett-Packard',
	'001438': 'Hewlett-Packard', '001708': 'Hewlett-Packard', '001B78': 'Hewlett-Packard',
	'00237D': 'Hewlett-Packard', '000D9D': 'Hewlett-Packard', '000F61': 'Hewlett-Packard',
	'001279': 'Hewlett-Packard', '001321': 'Hewlett-Packard', '001635': 'Hewlett-Packard',
	'001871': 'Hewlett-Packard', '0019BB': 'Hewlett-Packard', '001A4B': 'Hewlett-Packard',
	'001E0B': 'Hewlett-Packard', '001FFE': 'Hewlett-Packard', '0060B0': 'Hewlett-Packard',
	'0080A0': 'Hewlett-Packard', '082E5F': 'Hewlett-Packard', '1CC1DE': 'Hewlett-Packard',
	'2C4138': 'Hewlett-Packard', '308D99': 'Hewlett-Packard', '3C4A92': 'Hewlett-Packard',
	'0000E2': 'Acer', '0021CC': 'Acer', '002622': 'Acer', '00C09F': 'Acer',
	'0024E4': 'Withings', '4480EB': 'Withings',
	'000E58': 'Sonos', '5CAAFD': 'Sonos', '948127': 'Sonos', 'B8E937': 'Sonos', '782885': 'Sonos',
	'240AC4': 'Espressif', '3C71BF': 'Espressif', '84F3EB': 'Espressif', 'A4CF12': 'Espressif',
	'B4E62D': 'Espressif', 'CC50E3': 'Espressif', 'DC4F22': 'Espressif', 'ECFA40': 'Espressif',
	'483FDA': 'Espressif', '8CAA60': 'Espressif'
};

function vendorOf(mac) {
	const p = String(mac || '').toUpperCase().replace(/[^0-9A-F]/g, '').substr(0, 6);
	return OUI[p] || null;
}

function typeOf(hostname, vendor) {
	const h = String(hostname || '').toLowerCase();

	if (/iphone/.test(h)) return 'phone';
	if (/ipad/.test(h)) return 'tablet';
	if (/macbook|imac|macmini|mac-pro|macpro|osx|darwin/.test(h)) return 'laptop';
	if (/android|redmi|poco|harmony|mate\d|honor|oppo|vivo|oneplus|realme|iqoo|nova|reno|findx|小米|华为|荣耀|红米/.test(h)) return 'phone';
	if (/desktop|workstation|win-|-pc$|^pc$|ubuntu|debian|archlinux|centos|fedora|windows|linux/.test(h)) return 'desktop';
	if (/tv|television|chromecast|firetv|appletv|roku|shield|电视|机顶盒/.test(h)) return 'tv';
	if (/nas|synology|ds\d{3}|qnap|terramaster|freenas|truenas|openmediavault|群晖|威联通/.test(h)) return 'nas';
	if (/cam|camera|ipc|doorbell|摄像头|门铃/.test(h)) return 'camera';
	if (/printer|print|打印机/.test(h)) return 'printer';
	if (/esp|esp32|esp8266|sonoff|tasmota|shelly|tuya|zigbee|sensor|智能|插座|灯泡|温控/.test(h)) return 'iot';
	if (/openwrt|immortalwrt|lede|padavan|router|ap-|repeater|extender|switch/.test(h)) return 'router';

	if (vendor) {
		const v = vendor.toLowerCase();
		if (v == 'apple') return 'phone';
		if (/samsung|xiaomi|huawei|honor|oppo|vivo|oneplus|realme/.test(v)) return 'phone';
		if (v == 'intel' || v == 'microsoft') return 'desktop';
		if (v == 'raspberry pi') return 'nas';
		if (/tp-link|netgear|d-link|tenda|zyxel|ubiquiti|cisco|mikrotik/.test(v)) return 'router';
		if (v == 'sony' || v == 'lg' || v == 'philips') return 'tv';
		if (/hewlett-packard|brother|canon|epson/.test(v)) return 'printer';
		if (v == 'amazon' || v == 'espressif' || v == 'sonos' || v == 'withings') return 'iot';
	}
	return 'unknown';
}

/* ---------- 服务图标 (1.7px 线性) ---------- */

const SVC_ICONS = {
	globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>',
	shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/></svg>',
	shieldcheck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>',
	terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/></svg>',
	clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
	wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.5 16a6 6 0 0 1 7 0M12 19.5h.01"/></svg>',
	server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/></svg>',
	dns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
	share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.6l6.8-4M8.6 13.4l6.8 4"/></svg>',
	lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10" width="15" height="10.5" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
	cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 11.5 3.5 3.5 0 0 0 7 18z"/></svg>',
	gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/></svg>',
	route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.2 16.4C11 13 10.5 10.5 15.8 7.2"/></svg>',
	folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
	cog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.6M12 18.9v2.6M4.2 4.2l1.9 1.9M17.9 17.9l1.9 1.9M2.5 12h2.6M18.9 12h2.6M4.2 19.8l1.9-1.9M17.9 6.1l1.9-1.9"/></svg>',
	sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3l1.6 4.3L16.9 9l-4.3 1.7L11 15l-1.6-4.3L5.1 9l4.3-1.7L11 3z"/><path d="M18.2 14.6l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1z"/></svg>',
	database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
	plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4"/></svg>'
};

const SVC_ICON_MAP = [
	[/^lucky$/i, 'sparkles'],
	[/(upnp|miniupnpd|natpmp)/i, 'share'],
	[/^(network|netifd)$/i, 'globe'],
	[/(firewall|nftables)/i, 'shield'],
	[/(dnsmasq|odhcpd|dhcp|dhcpv6)/i, 'dns'],
	[/(uhttpd|nginx|lighttpd|rpcd|uwsgi)/i, 'server'],
	[/(dropbear|sshd|ssh|ttyd|telnet)/i, 'terminal'],
	[/^cron$/i, 'clock'],
	[/(ntpd|sysntpd|chrony|time|sysfixtime)/i, 'clock'],
	[/(wifi|wpad|hostapd|supplicant|mtwifi|mtk|wireless|kmod)/i, 'wifi'],
	[/(samba|ksmbd|nfs|minidlna|dlna|ftp)/i, 'folder'],
	[/(vpn|wireguard|openvpn|zerotier|tailscale|easytier|easy|tunsafe|passwall|openclash|clash|ssr|v2ray|xray|brook)/i, 'lock'],
	[/(ddns|dynamic_dns)/i, 'cloud'],
	[/(sqm|qos)/i, 'gauge'],
	[/(mwan3|mwan|policy|balancing)/i, 'route'],
	[/(adblock|adguard|adbyby|dnsmasq-full)/i, 'shieldcheck'],
	[/(log|syslog|logd|rsyslog)/i, 'database'],
	[/(usb|storage|block|fstab|mount|hdparm)/i, 'folder'],
	[/(system|boot|done|led|button|hotplug|urngd|random|sysctl|rpcd|procd|ubus)/i, 'cpu'],
	[/(mosquitto|mqtt)/i, 'route']
];

const SVC_NAMES = {
	lucky: 'Lucky 大吉', network: '网络 (netifd)', firewall: '防火墙', dnsmasq: 'DNS / DHCP',
	odhcpd: 'IPv6 DHCP', uhttpd: 'Web 管理界面', rpcd: 'RPC 服务', dropbear: 'SSH 远程登录',
	cron: '计划任务', system: '系统设置', boot: '启动脚本', done: '启动完成',
	led: 'LED 指示', sysfixtime: '时间同步', sysntpd: 'NTP 客户端', log: '系统日志',
	'network': '网络', wifi: '无线网络', mtwifi_cfg: 'MTWiFi 配置',
	upnpd: 'UPnP 自动端口映射', miniupnpd: 'UPnP', sqm: '智能队列管理 (SQM)',
	mwan3: '多线负载均衡', ddns: '动态域名', samba4: 'Samba 文件共享', ksmbd: 'Samba 文件共享',
	adblock: '广告过滤', zerotier: 'ZeroTier 虚拟网', wireguard: 'WireGuard VPN',
	easytier: 'EasyTier 虚拟网', mosquitto: 'MQTT 服务'
};

function svcIcon(name) {
	for (let i = 0; i < SVC_ICON_MAP.length; i++)
		if (SVC_ICON_MAP[i][0].test(name))
			return SVC_ICON_MAP[i][1];
	return 'cog';
}

function svcLabel(name) {
	return SVC_NAMES[name] || name;
}

/* ---------- 工具函数 ---------- */

function fmtBytes(n) {
	n = Number(n) || 0;
	if (n >= 1099511627776) return (n / 1099511627776).toFixed(2) + ' TB';
	if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
	if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
	if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
	return n + ' B';
}

function fmtMac(mac) {
	return String(mac || '').toUpperCase();
}

function shortMac(mac) {
	const m = fmtMac(mac);
	return m.substr(m.length - 5);
}

function fmtUptime(s) {
	s = Number(s) || 0;
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (d > 0) return d + ' 天 ' + h + ' 小时';
	if (h > 0) return h + ' 小时 ' + m + ' 分';
	return m + ' 分 ' + (s % 60) + ' 秒';
}

function fmtClock(ts) {
	if (!ts) return '—';
	const d = new Date(Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000);
	if (isNaN(d.getTime())) return '—';
	const p = (n) => (n < 10 ? '0' : '') + n;
	return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function signalText(sig) {
	if (sig == null) return null;
	const n = Number(sig);
	if (isNaN(n)) return null;
	if (n >= -50) return n + ' dBm 极佳';
	if (n >= -60) return n + ' dBm 良好';
	if (n >= -70) return n + ' dBm 一般';
	return n + ' dBm 较弱';
}

function wifiBand(iface) {
	const i = String(iface || '');
	if (/5g|rax|rai|ax|band5/i.test(i)) return '5 GHz';
	if (/2\.4|ra0|bg|band2/i.test(i)) return '2.4 GHz';
	return null;
}

function iconEl(type, cls, brand) {
	if (brand)
		return EE('img', {
			'class': (cls || 'ico') + ' brand-logo',
			'src': L.resource('view/liuli/brands/' + brand + '.svg'),
			'alt': brand,
			'loading': 'lazy'
		});
	const el = EE('span', { 'class': cls || 'ico' });
	el.innerHTML = TYPE_ICONS[type] || TYPE_ICONS.unknown;
	return el;
}

function svcIconEl(name, cls) {
	const el = EE('span', { 'class': cls || 'ico' });
	el.innerHTML = SVC_ICONS[svcIcon(name)] || SVC_ICONS.cog;
	return el;
}

const SEVERITY = ['emerg', 'alert', 'crit', 'err', 'warn', 'notice', 'info', 'debug'];
const FACILITY = ['kern', 'user', 'mail', 'daemon', 'auth', 'syslog', 'lpr', 'news', 'uucp',
	'cron', 'authpriv', 'ftp', 'ntp', 'audit', 'alert', 'clockd', 'local0', 'local1',
	'local2', 'local3', 'local4', 'local5', 'local6', 'local7'];

/* ---------- 视图 ---------- */

return view.extend({
	data: null,

	load() {
		const safe = (p) => p.catch(() => null);
		return Promise.all([
			safe(callDevices()),
			safe(callSystem()),
			safe(callLog(40)),
			safe(callPing(PING_TARGETS))
		]);
	},

	render(raw) {
		const self = this;

		this.data = {
			devices: (raw[0] && typeof raw[0] == 'object') ? raw[0] : null,
			system: (raw[1] && typeof raw[1] == 'object') ? raw[1] : null,
			log: (raw[2] && typeof raw[2] == 'object') ? raw[2] : null,
			ping: (raw[3] && typeof raw[3] == 'object') ? raw[3] : null
		};
		this.filterKey = 'all';
		this.showAllServices = false;
		this.rateHistory = [];
		this.prevStats = null;
		this.latencyHist = {};
		this.connHist = [];
		this.memHist = [];
		this.paused = false;

		this.elHead = EE('div', { 'class': 'll-head' });
		this.elStats = EE('div', { 'class': 'll-grid ll-stats' });
		this.elMonitor = EE('div', { 'class': 'll-grid ll-monitor' });
		this.elInsight = EE('div', { 'class': 'll-grid ll-insight' });
		this.elSystem = EE('div', { 'class': 'll-sys' });
		this.elServices = EE('div', { 'class': 'll-badges' });
		this.elSvcMore = EE('div', { 'class': 'll-more' });
		this.elNetwork = EE('div', { 'class': 'll-grid ll-net' });
		this.elStorage = EE('div', { 'class': 'll-grid ll-disk' });
		this.elDevHero = EE('div', { 'class': 'll-devhero' });
		this.elFilters = EE('div', { 'class': 'll-filters' });
		this.elDevices = EE('div', { 'class': 'll-devices' });
		this.elLog = EE('div', { 'class': 'll-log' });

		const nav = EE('div', { 'class': 'll-nav' }, [
			EE('a', { 'href': '#ll-sec-system' }, ['系统']),
			EE('a', { 'href': '#ll-sec-services' }, ['服务']),
			EE('a', { 'href': '#ll-sec-network' }, ['网络']),
			EE('a', { 'href': '#ll-sec-storage' }, ['存储']),
			EE('a', { 'href': '#ll-sec-devices' }, ['设备']),
			EE('a', { 'href': '#ll-sec-log' }, ['日志'])
		]);

		const root = EE('div', { 'class': 'liuli-dash' }, [
			EE('link', { 'rel': 'stylesheet', 'href': L.resource('view/liuli.css') }),
			EE('div', { 'id': 'll-top' }),
			this.elHead,
			nav,
			this.elStats,
			this.elMonitor,
			this.elInsight,
			this.section('系统状态', 'll-sec-system', [ this.elSystem ]),
			this.section('服务徽标', 'll-sec-services', [ this.elServices, this.elSvcMore ]),
			this.section('网络与无线', 'll-sec-network', [ this.elNetwork ]),
			this.section('存储', 'll-sec-storage', [ this.elStorage ]),
			this.section('设备看板', 'll-sec-devices', [
				this.elDevHero, this.elFilters, this.elDevices
			]),
			this.section('系统日志', 'll-sec-log', [ this.elLog ])
		]);

		this.rootEl = root;
		this.navEl = nav;
		this.buildFilters();
		this.renderAll();
		this.setupScrollSpy();

		if (!this.pollFn)
			this.pollFn = L.bind(this.refresh, this);
		poll.add(this.pollFn, 10);

		return root;
	},

	section(title, id, children) {
		return EE('section', { 'class': 'll-section', 'id': id }, [
			EE('div', { 'class': 'll-sechead' }, [
				EE('h3', {}, [ title ]),
				EE('a', { 'class': 'll-top', 'href': '#ll-top', 'click': (ev) => {
					ev.preventDefault();
					document.getElementById('ll-top').scrollIntoView({ behavior: 'smooth', block: 'start' });
				} }, ['回到顶部 ↑'])
			]),
			EE('div', { 'class': 'll-secbody' }, children)
		]);
	},

	/* 滚动时高亮当前所在区块的导航项 (scroll spy) */
	setupScrollSpy() {
		if (!this.navEl || !this.rootEl)
			return;

		const links = {};
		for (const a of this.navEl.querySelectorAll('a'))
			links[a.getAttribute('href').replace('#', '')] = a;

		const sections = [];
		for (const id in links) {
			const el = this.rootEl.querySelector('#' + id);
			if (el)
				sections.push({ id: id, el: el, a: links[id] });
		}
		if (!sections.length)
			return;

		const setActive = (id) => {
			for (const s of sections)
				s.a.classList.toggle('active', s.id === id);
		};

		let pending = false;
		const onScroll = () => {
			if (pending)
				return;
			pending = true;
			window.requestAnimationFrame(() => {
				pending = false;
				let best = sections[0].id, bestDist = Infinity;
				for (const s of sections) {
					const r = s.el.getBoundingClientRect();
					if (r.bottom < 60)
						continue;                 /* 已滚过的区块 */
					const d = Math.abs(r.top - 90);
					if (d < bestDist) { bestDist = d; best = s.id; }
				}
				setActive(best);
			});
		};

		window.addEventListener('scroll', onScroll, { passive: true });
		onScroll();
	},

	renderAll() {
		this.sampleRate();
		this.dev = this.computeDevices();
		this.renderHead();
		this.renderStats();
		this.renderInsight();
		this.renderSystem();
		this.renderServices();
		this.renderNetwork();
		this.renderStorage();
		this.renderDevices();
		this.renderLog();
	},

	/* ---------- 实时速率采样 ---------- */

	sampleRate() {
		const sys = this.data.system;
		if (!sys || !sys.interfaces)
			return;

		/* 取带统计数据的 WAN 接口 */
		let w = null;
		for (const i of sys.interfaces)
			if (i.is_wan && i.stats && i.up) { w = i; break; }
		if (!w)
			for (const i of sys.interfaces)
				if (i.is_wan && i.stats) { w = i; break; }
		if (!w) {
			this.currentRate = null;
			return;
		}

		const now = Date.now() / 1000;
		const p = this.prevStats;
		this.prevStats = { key: w.interface, ts: now, rx: w.stats.rx_bytes, tx: w.stats.tx_bytes };

		if (!p || p.key != w.interface) {
			this.currentRate = null;
			return;
		}

		const dt = now - p.ts;
		if (!(dt > 0) || dt > 600 || w.stats.rx_bytes < p.rx) {
			this.currentRate = null;
			return;
		}

		this.currentRate = {
			rx: Math.max(0, (w.stats.rx_bytes - p.rx) / dt),
			tx: Math.max(0, (w.stats.tx_bytes - p.tx) / dt),
			iface: w.interface
		};

		this.rateHistory.push({ rx: this.currentRate.rx, tx: this.currentRate.tx });
		while (this.rateHistory.length > 60)
			this.rateHistory.shift();
	},

	/* ---------- 页头 ---------- */

	renderHead() {
		const sys = this.data.system ?? {};
		const board = sys.board ?? {};
		const info = sys.system ?? {};

		const kv = (k, v) => EE('div', { 'class': 'll-kv' }, [
			EE('span', { 'class': 'k' }, [ k ]),
			EE('span', { 'class': 'v' }, [ (v == null || v === '') ? '—' : String(v) ])
		]);

		const now = new Date();
		const p = (n) => (n < 10 ? '0' : '') + n;

		dom.content(this.elHead, [
			EE('div', { 'class': 'll-title' }, [
				EE('h2', {}, [ board.hostname || 'OpenWrt' ]),
				EE('div', { 'class': 'll-sub' }, [
					board.model || board.system || '未知机型',
					' · ',
					(board.distribution || 'ImmortalWrt') + (board.version ? ' ' + board.version : ''),
					' · 内核 ' + (board.kernel || '—')
				])
			]),
			EE('div', { 'class': 'll-headmeta' }, [
			kv('运行时间', fmtUptime(info.uptime)),
			kv('系统时间', p(now.getHours()) + ':' + p(now.getMinutes()) + ':' + p(now.getSeconds())),
			kv('统计日期', sys.date || '—'),
			kv('自动刷新', this.paused ? '已暂停' : '10 秒'),
			EE('button', {
				'class': 'cbi-button cbi-button-apply ll-refresh',
				'click': () => this.refresh()
			}, ['立即刷新']),
			EE('button', {
				'class': 'cbi-button ll-pause',
				'data-liuli-pause': '1',
				'data-paused': this.paused ? '1' : '0',
				'click': (ev) => this.togglePause(ev.currentTarget)
			}, [ this.paused ? '继续刷新' : '暂停刷新' ])
		])
	]);
},

togglePause(btn) {
	this.paused = !this.paused;
	if (btn) {
		btn.textContent = this.paused ? '继续刷新' : '暂停刷新';
		btn.setAttribute('data-paused', this.paused ? '1' : '0');
	}
	ui.addNotification(null, E('p', {}, this.paused ? '已暂停实时刷新 (图表与历史保留)' : '已恢复实时刷新'), 'info');
	this.renderHead();
},

/* ---------- 概览卡片 ---------- */

	renderStats() {
		const dev = this.dev ?? this.computeDevices();
		const sys = this.data.system ?? {};
		const info = sys.system ?? {};
		const cpu = sys.cpu ?? {};
		const mem = info.memory ?? {};

		const memUsed = Math.max(0, (mem.total || 0) - (mem.free || 0) - (mem.buffered || 0));
		const memPct = mem.total ? Math.round(memUsed / mem.total * 100) : 0;

		dom.content(this.elStats, [
			this.metric('在线设备', dev.online + ' / ' + dev.list.length, '', 'users'),
			this.metric('今日下载', fmtBytes(dev.totalRx), '', 'down'),
			this.metric('今日上传', fmtBytes(dev.totalTx), '', 'up'),
			this.metric('CPU 使用率', (cpu.usage == null ? '—' : cpu.usage + '%'), '', 'cpu'),
			this.metric('内存占用', memPct + '%', fmtBytes(memUsed) + ' / ' + fmtBytes(mem.total), 'mem'),
			this.metric('连接数', (sys.conntrack && sys.conntrack.count != null) ? sys.conntrack.count : '—',
				(sys.conntrack && sys.conntrack.max) ? '上限 ' + sys.conntrack.max : '', 'router')
		]);

		/* Open-Box 风格的实时监控条: 外网延迟 + 连接数/内存趋势 */
		dom.content(this.elMonitor, [
			this.latencyCard(),
			this.trendCard('连接数', this.connHist, '#5b7cfa', sys.conntrack && sys.conntrack.count != null ? sys.conntrack.count : '—'),
			this.trendCard('内存占用', this.memHist, '#8b5cf6', memPct + '%')
		]);
	},

	metric(label, value, unit, icon) {
		return EE('div', { 'class': 'll-card ll-metric' }, [
			EE('div', { 'class': 'm-top' }, [ iconEl(icon, 'ico'), label ]),
			EE('div', { 'class': 'm-val' }, [ String(value) ]),
			unit ? EE('div', { 'class': 'm-unit' }, [ String(unit) ]) : null
		]);
	},

	/* Open-Box 风格的外网延迟测速卡: 多目标当前时延 + 历史 sparkline */
	latencyCard() {
		const results = (this.data.ping && this.data.ping.results) || [];

		const rows = results.map((r) => {
			const hist = this.latencyHist[r.host] || [];
			const spark = svgWrap(sparkSvg(hist, r.ms == null ? '#94a3b8' : '#5b7cfa', 72, 22));
			return EE('div', { 'class': 'll-lat-row' }, [
				EE('span', { 'class': 'll-lat-host' }, [ r.host ]),
				EE('span', { 'class': 'll-lat-ms ' + (r.ms == null ? 'bad' : '') },
					[ r.ms == null ? '超时' : (Math.round(r.ms * 10) / 10) + ' ms' ]),
				EE('span', { 'class': 'll-lat-spark' }, [ spark ])
			]);
		});

		return EE('div', { 'class': 'll-card ll-latency ll-span2' }, [
			EE('div', { 'class': 'll-cardtitle' }, [ iconEl('router', 'ico'), '外网延迟探测' ]),
			rows.length ? EE('div', { 'class': 'll-lat-list' }, rows) : this.empty('探测中…'),
			EE('div', { 'class': 'll-memmeta' }, [ '借鉴 Open-Box 延迟测速: 每 10 秒探测 ' + PING_TARGETS.join(' / ') ])
		]);
	},

	/* 趋势面积图卡 (连接数 / 内存占用) */
	trendCard(label, hist, color, current) {
		const svg = svgWrap(areaSvg(hist, color, 240, 56));
		return EE('div', { 'class': 'll-card ll-trend' }, [
			EE('div', { 'class': 'll-cardtitle' }, [ iconEl('cpu', 'ico'), label + ' 趋势' ]),
			EE('div', { 'class': 'll-trend-now' }, [ String(current == null ? '—' : current) ]),
			EE('div', { 'class': 'll-trend-svg' }, [ svg ]),
			EE('div', { 'class': 'll-memmeta' }, [ '最近 ' + (hist.length || 0) + ' 次采样' ])
		]);
	},

	/* ---------- 分析卡: 健康评分 / 设备构成 / 流量排行 ---------- */

	renderInsight() {
		const sys = this.data.system;
		const dev = this.dev ?? this.computeDevices();

		dom.content(this.elInsight, [
			this.healthCard(sys, dev),
			this.compositionCard(dev),
			this.rankingCard(dev)
		]);
	},

	/* 网络健康评分: 把 CPU / 内存 / 温度 / 连接数 / 存储 / 在线率
	   加权折算成 0-100 的综合分, 一眼看出路由器当前状态 */
	healthCard(sys, dev) {
		const info = sys?.system ?? {};
		const cpu = sys?.cpu ?? {};
		const mem = info.memory ?? {};
		const ct = sys?.conntrack ?? {};
		const temps = sys?.temp?.zones ?? [];
		const mounts = sys?.mounts ?? [];

		const items = [];

		if (cpu.usage != null)
			items.push({ k: 'CPU', v: 100 - cpu.usage, label: cpu.usage + '%', w: 1.0 });

		if (mem.total) {
			const used = Math.max(0, mem.total - (mem.free ?? 0) - (mem.buffered ?? 0));
			const pct = Math.min(100, used / mem.total * 100);
			items.push({ k: '内存', v: 100 - pct, label: Math.round(pct) + '%', w: 1.0 });
		}

		if (temps.length) {
			const t = Math.max.apply(null, temps.map((z) => z.value ?? 0));
			const sc = (t >= 85) ? 0 : (t >= 78) ? 35 : (t >= 70) ? 60 : (t >= 62) ? 80 : 100;
			items.push({ k: '温度', v: sc, label: t.toFixed(1) + '°C', w: 1.2 });
		}

		if (ct.max) {
			const pct = Math.min(100, (ct.count ?? 0) / ct.max * 100);
			items.push({ k: '连接数', v: 100 - pct, label: (ct.count ?? 0) + ' / ' + ct.max, w: 0.8 });
		}

		const root = mounts.filter((m) => m.mount == '/overlay')[0] ||
			mounts.filter((m) => m.mount == '/')[0];
		if (root && root.percent != null)
			items.push({ k: '存储', v: 100 - root.percent, label: root.percent + '%', w: 0.8 });

		if (dev.list.length) {
			const off = dev.list.filter((d) => !d.online).length;
			const pct = off / dev.list.length * 100;
			items.push({ k: '设备在线', v: 100 - pct,
				label: (dev.list.length - off) + ' / ' + dev.list.length, w: 0.6 });
		}

		if (!items.length)
			return EE('div', { 'class': 'll-card ll-health' }, [
				EE('div', { 'class': 'll-cardtitle' }, [ iconEl('router', 'ico'), '网络健康评分' ]),
				this.empty('暂无足够数据计算评分')
			]);

		const tw = items.reduce((a, b) => a + b.w, 0);
		const score = Math.round(items.reduce((a, b) => a + b.v * b.w, 0) / tw);
		const grade = (score >= 90) ? { t: '优秀', c: 'ok' } :
			(score >= 75) ? { t: '良好', c: 'ok' } :
			(score >= 60) ? { t: '一般', c: 'warn' } :
			{ t: '需关注', c: 'bad' };

		return EE('div', { 'class': 'll-card ll-health' }, [
			EE('div', { 'class': 'll-cardtitle' }, [ iconEl('router', 'ico'), '网络健康评分' ]),
			EE('div', { 'class': 'll-health-top' }, [
				this.ring(score, '综合分'),
				EE('div', { 'class': 'll-health-meta' }, [
					EE('span', { 'class': 'll-grade ' + grade.c }, [ grade.t ]),
					EE('div', { 'class': 'll-memmeta' }, [ '由 ' + items.length + ' 项指标加权得出' ])
				])
			]),
			EE('div', { 'class': 'll-health-items' }, items.map((it) => EE('div', { 'class': 'll-hitem' }, [
				EE('span', { 'class': 'k' }, [ it.k ]),
				EE('span', { 'class': 'b' }, [ EE('i', {
					'class': (it.v >= 80 ? 'ok' : it.v >= 55 ? 'warn' : 'bad'),
					'style': 'width:' + Math.max(2, Math.min(100, it.v)) + '%'
				}) ]),
				EE('span', { 'class': 'v mono' }, [ it.label ])
			])))
		]);
	},

	/* 设备构成: 按类型统计占比的堆叠条 */
	compositionCard(dev) {
		if (!dev.list.length)
			return EE('div', { 'class': 'll-card ll-composition' }, [
				EE('div', { 'class': 'll-cardtitle' }, [ iconEl('users', 'ico'), '设备构成' ]),
				this.empty('暂无设备')
			]);

		const order = [ '手机', '平板', '笔记本', '电脑', '电视', 'NAS', '摄像头', '打印机', '智能设备', '路由器', '设备' ];
		const groups = {};
		for (const d of dev.list) {
			const g = TYPE_NAMES[d.type] || '设备';
			groups[g] = (groups[g] || 0) + 1;
		}

		const keys = Object.keys(groups).sort((a, b) => {
			const ia = order.indexOf(a), ib = order.indexOf(b);
			return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
		});

		const total = dev.list.length;
		const palette = [ '#5b7cfa', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#fb7185', '#64748b', '#14b8a6', '#a855f7', '#ef4444', '#94a3b8' ];

		return EE('div', { 'class': 'll-card ll-composition' }, [
			EE('div', { 'class': 'll-cardtitle' }, [ iconEl('users', 'ico'), '设备构成' ]),
			EE('div', { 'class': 'll-stack' }, keys.map((k, i) => EE('i', {
				'style': 'width:' + (groups[k] / total * 100) + '%;background:' + palette[i % palette.length],
				'title': k + ' × ' + groups[k]
			}))),
			EE('div', { 'class': 'll-legend' }, keys.map((k, i) => EE('span', { 'class': 'll-lg' }, [
				EE('i', { 'style': 'background:' + palette[i % palette.length] }),
				k, EE('b', {}, [ String(groups[k]) ])
			]))),
			EE('div', { 'class': 'll-comp-stats' }, [
				EE('span', {}, [ '总计 ', EE('b', {}, [ String(total) ]), ' 台' ]),
				EE('span', {}, [ '在线 ', EE('b', {}, [ String(dev.online) ]) ]),
				EE('span', {}, [ '离线 ', EE('b', {}, [ String(total - dev.online) ]) ]),
				EE('span', {}, [ '无线 ', EE('b', {}, [ String(dev.list.filter((d) => d.wireless).length) ]) ]),
				EE('span', {}, [ '有线 ', EE('b', {}, [ String(dev.list.filter((d) => !d.wireless).length) ]) ])
			])
		]);
	},

	/* 今日流量排行 TOP5 */
	rankingCard(dev) {
		const top = dev.list.filter((d) => (d.rx + d.tx) > 0)
			.slice()
			.sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx))
			.slice(0, 5);

		if (!top.length)
			return EE('div', { 'class': 'll-card ll-ranking' }, [
				EE('div', { 'class': 'll-cardtitle' }, [ iconEl('down', 'ico'), '今日流量排行' ]),
				this.empty('暂无流量数据')
			]);

		const max = top[0].rx + top[0].tx;

		return EE('div', { 'class': 'll-card ll-ranking' }, [
			EE('div', { 'class': 'll-cardtitle' }, [ iconEl('down', 'ico'), '今日流量排行 TOP 5' ]),
			EE('div', { 'class': 'll-rank-list' }, top.map((d, i) => {
				const total = d.rx + d.tx;
				const pct = max ? (total / max * 100) : 0;
				return EE('div', { 'class': 'll-rank-row' }, [
					EE('span', { 'class': 'rk-n' }, [ String(i + 1) ]),
					EE('span', { 'class': 'rk-name' }, [ d.name ]),
					EE('span', { 'class': 'rk-bar' }, [ EE('i', { 'style': 'width:' + pct + '%' }) ]),
					EE('span', { 'class': 'rk-v mono' }, [ fmtBytes(total) ])
				]);
			})),
			EE('div', { 'class': 'll-memmeta' }, [
				'今日全网合计 ↓ ' + fmtBytes(dev.totalRx) + ' · ↑ ' + fmtBytes(dev.totalTx)
			])
		]);
	},

	/* ---------- 系统状态 ---------- */

	renderSystem() {
		const sys = this.data.system;
		if (!sys) {
			dom.content(this.elSystem, [ this.empty('系统数据不可用 (rpcd 插件未生效或权限不足)') ]);
			return;
		}
		const info = sys.system ?? {};
		const cpu = sys.cpu ?? {};
		const mem = info.memory ?? {};
		const swap = info.swap ?? {};
		const ct = sys.conntrack ?? {};
		const temps = (sys.temp && sys.temp.zones) ? sys.temp.zones : [];
		const load = info.load ?? [0, 0, 0];

		const memUsed = Math.max(0, (mem.total || 0) - (mem.free || 0) - (mem.buffered || 0));
		const memPct = mem.total ? Math.round(memUsed / mem.total * 100) : 0;
		const swapUsed = Math.max(0, (swap.total || 0) - (swap.free || 0));
		const swapPct = swap.total ? Math.round(swapUsed / swap.total * 100) : 0;
		const ctPct = (ct.count != null && ct.max) ? Math.min(100, Math.round(ct.count / ct.max * 100)) : 0;

		const bar = (pct, text, cls) => EE('div', { 'class': 'll-bar' }, [
			EE('div', { 'class': 'll-bar-track' }, [
				EE('div', { 'class': 'll-bar-fill ' + (cls || ''), 'style': 'width:' + Math.max(0, Math.min(100, pct)) + '%' })
			]),
			EE('div', { 'class': 'll-bar-text' }, [ text ])
		]);

		const kv = (k, v) => EE('div', { 'class': 'll-row' }, [
			EE('span', { 'class': 'k' }, [ k ]),
			EE('span', { 'class': 'v mono' }, [ (v == null || v === '') ? '—' : String(v) ])
		]);

		const zoneCards = temps.map((z) => EE('div', { 'class': 'll-temp' }, [
			EE('div', { 'class': 't-val' }, [ (Math.round(z.value * 10) / 10) + '°C' ]),
			EE('div', { 'class': 't-name' }, [ z.zone ])
		]));

		dom.content(this.elSystem, [
			EE('div', { 'class': 'll-card ll-syscpu' }, [
				this.ring((cpu.usage == null) ? 0 : cpu.usage, 'CPU'),
				EE('div', { 'class': 'll-sysinfo' }, [
					kv('处理器', (cpu.model || '—') + ' × ' + (cpu.count || 1) + ' 核'),
					kv('负载 1/5/15', [load[0], load[1], load[2]].map((v) => (Number(v) / 65536).toFixed(2)).join(' / ')),
					kv('进程数', info.processes ?? '—'),
					kv('运行时长', fmtUptime(info.uptime))
				])
			]),
			EE('div', { 'class': 'll-card ll-sysmem' }, [
				EE('div', { 'class': 'll-cardtitle' }, [ iconEl('mem', 'ico'), '内存与交换' ]),
				bar(memPct, fmtBytes(memUsed) + ' / ' + fmtBytes(mem.total) + ' (' + memPct + '%)'),
				EE('div', { 'class': 'll-memmeta' }, [
					'可用 ' + fmtBytes(mem.available != null ? mem.available : mem.free),
					' · 缓冲 ' + fmtBytes(mem.buffered)
				]),
				swap.total ? bar(swapPct, 'Swap ' + fmtBytes(swapUsed) + ' / ' + fmtBytes(swap.total)) : null,
				swap.total ? null : EE('div', { 'class': 'll-memmeta' }, ['未启用交换分区'])
			]),
			EE('div', { 'class': 'll-card ll-sysnet' }, [
				EE('div', { 'class': 'll-cardtitle' }, [ iconEl('router', 'ico'), '连接跟踪' ]),
				bar(ctPct, (ct.count != null ? ct.count : '—') + (ct.max ? ' / ' + ct.max : '')),
				EE('div', { 'class': 'll-memmeta' }, ['当前 NAT 会话数与上限'])
			]),
			EE('div', { 'class': 'll-card ll-systemp' }, [
				EE('div', { 'class': 'll-cardtitle' }, [ iconEl('cpu', 'ico'), '温度' ]),
				zoneCards.length ? EE('div', { 'class': 'll-temps' }, zoneCards) :
					EE('div', { 'class': 'll-temps' }, [
						EE('div', { 'class': 'll-temp' }, [
							EE('div', { 'class': 't-val' }, [ (sys.temp && sys.temp.text) ? sys.temp.text.split(/[,;]/)[0] : '—' ]),
							EE('div', { 'class': 't-name' }, [ '详情' ])
						])
					]),
				(sys.temp && sys.temp.text) ? EE('div', { 'class': 'll-memmeta' }, [ String(sys.temp.text) ]) : null
			]),
			this.procCard(sys.procs)
		]);
	},

	procCard(procs) {
		if (!procs || !procs.length)
			return null;

		const top = procs.slice().sort((a, b) => (b.cpu || 0) - (a.cpu || 0)).slice(0, 8);
		const maxCpu = Math.max(1, top[0].cpu || 1);

		return EE('div', { 'class': 'll-card ll-proc' }, [
			EE('div', { 'class': 'll-cardtitle' }, [ iconEl('cpu', 'ico'), '进程 TOP 8 (按 CPU)' ]),
			EE('div', { 'class': 'll-proclist' }, top.map((p) => {
				const cmd = String(p.command || '').split(/\s+/)[0].split('/').pop() || '—';
				return EE('div', { 'class': 'll-procrow' }, [
					EE('span', { 'class': 'p-cmd' }, [ cmd ]),
					EE('span', { 'class': 'p-bar' }, [
						EE('i', { 'style': 'width:' + Math.min(100, (p.cpu / maxCpu) * 100) + '%' })
					]),
					EE('span', { 'class': 'p-cpu mono' }, [ (p.cpu || 0) + '%' ]),
					EE('span', { 'class': 'p-pid mono' }, [ '#' + p.pid ])
				]);
			}))
		]);
	},

	ring(pct, label) {
		pct = Math.max(0, Math.min(100, Number(pct) || 0));
		return EE('div', { 'class': 'll-ring', 'style': '--p:' + pct }, [
			EE('div', { 'class': 'll-ring-in' }, [
				EE('span', { 'class': 'll-ring-v' }, [ Math.round(pct) + '%' ]),
				EE('span', { 'class': 'll-ring-l' }, [ label ])
			])
		]);
	},

	rateCard() {
		const r = this.currentRate;
		const rpm = (b) => fmtBytes(b) + '/s';

		const canvas = EE('canvas', { 'class': 'll-rate-canvas', 'width': 480, 'height': 72 });
		const body = EE('div', { 'class': 'll-card ll-rate' }, [
			EE('div', { 'class': 'll-cardtitle' }, [
				EE('span', { 'class': 'ico' }, [ (function () {
					const el = EE('span');
					el.innerHTML = TYPE_ICONS.router;
					return el.firstChild;
				})() ]),
				'WAN 实时速率' + (r ? ' · ' + r.iface : '')
			]),
			EE('div', { 'class': 'll-rate-nums' }, [
				EE('span', { 'class': 'dn' }, [ EE('b', {}, [ r ? rpm(r.rx) : '—' ]), ' 下载' ]),
				EE('span', { 'class': 'up' }, [ EE('b', {}, [ r ? rpm(r.tx) : '—' ]), ' 上传' ])
			]),
			canvas,
			EE('div', { 'class': 'll-memmeta' }, [
				r ? '最近 ' + this.rateHistory.length + ' 次采样 · 每 10 秒更新' : '正在采集首个采样点…'
			])
		]);

		/* canvas 需要在节点进入文档后才能取到尺寸, 延迟一帧绘制 */
		window.setTimeout(() => this.drawRate(canvas), 0);

		return body;
	},

	drawRate(canvas) {
		if (!canvas || !canvas.getContext)
			return;

		const ctx = canvas.getContext('2d');
		if (!ctx)
			return;

		const cssW = canvas.clientWidth || canvas.parentNode?.clientWidth || 300;
		const cssH = 72;
		const dpr = window.devicePixelRatio || 1;

		canvas.width = Math.max(80, Math.round(cssW * dpr));
		canvas.height = Math.round(cssH * dpr);
		canvas.style.height = cssH + 'px';

		const w = canvas.width, h = canvas.height;
		ctx.clearRect(0, 0, w, h);

		const hist = this.rateHistory || [];
		if (hist.length < 2) {
			ctx.fillStyle = 'rgba(148,163,184,.55)';
			ctx.font = (11 * dpr) + 'px system-ui, sans-serif';
			ctx.fillText('采集中…', 4, h / 2 + 4 * dpr);
			return;
		}

		let max = 1;
		for (const p of hist)
			max = Math.max(max, p.rx, p.tx);

		const stroke = (key, color, fillTop) => {
			ctx.beginPath();
			for (let i = 0; i < hist.length; i++) {
				const x = (i / (hist.length - 1)) * w;
				const y = h - (hist[i][key] / max) * (h - 6 * dpr) - 3 * dpr;
				i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
			}
			ctx.strokeStyle = color;
			ctx.lineWidth = 1.8 * dpr;
			ctx.lineJoin = 'round';
			ctx.stroke();

			ctx.lineTo(w, h);
			ctx.lineTo(0, h);
			ctx.closePath();
			ctx.fillStyle = fillTop;
			ctx.fill();
		};

		stroke('rx', '#5b7cfa', 'rgba(91,124,250,.16)');
		stroke('tx', '#8b5cf6', 'rgba(139,92,246,.13)');
	},

	/* ---------- 服务徽标 ---------- */

	renderServices() {
		const sys = this.data.system;
		if (!sys || !sys.services) {
			dom.content(this.elServices, [ this.empty('服务数据不可用') ]);
			return;
		}

		const all = sys.services.slice();
		const featured = all.filter((s) => s.enabled || s.running);
		const hidden = all.length - featured.length;
		const shown = this.showAllServices ? all : featured;

		dom.content(this.elServices, shown.map((s) => {
			const cls = s.running ? 'on' : (s.enabled ? 'idle' : 'off');
			const state = s.running ? '运行中' : (s.enabled ? '未运行' : '未启用');
			return EE('div', { 'class': 'll-badge ' + cls }, [
				svcIconEl(s.name, 'b-icon'),
				EE('div', { 'class': 'b-body' }, [
					EE('div', { 'class': 'b-name' }, [ svcLabel(s.name) ]),
					EE('div', { 'class': 'b-meta' }, [ s.name + (s.index != null ? ' · 启动序 ' + s.index : '') ])
				]),
				EE('span', { 'class': 'b-state' }, [ EE('i', { 'class': 'dot' }), state ])
			]);
		}));

		const self = this;
		if (hidden > 0 || this.showAllServices) {
			dom.content(this.elSvcMore, [
				EE('button', {
					'class': 'cbi-button ll-btn',
					'click': function() {
						self.showAllServices = !self.showAllServices;
						self.renderServices();
					}
				}, [ this.showAllServices ? '只看已启用服务' : ('显示全部 ' + all.length + ' 个服务') ])
			]);
		}
		else {
			dom.content(this.elSvcMore, [
				EE('div', { 'class': 'll-memmeta' }, [ '共 ' + all.length + ' 个服务脚本，未启用的已隐藏' ])
			]);
		}
	},

	/* ---------- 网络与无线 ---------- */

	renderNetwork() {
		const sys = this.data.system;
		if (!sys || !sys.interfaces) {
			dom.content(this.elNetwork, [ this.empty('网络数据不可用') ]);
			return;
		}

		const dev = this.dev ?? this.computeDevices();
		const stationsByIface = dev.stationsByIface;
		const cards = [];

		const ifcs = sys.interfaces.slice();
		const wan = ifcs.filter((i) => i.is_wan);
		const lan = ifcs.filter((i) => !i.is_wan);

		const kv = (k, v) => EE('div', { 'class': 'll-row' }, [
			EE('span', { 'class': 'k' }, [ k ]),
			EE('span', { 'class': 'v mono' }, [ (v == null || v === '') ? '—' : String(v) ])
		]);

		/* WAN 实时速率 + 60 点历史曲线 */
		cards.push(this.rateCard());

		for (const i of wan) {
			cards.push(EE('div', { 'class': 'll-card ll-iface ' + (i.up ? 'up' : 'down') }, [
				EE('div', { 'class': 'll-cardtitle' }, [ iconEl('router', 'ico'), 'WAN · ' + i.interface ]),
				EE('div', { 'class': 'll-iftop' }, [
					EE('span', { 'class': 'll-ip mono' }, [ (i.ip4 && i.ip4.address) || (i.ip6 && i.ip6.address) || '未获取地址' ]),
					EE('span', { 'class': 'll-tag ' + (i.up ? 'ok' : 'bad') }, [ i.up ? '已连接' : '未连接' ])
				]),
				kv('协议', i.proto),
				kv('设备', i.device),
				kv('网关', i.gateway || i.gateway6),
				kv('DNS', (i.dns && i.dns.length) ? i.dns.slice(0, 2).join(', ') : '—'),
				kv('IPv6', (i.ip6 && i.ip6.address) || '—'),
				kv('在线时长', i.up ? fmtUptime(i.uptime) : '—')
			]));
		}

		for (const i of lan) {
			cards.push(EE('div', { 'class': 'll-card ll-iface ' + (i.up ? 'up' : 'down') }, [
				EE('div', { 'class': 'll-cardtitle' }, [ iconEl('router', 'ico'), (i.interface.toUpperCase() === 'LAN' ? 'LAN' : i.interface) ]),
				EE('div', { 'class': 'll-iftop' }, [
					EE('span', { 'class': 'll-ip mono' }, [ (i.ip4 && i.ip4.address) || (i.ip6 && i.ip6.address) || '未配置' ]),
					EE('span', { 'class': 'll-tag ' + (i.up ? 'ok' : 'bad') }, [ i.up ? '已启用' : '未启用' ])
				]),
				kv('协议', i.proto),
				kv('设备', i.device),
				kv('IPv6', (i.ip6 && i.ip6.address) || '—'),
				kv('MAC', i.macaddr)
			]));
		}

		for (const r of (sys.wireless ?? [])) {
			const ifnames = (r.interfaces ?? []).map((x) => x.ifname).filter(Boolean);
			let clients = 0;
			for (const n of ifnames)
				clients += (stationsByIface[n] || 0);

			const ssids = (r.interfaces ?? []).map((x) => x.ssid).filter(Boolean);

			cards.push(EE('div', { 'class': 'll-card ll-radio ' + (r.up ? 'up' : 'down') }, [
				EE('div', { 'class': 'll-cardtitle' }, [
					svcIconEl('wpad', 'ico'),
					'无线 · ' + (wifiBand(r.radio) || r.radio)
				]),
				EE('div', { 'class': 'll-iftop' }, [
					EE('span', { 'class': 'll-ip' }, [ ssids.length ? ssids.join(' / ') : (r.radio + ' (未配置 SSID)') ]),
					EE('span', { 'class': 'll-tag ' + (r.up ? 'ok' : 'bad') }, [ r.disabled ? '已禁用' : (r.up ? '工作中' : '离线') ])
				]),
				EE('div', { 'class': 'll-radiometa' }, [
					EE('span', { 'class': 'll-chipx' }, [ '信道 ' + (r.channel ?? '—') ]),
					EE('span', { 'class': 'll-chipx' }, [ (r.frequency ? (Math.round(r.frequency * 10) / 10 + ' GHz') : '—') ]),
					EE('span', { 'class': 'll-chipx' }, [ '功率 ' + (r.txpower != null ? r.txpower + ' dBm' : '—') ]),
					EE('span', { 'class': 'll-chipx strong' }, [ '客户端 ' + clients ])
				]),
				EE('div', { 'class': 'll-memmeta' }, [
					'接口: ' + (ifnames.length ? ifnames.join(', ') : '—') + ' · 国家码 ' + (r.country || '—')
				])
			]));
		}

		dom.content(this.elNetwork, cards.length ? cards : [ this.empty('未检测到网络接口') ]);
	},

	/* ---------- 存储 ---------- */

	renderStorage() {
		const sys = this.data.system;
		if (!sys || !sys.mounts) {
			dom.content(this.elStorage, [ this.empty('存储数据不可用') ]);
			return;
		}

		const skip = [/^\/dev$/, /^\/sys$/, /^\/proc$/, /^\/dev\/pts$/, /^\/tmp$/];
		const mounts = sys.mounts.filter((m) => {
			if (!m || !m.mount) return false;
			if (m.device == 'devtmpfs' || m.device == 'devpts') return false;
			for (const re of skip)
				if (re.test(m.mount)) return false;
			return true;
		});

		const cards = mounts.map((m) => {
			const pct = (m.percent != null) ? m.percent : (m.size ? Math.round(m.used / m.size * 100) : 0);
			const cls = pct >= 90 ? 'danger' : (pct >= 70 ? 'warn' : '');
			return EE('div', { 'class': 'll-card ll-mount' }, [
				EE('div', { 'class': 'll-cardtitle' }, [ iconEl('disk', 'ico'), m.mount ]),
				EE('div', { 'class': 'll-bar' }, [
					EE('div', { 'class': 'll-bar-track' }, [
						EE('div', { 'class': 'll-bar-fill ' + cls, 'style': 'width:' + Math.max(0, Math.min(100, pct)) + '%' })
					]),
					EE('div', { 'class': 'll-bar-text' }, [ pct + '%' ])
				]),
				EE('div', { 'class': 'll-memmeta' }, [
					fmtBytes(m.used) + ' / ' + fmtBytes(m.size) + ' · 可用 ' + fmtBytes(m.avail)
				]),
				EE('div', { 'class': 'll-memmeta mono' }, [ m.device ])
			]);
		});

		dom.content(this.elStorage, cards.length ? cards : [ this.empty('未检测到挂载点') ]);
	},

	/* ---------- 设备看板 ---------- */

	computeDevices() {
		const d = this.data.devices;
		const result = { list: [], online: 0, totalRx: 0, totalTx: 0, stationsByIface: {} };
		if (!d)
			return result;

		const selfMacs = {};
		for (let m of (d.self_macs ?? []))
			selfMacs[fmtMac(m)] = 1;

		const devices = {};
		const upsert = (mac, info) => {
			mac = fmtMac(mac);
			if (!mac || mac == '00:00:00:00:00:00' || selfMacs[mac])
				return;
			devices[mac] = devices[mac] ?? {
				mac: mac, ip: null, hostname: null, online: false,
				wireless: false, signal: null, iface: null, rx: 0, tx: 0
			};
			const dev = devices[mac];
			if (info.ip && !dev.ip) dev.ip = info.ip;
			if (info.hostname && !dev.hostname) dev.hostname = info.hostname;
			if (info.online) dev.online = true;
			if (info.wireless) dev.wireless = true;
			if (info.signal != null && dev.signal == null) dev.signal = info.signal;
			if (info.iface && !dev.iface) dev.iface = info.iface;
			if (info.rx) dev.rx += info.rx;
			if (info.tx) dev.tx += info.tx;
		};

		const now = Date.now() / 1000;
		for (let l of (d.leases ?? []))
			upsert(l.mac, { ip: l.ip, hostname: l.hostname, online: Number(l.expiry) > now });
		for (let a of (d.arp ?? []))
			upsert(a.mac, { ip: a.ip, online: true });
		for (let s of (d.stations ?? [])) {
			upsert(s.mac, { wireless: true, signal: s.signal, iface: s.iface, online: true });
			const key = String(s.iface || '');
			result.stationsByIface[key] = (result.stationsByIface[key] || 0) + 1;
		}

		const traffic = d.traffic ?? {};
		const list = [];
		for (let mac in devices) {
			const dev = devices[mac];
			const t = traffic[dev.ip];
			if (t) {
				dev.rx += Number(t.rx) || 0;
				dev.tx += Number(t.tx) || 0;
			}
			const ouiVendor = vendorOf(dev.mac);
			dev.brand = brandSlug(dev.hostname, ouiVendor);
			dev.vendor = ouiVendor || (dev.brand ? (BRAND_NAMES[dev.brand] || dev.brand) : '未知');
			dev.type = typeOf(dev.hostname, dev.vendor);
			dev.name = dev.hostname || ((dev.vendor !== '未知' ? dev.vendor + '-' : '') + shortMac(dev.mac));
			list.push(dev);
		}

		list.sort((a, b) => {
			if (a.online != b.online) return a.online ? -1 : 1;
			return (b.rx + b.tx) - (a.rx + a.tx);
		});

		let rank = 0, last = -1;
		for (let i = 0; i < list.length; i++) {
			const total = list[i].rx + list[i].tx;
			if (total !== last) { rank = i + 1; last = total; }
			list[i].rank = total > 0 ? rank : 0;
		}

		result.list = list;
		for (const dev of list) {
			if (dev.online) result.online++;
			result.totalRx += dev.rx;
			result.totalTx += dev.tx;
		}
		return result;
	},

	buildFilters() {
		const self = this;
		const filters = [
			{ key: 'all', label: '全部' },
			{ key: 'online', label: '在线' },
			{ key: 'wireless', label: '无线' },
			{ key: 'phone', label: '手机' },
			{ key: 'computer', label: '电脑' },
			{ key: 'tv', label: '电视' },
			{ key: 'nas', label: 'NAS' },
			{ key: 'iot', label: '智能设备' }
		];
		dom.content(this.elFilters, filters.map((f) => EE('button', {
			'class': 'll-filter' + (f.key == 'all' ? ' active' : ''),
			'data-key': f.key,
			'click': function(ev) {
				self.elFilters.querySelectorAll('.ll-filter').forEach((b) => b.classList.remove('active'));
				ev.currentTarget.classList.add('active');
				self.filterKey = f.key;
				self.applyFilter();
			}
		}, [ f.label ])));
	},

	renderDevices() {
		const dev = this.dev ?? this.computeDevices();
		const list = dev.list;

		if (!list.length) {
			dom.content(this.elDevHero, []);
			dom.content(this.elDevices, [ this.empty('暂未检测到客户端设备') ]);
			this.devList = [];
			return;
		}

		const top = list.filter((x) => x.online).sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx))[0] || list[0];
		const topTotal = top.rx + top.tx;

		if (topTotal > 0) {
			dom.content(this.elDevHero, [
				EE('div', { 'class': 'll-hero' }, [
					iconEl(top.type, 'll-hero-icon', top.brand),
					EE('div', { 'class': 'll-hero-body' }, [
						EE('div', { 'class': 'll-hero-title' }, ['今日流量冠军']),
						EE('div', { 'class': 'll-hero-name' }, [ top.name ]),
						EE('div', { 'class': 'll-hero-meta' }, [
							`${TYPE_NAMES[top.type] || '设备'} · ${top.vendor} · ${top.wireless ? '无线' : '有线'} · ${top.ip || '—'}`
						]),
						EE('div', { 'class': 'll-hero-traffic' }, [
							`↓ ${fmtBytes(top.rx)}`, EE('span', { 'class': 'sep' }, '/'), `↑ ${fmtBytes(top.tx)}`
						])
					]),
					EE('div', { 'class': 'll-hero-badge' }, [ 'TOP 1' ])
				])
			]);
		}
		else {
			dom.content(this.elDevHero, [
				EE('div', { 'class': 'll-hero muted' }, [
					EE('div', { 'class': 'll-hero-body' }, [
						EE('div', { 'class': 'll-hero-title' }, ['今日流量统计']),
						EE('div', { 'class': 'll-hero-name' }, ['暂无数据']),
						EE('div', { 'class': 'll-hero-meta' }, ['流量计数器刚建立或设备刚刚上线，稍等片刻即可看到排行'])
					])
				])
			]);
		}

		/* 设备流量条的基准: 全设备今日最大流量 */
		this.devMax = 1;
		for (const d of list)
			this.devMax = Math.max(this.devMax, d.rx + d.tx);

		dom.content(this.elDevices, list.map((d) => this.deviceCard(d)));
		this.devList = list;
		this.applyFilter();
	},

	deviceCard(dev) {
		const type = dev.type || 'unknown';
		const band = dev.wireless ? (wifiBand(dev.iface) || '无线') : '有线';
		const sig = dev.wireless ? signalText(dev.signal) : null;

		/* 双色流量条: 整体长度 = 相对全网最大流量, 内部按下载/上传切分 */
		const total = dev.rx + dev.tx;
		const scale = total > 0 ? Math.max(4, total / (this.devMax || 1) * 100) : 0;
		const rxPct = total > 0 ? (dev.rx / total * 100) : 0;

		/* 信号强度: -95dBm(0%) ~ -35dBm(100%) */
		let sigPct = null;
		if (dev.wireless && dev.signal != null) {
			sigPct = Math.max(4, Math.min(100, (Number(dev.signal) + 95) / 60 * 100));
			if (isNaN(sigPct))
				sigPct = null;
		}

		const bars = EE('div', { 'class': 'd-bars' }, [
			EE('div', { 'class': 'd-bar-row' }, [
				EE('span', { 'class': 'd-bar-k' }, [ '今日流量' ]),
				EE('span', { 'class': 'd-bar-track' }, [
					EE('span', { 'class': 'd-bar-in', 'style': 'width:' + scale + '%' }, [
						EE('i', { 'class': 'rx', 'style': 'width:' + rxPct + '%' }),
						EE('i', { 'class': 'tx', 'style': 'width:' + Math.max(0, 100 - rxPct) + '%' })
					])
				])
			]),
			sigPct != null ? EE('div', { 'class': 'd-bar-row' }, [
				EE('span', { 'class': 'd-bar-k' }, [ '信号' ]),
				EE('span', { 'class': 'd-bar-track' }, [
					EE('span', { 'class': 'd-bar-in sig', 'style': 'width:' + sigPct + '%' })
				])
			]) : null
		]);

		return EE('div', {
			'class': 'll-card ll-device' + (dev.online ? '' : ' offline'),
			'data-type': type,
			'data-online': dev.online ? '1' : '0',
			'data-wireless': dev.wireless ? '1' : '0'
		}, [
			EE('div', { 'class': 'd-head' }, [
				iconEl(type, 'd-icon', dev.brand),
				EE('div', { 'class': 'd-title' }, [
					EE('div', { 'class': 'd-name' }, [ dev.name ]),
					EE('div', { 'class': 'd-meta' }, [ `${dev.vendor} · ${TYPE_NAMES[type] || '设备'}` ])
				]),
				dev.rank == 1 ? EE('span', { 'class': 'd-rank top' }, ['TOP 1']) :
					(dev.rank > 1 ? EE('span', { 'class': 'd-rank' }, ['#' + dev.rank]) : null)
			]),
			EE('div', { 'class': 'd-rows' }, [
				EE('div', { 'class': 'd-row' }, [ EE('span', { 'class': 'k' }, ['IP 地址']), EE('span', { 'class': 'v mono' }, [ dev.ip || '—' ]) ]),
				EE('div', { 'class': 'd-row' }, [ EE('span', { 'class': 'k' }, ['MAC']), EE('span', { 'class': 'v mono' }, [ dev.mac ]) ]),
				EE('div', { 'class': 'd-row' }, [ EE('span', { 'class': 'k' }, ['连接方式']), EE('span', { 'class': 'v' }, [ band + (sig ? ` · ${sig}` : '') ]) ]),
				EE('div', { 'class': 'd-row' }, [ EE('span', { 'class': 'k' }, ['今日流量']), EE('span', { 'class': 'v mono traffic' }, [ `↓ ${fmtBytes(dev.rx)} · ↑ ${fmtBytes(dev.tx)}` ]) ])
			]),
			bars,
			EE('div', { 'class': 'd-status' }, [
				EE('span', { 'class': 'dot' + (dev.online ? ' on' : '') }),
				dev.online ? '在线' : '离线'
			])
		]);
	},

	applyFilter() {
		const key = this.filterKey || 'all';
		for (const node of this.elDevices.childNodes) {
			if (!node.getAttribute) continue;
			let show = true;
			if (key == 'online') show = node.getAttribute('data-online') == '1';
			else if (key == 'wireless') show = node.getAttribute('data-wireless') == '1';
			else if (key == 'phone') show = ['phone', 'tablet'].indexOf(node.getAttribute('data-type')) >= 0;
			else if (key == 'computer') show = ['laptop', 'desktop'].indexOf(node.getAttribute('data-type')) >= 0;
			else if (key == 'tv') show = node.getAttribute('data-type') == 'tv';
			else if (key == 'nas') show = node.getAttribute('data-type') == 'nas';
			else if (key == 'iot') show = node.getAttribute('data-type') == 'iot';
			node.style.display = show ? '' : 'none';
		}
	},

	/* ---------- 系统日志 ---------- */

	renderLog() {
		const l = this.data.log;
		const entries = (l && l.log) ? l.log : [];

		if (!entries.length) {
			dom.content(this.elLog, [ this.empty('暂无日志 (logd 不可用或日志为空)') ]);
			return;
		}

		dom.content(this.elLog, [
			EE('div', { 'class': 'll-logbox' }, entries.slice().reverse().map((e) => {
				const prio = Number(e.priority) || 6;
				const sev = SEVERITY[prio % 8] || 'info';
				const fac = FACILITY[Math.floor(prio / 8)] || 'local0';
				return EE('div', { 'class': 'll-logline sev-' + (prio % 8) }, [
					EE('span', { 'class': 'll-logtime mono' }, [ fmtClock(e.time) ]),
					EE('span', { 'class': 'll-logtag' }, [ fac + '.' + sev ]),
					EE('span', { 'class': 'll-logmsg' }, [ String(e.msg ?? '') ])
				]);
			}))
		]);
	},

	empty(text) {
		return EE('div', { 'class': 'll-empty' }, [ String(text) ]);
	},

	refresh() {
		const self = this;

		/* 视图已被卸载 —— 注销轮询，避免离开页面后继续请求 */
		if (!this.rootEl || !document.body.contains(this.rootEl)) {
			if (this.pollFn)
				poll.remove(this.pollFn);
			return Promise.resolve();
		}

		/* 用户暂停了实时刷新, 跳过本次拉取 (历史与图表保留原样) */
		if (this.paused)
			return Promise.resolve();

		const safe = (p) => p.catch(() => null);

		return Promise.all([
			safe(callDevices()),
			safe(callSystem()),
			safe(callLog(40)),
			safe(callPing(PING_TARGETS))
		]).then(function(raw) {
			self.data = {
				devices: (raw[0] && typeof raw[0] == 'object') ? raw[0] : self.data.devices,
				system: (raw[1] && typeof raw[1] == 'object') ? raw[1] : self.data.system,
				log: (raw[2] && typeof raw[2] == 'object') ? raw[2] : self.data.log,
				ping: (raw[3] && typeof raw[3] == 'object') ? raw[3] : self.data.ping
			};
			self.renderAll();
			self.pushHistory();
		}).catch(function() {});
	},

	/* 把本次采样追加到历史缓冲 (供趋势图 / 延迟测速卡使用) */
	pushHistory() {
		if (this.paused)
			return;
		const sys = this.data.system;
		if (sys && sys.conntrack && sys.conntrack.count != null) {
			this.connHist.push(sys.conntrack.count);
			if (this.connHist.length > 60)
				this.connHist.shift();
		}
		if (sys && sys.system && sys.system.memory) {
			const m = sys.system.memory;
			const used = Math.max(0, (m.total || 0) - (m.free || 0) - (m.buffered || 0));
			const pct = m.total ? Math.round(used / m.total * 100) : 0;
			this.memHist.push(pct);
			if (this.memHist.length > 60)
				this.memHist.shift();
		}
		const ping = this.data.ping;
		if (ping && ping.results) {
			for (const r of ping.results) {
				/* 探测失败(null)不写入历史, 否则会把 null 当 0 画出一条假谷底 */
				if (r.ms == null)
					continue;
				const h = this.latencyHist[r.host] = this.latencyHist[r.host] || [];
				h.push(r.ms);
				if (h.length > 30)
					h.shift();
			}
		}
	}
});
