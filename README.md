# CLX-S20P 固件构建 (ImmortalWrt 25.12 / mtk k6.12)

分支 `25.12-mtk-k6.12` 是**固件构建流水线**分支；`master` 是上游的救砖工具/资料分支，两者互不相干。

- 设备：`mediatek/filogic · clx_s20p · aarch64_cortex-a53`
- 源码：`chasey-dev/immortalwrt-mt798x-rebase` 分支 `25.12`
- 基线配置：`25.12/s20p.config`，取自 SmartRouterZone 官方 release
  `v25.12-mtk-k6.12`（tag `20260215`，源码 commit `6ff0496`）的 `config.buildinfo`
- 追加内容：**琉璃 Liuli 主题**（设为默认主题）+ **琉璃看板** + **Lucky**

## ⚠️ 必须知道：本仓库**不是**官方源码的修改版

`SmartRouterZone/CLX-S20P` 上游仓库**没有 25.12 源码分支**，它只有：

```
21.02-mtk-k5.4    24.10-mtk-k6.6    master(救砖工具)    merge-24.10
```

它的 `v25.12-mtk-k6.12` release 是用上游 `chasey-dev/immortalwrt-mt798x-rebase`
构建的（可从官方固件的 `/etc/openwrt_release` 里 `DISTRIB_REVISION='r0-6ff0496'`
反查到）。本仓库只是 **fork 了它的仓库名**并沿用其配置基线，源码取自上游分支。

### 实际产物 = 官方配置基线 + 上游最新代码

| | 官方 v25.12 release | 本仓库构建 |
|---|---|---|
| 源码 commit | `6ff0496`（2026-02-14） | 分支 `25.12` 当前 HEAD `03eb306`（2026-10-15） |
| luci-base | 26.042.32073~dd800de | **26.293.13009~61e876e** |
| ucode / libucode | 2025.12.01~f7c2b97a-r1 | **2026.01.16~85922056-r2** |
| rpcd | 2025.12.03~ffb9961c-r1 | **2026.10.04~d99f703e-r1** |
| uhttpd | 2025.10.03~ebb92e6b-r1 | **2026.08.24~373145f7-r1** |
| 包总数 | 516 | 527 |

也就是：**包集合（配置）与官方一致，但代码版本比官方 release 新约 8 个月。**
想要与官方快照逐位一致的构建，需要额外 pin：源码 `6ff0496`、
luci feed `dd800de`、packages feed 到 2026-02-14 附近（三个坐标均已验证可定位）。

## 目录

```
.github/workflows/build-s20p.yml   构建 + 出厂固件取证验证
25.12/s20p.config                  官方 v25.12 基线配置 + liuli/lucky
25.12/diy-part1.sh                 feeds / liuli / lucky / 崩溃守卫
25.12/diy-part2.sh                 配置定型 + 关键包硬校验
luci-theme-liuli/                  琉璃主题源码（编进镜像）
luci-app-liuli/                    琉璃看板源码（编进镜像）
```

## 触发构建

Actions → `CLX-S20P 25.12 (mtk-k6.12)` → Run workflow。

---

# ⚠️ LuCI 登录页 500 的真正根因（`left-hand side is not a function`）

## 症状

刷机后打开 LuCI 直接报错：

```
Error / Unhandled exception during request dispatching /
left-hand side is not a function
In [anonymous function](), file /usr/share/ucode/luci/runtime.uc, line 133, byte 10
  called from function [arrow function] (/usr/share/ucode/luci/runtime.uc:141:63)
  called from function render ([C])
  called from function [anonymous function] (/usr/share/ucode/luci/runtime.uc:141:64)
  called from function [anonymous function] (/usr/share/ucode/luci/dispatcher.uc:960:44)
  called from anonymous function (/www/cgi-bin/luci:39:13)
```

## 根因：ucode 没有 `String()` 全局函数

**ucode 的全局函数表只有 71 个**（见 `jow-/ucode` 的 `lib.c`）：

```
chr die exists exit filter getenv hex index int join keys lc length ltrim map
ord pop print push reverse rindex rtrim shift sort splice slice split substr
time trim type uchr uc unshift values sprintf printf require iptoarr arrtoip
match replace json include warn system trace proto sleep assert render regexp
wildcard sourcepath min max b64dec b64enc uniq localtime gmtime timelocal
timegm clock hexdec hexenc gc loadstring loadfile call signal
```

**里面没有 `String`。** 琉璃主题模板里有 10 处 `String(...)` 调用
（`head.ut` 5 处、`header.ut` 1 处、`sysauth.ut` 4 处），
对它做函数调用就是调用 `undefined` → 抛 `left-hand side is not a function`。

### 为什么会让整个 LuCI 都打不开

`dispatcher.uc` 的登录分支是两条路：

```ucode
// 953: 先试主题自己的 sysauth
try { return runtime.render(theme_sysauth, scope); }
catch (e) { runtime.env.media_error = `${e}`; }

// 960: 失败则回退 base sysauth
return runtime.render('sysauth', scope);
```

两条路都会走到 `include('themes/<theme>/header')` → `head.ut`，
于是两条都炸，第 960 行的异常没被 catch，LuCI 直接 500。

### 修复

把 `String(x)` 换成模板字面量实现的局部 helper：

```ucode
const liuli_str = (v) => (v == null ? '' : `${v}`);
```

## 被推翻的错误结论：`getspnam`

此前判断「`luci.core` 未导出 `getspnam`，导致
`{% if (getuid() == 0 && getspnam('root')?.pwdp === ''): %}` 崩溃」，
改完之后重新编译刷机，**报错一模一样**。取证结果推翻了这个结论：

| 证据 | 结果 |
|---|---|
| 出厂固件 `bootstrap/header.ut` / `argon/header.ut` 含裸 `getspnam` | 是（两边都有） |
| 「可用固件」与「崩溃固件」的 `/usr/lib/ucode/luci/core.so` 字符串表比对 | **137 条完全一致，零差异**，两边都导出了 `getspnam` |
| ucode 全局表里 `getspnam` | 不在表里（它由 luci-base 的 core.so 导出，与 ucode 无关） |

也就是说 `getspnam` 从来就不是问题。真正的差异在于：
**官方固件没有琉璃主题**，渲染的是 `bootstrap`，所以官方固件不崩。

> `getspnam` 的存在性守卫仍保留在 `diy-part1.sh` 里作为纵深防御，
> 但它不是主防线。

## 取证方法（可复用）

固件是 squashfs，`.apk` 包（ADBd 签名 + raw deflate）用 gzip/zstd 解不开，
直接从 `sysupgrade.bin` 切 squashfs 更可靠：

```python
import io
from PySquashfsImage import SquashFsImage

blob = open("xxx-squashfs-sysupgrade.bin", "rb").read()
off  = blob.find(b"hsqs")                       # 本例 4594176 / 5021696
img  = SquashFsImage(io.BytesIO(blob[off:]))

for node in img.root.iterdir():                 # 递归遍历
    text = node.read_text()
```

可以直接读出：

- `/etc/openwrt_release` → `DISTRIB_REVISION='r0-6ff0496'` = 源码 commit
- `/etc/apk/db/installed` → 实际装进去的包与版本
- `/usr/share/ucode/luci/**` → 出厂模板原文
- `/etc/config/luci` → `option mediaurlbase` = 实际生效的主题

## 防复发

`25.12/diy-part1.sh` 里加了构建期守卫：扫描所有 `.ut` 的 ucode 代码块
（`{% %}` / `{{ }}`，跳过 CSS 里的 `rgba()` / `blur()` / `url()`），
命中 `String()` / `Number()` / `Boolean()` / `Array.isArray` / `JSON.*` 直接
`exit 1`，绝不让带病固件绿灯出厂。

工作流还有一个「出厂固件取证验证」步骤：编译完成后把 rootfs 拆开，
逐条核对「模板无违规调用 + 默认主题是琉璃 + liuli 模板齐全 + lucky 二进制存在」。

---

## 第二轮全量审计（2026-10-22）—— 同一个病在 rpcd 后端复发

第一轮修的是 `.ut` 模板里的 `String()`。第二轮把 `root/usr/share/rpcd/ucode/`
下的脚本也审了一遍，发现**同一个根因又中了一次**，而且症状更糟：

| # | 文件 | 问题 | 后果 |
|---|------|------|------|
| B1 | `luci.liuli` ×4 | `String(s ?? '')` | `num()`/`logEntries()`/`shellquote()` 崩溃 |
| B2 | `luci.liuli` ×1 | `unixtime()` | `ping` 方法崩溃 |
| B3 | `luci.liuli` | `int("abc")` 返回 **NaN** 而非 `null` | NaN 泄进 `mountPoints`/`processes`/`conntrack` |
| B4 | `luci.liuli` | `"abc" * 1` 返回 **NaN** 而非 `null` | `toNum()` 把 NaN 当有效时延 |
| B5 | `luci.liuli` | 进程表硬编码 `f[6]` 当 %CPU | busybox top 第 6 列是 **%MEM** |
| B6 | `luci.liuli` | `awk ... 100 - $8` 取 idle | busybox 若不带 `nic` 指标即错位 |
| B7 | `luci.liuli` | `logread -l ' + count` 直接拼前端入参 | 命令注入面 |
| B8 | `luci.liuli` | 每个无线接口各建一条 ubus 连接 | socket 数随接口数线性增长 |

四个 dashboard 方法里，`getDevices` 侥幸能跑，`getSystem` / `getLog` / `ping`
**全部崩溃**—— 而旧的构建守卫只扫 `.ut` 模板，完全看不到 rpcd 脚本，
这就是它漏掉的原因。

### 怎么证实「`String` / `unixtime` 真的不存在」

不靠猜，三条独立证据互相印证：

1. **源码**：`jow-/ucode`（现 `ucode-lang/ucode`）`lib/lib.c` 的
   `uc_stdlib_functions[]` 表，71 项，`String` / `unixtime` 均不在内。
2. **出厂二进制**：OpenWrt 剥掉了 ELF section header（`e_shoff == 0`），
   `.symtab` 也没了，但可以用 program headers 定位 `.data.rel.ro`，
   按 `uc_function_list_t { const char *name; fn }` 的 16 字节 stride
   把整张表读出来 —— 71 项，与源码逐一吻合。
   `strings` 不能用来做这个判定：GCC 会合并字面量（`length` 藏在
   `ucv_string_new_length` 里 → 假阴性），而词法分析器的 token 名
   `String` 又会造成假阳性。
3. **正向对照**：同一把 stride-16 扫描器跑 `luci/core.so`，抓到了
   `getspnam` / `getuid` / `statvfs` / `uname` / `crypt` / `kill`
   —— 证明方法确实能检出已注册函数，而不是只会返回空。

### 顺带查清的两件事

- `'%1024.1m'.format(x)` **是对的**：LuCI `cbi.js` 的
  `String.prototype.format` 把 `%` 后的 `(\d+)` 当除数、`(\.\d+)` 当小数位，
  `m` 类型再套一层 1024 进制单位。看着像乱码，实际是合法的。
- `list.sort((a, b) => ...)` **是对的**：ucode 的 `uc_sort` 第二个参数
  就是比较器（`uc_fn_arg(1)` → `array_sort_fn` → `uc_vm_call`）。
- ACL 组名用包名（`luci-app-liuli`）**是有效的**：rpcd
  `rpc_login_test_permission()` 用 `fnmatch(list_entry, group)`，
  而出厂 `/etc/config/rpcd` 默认就是 `list read '*'` / `list write '*'`，
  所以 root 会话拿到全部 ACL 组。

### 防复发（已加固）

- `diy-part1.sh` 崩溃守卫现在扫三类 ucode 源码：`.ut` 模板 +
  `.uc` 控制器 + `root/usr/share/rpcd/ucode/*`；规则表从 5 条扩到 11 条
  （新增 `unixtime()` / `parseInt()` / `parseFloat()` / `Object.*` /
  `Date.now` / `Math.*`），并且**先剥注释再扫描**——之前守卫扫到自己
  写在 `{% %}` 块里的说明注释，直接让构建 `exit 1`。
- 规则表对出厂固件自带的 59 个 ucode 文件做过假阳性对照：除
  `luci.liuli` 自身外零命中。
- 守卫自带正/负向自测（`_verify/guard_test.py`）：bug 版必须 `exit 1`
  并点名行号，修复版必须 `exit 0`。
- 出厂固件复验器收进仓库成为**唯一事实源**：
  `25.12/verify-firmware.py`，CI 的「Verify built firmware」步骤直接跑它，
  本地 `_verify/verify.py` 也是它，两边规则不可能再漂移。
