'use strict';
'require rpc';
'require poll';

/* 琉璃 Liuli — topbar status chips
 * 在线设备 / CPU / 温度 / 实时流量(迷你曲线) / 时钟
 * 数据源: luci rpcd 对象 (getOnlineUsers / getCPUUsage / getTempInfo /
 * getRealtimeStats) + network.interface.wan status
 */

const callOnlineUsers = rpc.declare({
	object: 'luci',
	method: 'getOnlineUsers'
});

const callCPUUsage = rpc.declare({
	object: 'luci',
	method: 'getCPUUsage'
});

const callTempInfo = rpc.declare({
	object: 'luci',
	method: 'getTempInfo'
});

const callBandwidth = rpc.declare({
	object: 'luci',
	method: 'getRealtimeStats',
	params: [ 'mode', 'device' ],
	expect: { result: [] }
});

const callWanStatus = rpc.declare({
	object: 'network.interface.wan',
	method: 'status',
	expect: { device: '' }
});

function fmtRate(bits) {
	if (bits >= 1000000)
		return '%1024.1m'.format(bits / 1000000) + 'M';
	if (bits >= 1000)
		return '%1024.1fk'.format(bits / 1000) + 'k';
	return Math.round(bits) + 'b';
}

return L.Class.extend({
	__init__() {
		this.spark = document.getElementById('liuli-spark');
		this.rxHist = [];
		this.prev = null;
		this.wanDev = null;

		this.startClock();
		this.refresh();
		poll.add(L.bind(this.refresh, this), 5);
	},

	/* ---- 时钟 ---- */
	startClock() {
		const el = document.getElementById('liuli-clock');
		if (!el)
			return;
		const tick = () => {
			const d = new Date();
			const pad = (n) => (n < 10 ? '0' + n : '' + n);
			el.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
		};
		tick();
		setInterval(tick, 1000);
	},

	hide(id) {
		const el = document.getElementById(id);
		if (el)
			el.style.display = 'none';
	},

	/* ---- 轮询 ---- */
	refresh() {
		L.resolveDefault(callOnlineUsers(), null).then(res => {
			const el = document.getElementById('liuli-clients');
			if (el && res && res.onlineusers != null)
				el.textContent = res.onlineusers;
		}).catch(() => this.hide('liuli-chip-clients'));

		L.resolveDefault(callCPUUsage(), null).then(res => {
			const el = document.getElementById('liuli-cpu');
			if (el && res && res.cpuusage)
				el.textContent = String(res.cpuusage).replace('%', ' %');
		}).catch(() => {});

		L.resolveDefault(callTempInfo(), null).then(res => {
			const el = document.getElementById('liuli-temp');
			if (el && res && res.tempinfo) {
				const t = String(res.tempinfo).match(/-?\d+(\.\d+)?/);
				if (t)
					el.textContent = t[0] + '°C';
			}
		}).catch(() => this.hide('liuli-chip-temp'));

		this.refreshBandwidth();
	},

	/* ---- 流量 ---- */
	refreshBandwidth() {
		const self = this;

		const pollTraffic = (dev) => L.resolveDefault(callBandwidth('interface', dev), null).then(res => {
			if (!res || !res.result || !res.result.length) {
				self.hide('liuli-chip-traffic');
				return;
			}

			const last = res.result[res.result.length - 1];
			const ts = last[0], rx = last[1] || 0, tx = last[2] || 0;

			if (self.prev && self.prev.dev === dev) {
				const dt = ts - self.prev.ts;
				if (dt > 0) {
					const rxRate = (rx - self.prev.rx) * 8 / dt;
					const txRate = (tx - self.prev.tx) * 8 / dt;
					const el = document.getElementById('liuli-rates');
					if (el)
						el.textContent = '↓ ' + fmtRate(Math.max(0, rxRate)) + ' · ↑ ' + fmtRate(Math.max(0, txRate));
					self.pushSpark(Math.max(0, rxRate));
				}
			}

			self.prev = { dev: dev, ts: ts, rx: rx, tx: tx };
		}).catch(() => self.hide('liuli-chip-traffic'));

		if (this.wanDev) {
			pollTraffic(this.wanDev);
		} else {
			L.resolveDefault(callWanStatus(), null).then(res => {
				if (res && res.device) {
					this.wanDev = res.device;
					pollTraffic(this.wanDev);
				} else {
					this.hide('liuli-chip-traffic');
				}
			}).catch(() => this.hide('liuli-chip-traffic'));
		}
	},

	/* ---- 迷你曲线 ---- */
	pushSpark(rxBits) {
		if (!this.spark)
			return;

		this.rxHist.push(rxBits);
		if (this.rxHist.length > 40)
			this.rxHist.shift();

		const max = Math.max.apply(null, this.rxHist.concat([1]));
		const w = this.spark.width, h = this.spark.height;
		const ctx = this.spark.getContext('2d');

		ctx.clearRect(0, 0, w, h);

		const grad = ctx.createLinearGradient(0, 0, 0, h);
		grad.addColorStop(0, 'rgba(91,124,250,.45)');
		grad.addColorStop(1, 'rgba(91,124,250,0)');

		ctx.beginPath();
		this.rxHist.forEach((v, i) => {
			const x = i / Math.max(1, this.rxHist.length - 1) * w;
			const y = h - (v / max) * h * 0.88 - 2;
			if (i)
				ctx.lineTo(x, y);
			else
				ctx.moveTo(x, y);
		});
		ctx.strokeStyle = '#5b7cfa';
		ctx.lineWidth = 1.6;
		ctx.stroke();
		ctx.lineTo(w, h);
		ctx.lineTo(0, h);
		ctx.closePath();
		ctx.fillStyle = grad;
		ctx.fill();
	}
});
