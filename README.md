# CLX-S20P 固件构建 (ImmortalWrt 25.12 / mtk k6.12)

分支 `25.12-mtk-k6.12` 是**固件构建流水线**分支；`master` 是上游的救砖工具/资料分支，两者互不相干。

- 设备：`mediatek/filogic · clx_s20p · aarch64_cortex-a53`
- 源码：`chasey-dev/immortalwrt-mt798x-rebase` 分支 `25.12`
- 基线配置：`25.12/s20p.config`，取自 SmartRouterZone 官方 release
  `v25.12-mtk-k6.12`（tag `20260215`，源码 commit `6ff0496`）的 `config.buildinfo`
- 追加内容：**Argon 主题 v3.1.0**（设为默认主题）+ **Lucky** + **UPnP**

## ⚠️ 必须知道：本仓库**不是**官方源码的修改版

`SmartRouterZone/CLX-S20P` 上游仓库**没有 25.12 源码分支**，它只有：

```
21.02-mtk-k5.4          24.10-mtk-k6.6
master (救砖工具/资料)   merge-24.10
```

它的 v25.12 release 是从 `chasey-dev/immortalwrt-mt798x-rebase @ 6ff0496`
（2026-02-14）构建的**二进制**。

本仓库做的是「**官方配置基线 + 上游最新代码**」：

| 坐标 | 本仓库 | 官方 v25.12 release |
|------|--------|---------------------|
| 源码 | `chasey-dev/immortalwrt-mt798x-rebase` @ `25.12`（2026-10-15） | 同仓库 @ `6ff0496`（2026-02-14） |
| luci feed | 26.293~`61e876e` | 26.042~`dd800de` |
| ucode | 2026.01.16~`85922056`-r2 | 2025.12.01~`f7c2b97a`-r1 |
| rpcd | 2026.10.04 | 2025.12.03 |
| uhttpd | 2026.08.24 | 2025.10.03 |
| 包数量 | 527 → 315（清理后） | 516 |

若要与官方快照**逐位对齐**，需额外 pin 三个坐标：源码 `6ff0496`、luci feed
`dd800de`、packages feed 到 2026-02-14 附近。
**注意：光 pin 源码 commit 没用，feeds 是构建时动态拉的。**

## 目录

```
CLX-S20P/
├── .github/workflows/build-s20p.yml   # CI：16 步，含出厂固件取证
├── 25.12/
│   ├── s20p.config                    # 配置基线（官方 buildinfo + Lucky/UPnP/Argon）
│   ├── diy-part1.sh                   # 灌入 lucky / argon + 崩溃守卫 + 默认主题
│   ├── diy-part2.sh                   # 配置定型 + 关键包硬校验 + 已下线插件复查
│   ├── posix_re_check.py              # POSIX ERE 守卫（逆序字符范围）
│   └── verify-firmware.py             # 出厂固件独立复验（唯一事实源）
└── README.md
```

主题与插件**不在仓库里**，由 `diy-part1.sh` 在构建期按 tag 克隆：

| 组件 | 来源 |
|------|------|
| Argon 主题 | `jerrykuku/luci-theme-argon` @ `v3.1.0`（feed 里只有 2.4.7，故克隆后移除 feed 副本） |
| Lucky | `gdy666/luci-app-lucky` @ `v3.3.3` + 预编译静态核心 Makefile |
| UPnP | `miniupnpd` + 官方 `luci-app-upnp`，来自标准 feed |

## 触发构建

```bash
gh workflow run build-s20p.yml --repo <你>/CLX-S20P --ref 25.12-mtk-k6.12
```

产物：`s20p-v25.12-<日期>-sysupgrade.bin` 与 `-initramfs-kernel.bin`，上传到
Release 与 Artifact。发布 tag 按日期生成，**资产会被同名覆盖**，只能靠 sha256 区分版本。

---

# 构建期防线（这是本仓库最值得留下的部分）

刷机后 LuCI 打不开，报错千奇百怪，但根因往往只有一个：**ucode 的全局函数表只有 71 个
内置**，很多 JS/Lua 惯性写法在它这里直接抛异常。为此加了三道构建期守卫。

## 1. 未注册函数守卫

ucode 的 `uc_stdlib_functions[]`（`jow-/ucode` → `ucode-lang/ucode` 的 `lib/lib.c`）
只注册 71 个：`chr die exists exit filter getenv hex index int join keys lc length
ltrim map ord pop print push reverse rindex rtrim shift sort splice slice split
substr time trim type uchr uc unshift values sprintf printf require iptoarr
arrtoip match replace json include warn system trace proto sleep assert render
regexp wildcard sourcepath min max b64dec b64enc uniq localtime gmtime timelocal
timegm clock hexdec hexenc gc loadstring loadfile call signal`

**不在表里的常见名字**：`String()` `Number()` `Boolean()` `Array.isArray`
`JSON.parse` `JSON.stringify` `parseInt()` `parseFloat()` `unixtime()` `Date.now`
`Math.*` `Object.keys`。

调用它们 = 调用 `undefined` → 抛 `left-hand side is not a function`。

**覆盖三类 ucode 源码**（`.ut` 模板 + `.uc` 控制器 + `root/usr/share/rpcd/ucode/*`）。
只扫 `.ut` 是盲区——历史上正是 rpcd 后端里的 4 处 `String()` 和 1 处 `unixtime()`，
让三个 ubus 方法全崩，而 `.ut` 扫描完全看不见。

该规则表对出厂固件自带的 59 个 ucode 文件 + Argon v3.1.0 的 13 个做过假阳性对照：
全部零命中，不会误伤上游代码。

## 2. POSIX ERE 守卫

症状：LuCI 500，报 `Invalid character range`，栈指向
`runtime.uc:133 ← dispatcher.uc:960`。

根因：ucode 的 `match()` / `replace()` 直接把模式交给 **glibc
`regcomp(REG_EXTENDED)`**（已在 `libucode.so` 里实证到 `regcomp/regexec/regfree/regerror`，
无 pcre）。而 **POSIX 规定括号表达式 `[...]` 内的反斜杠是普通字符，不是转义符**：

```ucode
/^[A-Za-z0-9\-._~:\/?#\[\]@!$&*+,;=%() ]*$/     # 错
```

实际被解析成 字符类 `A-Z a-z 0-9 \` 紧跟**范围** `\`(U+005C)..`.`(U+002E) ——
逆序 → `REG_ERANGE` → `Invalid character range`。`\[\]` 同样无效（POSIX 无法转义，
`\]` 还会提前闭合字符类）。

**官方自己的 idiom**：所有含连字符的字符类，一律把 `-` 放类尾，从不写 `\-`：

| 位置 | 正则 |
|------|------|
| `dispatcher.uc:734` | `/^[A-Za-z0-9_%.\/,;-]+$/` |
| `fw4.uc:1649` | `/^[a-zA-Z_.][a-zA-Z0-9\/_.-]*$/` |

```ucode
/^[A-Za-z0-9._~:\/?#@!$&*+,;=%() -]*$/           # 对
```

`\/` 必须保留——ucode 词法器靠它认出这不是正则结束符；glibc 只当作「字面反斜杠 +
字面斜杠」，白名单多放行一个字符无风险。

**分级**：只有**逆序范围**是致命的（`exit 1`）；`\-` 误用只发 `::warning::`。
上游 `luci-app-homeproxy` 也写了 `[A-Za-z0-9\+\-\_\.]`，但那是退化范围
`\`..`\`（同字符），`regcomp` 能编译通过——把它拦掉等于卡住能用的上游代码。

## 3. getspnam 纵深防御

`jerrykuku/luci-theme-argon v3.1.0` 的 `header.ut:67` 就有裸调用
`getspnam('root')?.pwdp === ''`。守卫会把它改成先 `type(getspnam) == 'function'` 再调。

> 取证史：曾误判「core.so 未导出 getspnam」为 LuCI 500 主因。A/B 比对推翻了它——
> 可用固件与崩溃固件的 `core.so` 字符串表 137 条完全一致，两边都导出了 getspnam。
> 现保留为纵深防御，不再是主防线。

## 出厂固件取证

`25.12/verify-firmware.py` 是**唯一事实源**：CI 的「Verify built firmware」步骤和本地
`_verify/verify.py` 跑的是同一个文件，规则不会漂移。编译完成后把 rootfs 拆开逐条核对：

| 组 | 内容 |
|----|------|
| `[1]` | 所有出厂 ucode 源码无未注册函数调用 |
| `[1b]` | 所有出厂正则无逆序字符范围 |
| `[2]` | Argon 11 个模板齐全 + CSS + 设置页 + 配置 |
| `[2b]` | UPnP 与 Lucky 关键文件在位 |
| `[3]` | `mediaurlbase = /luci-static/argon` |
| `[4]` | 无裸 `getspnam` |
| `[5]` | 关键文件在位 |
| `[6]` | 版本与目标设备 |
| `[7]` | argon / upnp / lucky / luci-app-lucky 均已安装 |
| `[8]` | 已下线插件无残留（文件路径 + 安装包双查） |

---

# 怎么证实「某个 ucode 函数不存在」

不靠猜，三条独立证据互相印证：

1. **源码**：`lib/lib.c` 的 `uc_stdlib_functions[]` 表，71 项
2. **出厂二进制**：OpenWrt 剥掉了 ELF section header（`e_shoff == 0`），`.symtab`
   也没了，但可以用 **program headers** 定位 `.data.rel.ro`，按
   `uc_function_list_t { const char *name; fn }` 的 **16 字节 stride** 把整张表读出来
   —— 71 项，与源码逐一吻合
3. **正向对照**：同一把 stride-16 扫描器跑 `luci/core.so`，抓到
   `getspnam` / `getuid` / `statvfs` / `uname` / `crypt` / `kill`
   —— 证明方法真能检出已注册函数，而不是只会返回空

> **`strings` 不能用来判定函数表**：GCC 合并字面量让 `length` 藏在
> `ucv_string_new_length` 里（假阴性），而词法分析器的 token 名 `String` 又造成
> 假阳性。两个方向都错。

# 版本清理记录（2026-10-22）

**移除**：琉璃 Liuli 主题/看板、SmartDNS、LXC 容器、WireGuard、组播转换（msd_lite），
以及为 Lucky 追加但已无用的 nas / nas_luci / istore feeds。

**保留/新增**：Lucky（v3.3.3）、UPnP（miniupnpd + luci-app-upnp）、Argon（v3.1.0）。

「已下线插件复查」同时出现在 `diy-part2.sh`（构建期，防依赖解析把它们带回来）和
`verify-firmware.py` 的 `[8]`（出厂后，按文件路径 + 安装包双查）。

# 仍未消除的不确定性

全部验证均为**静态**：本机无 qemu，跑不了固件里 aarch64 的 `/usr/bin/ucode`，
没有在真实运行时渲染过模板。最可靠的一步仍是实机刷机
（建议 `sysupgrade -n` 后访问 `192.168.123.1`）。

# 取证方法（可复用）

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

- `/etc/openwrt_release` → `DISTRIB_REVISION='r0-03eb306'` = 源码 commit
- `/lib/apk/db/installed` → 实际装进去的包与版本
- `/usr/share/ucode/luci/**` → 出厂模板原文
- `/etc/config/luci` → `option mediaurlbase` = 实际生效的主题
- `/etc/config/rpcd` → `list read '*'` / `list write '*'`（root 会话因此拿到全部 ACL 组）
