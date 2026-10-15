# dsh-client-ui-responsive

> **dsh-mobile 生态** · [dsh-mobile-apk](https://github.com/kelai141/dsh-mobile-apk)（壳 APK）· [dsh-shell-termux](https://github.com/kelai141/dsh-shell-termux)（shell）· [dsh-host-web-compat](https://github.com/kelai141/dsh-host-web-compat)（浏览器兼容）· [dsh-mobile](https://github.com/kelai141/dsh-mobile)（协调仓库，private）

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI 的移动响应式 AppFrame：
上游 `ui-layout` 的即插即用替代品，新增 **Mobile 形态**（<640px）——抽屉侧栏、底部 sheet、带汉堡的顶栏、安全区；
Wide/Narrow 行为与上游逐字节一致。

## 快速开始

**1. 安装**（放入 web profile 的 node_modules，模式见 dsh-shell-termux）。

**2. 挂载**（profile 的 `cordis.patch.yml`）：

```yaml
- id: ui-layout
  disabled: true
- insert:
    - id: ui-responsive
      name: '@dsh-android/dsh-client-ui-responsive'
```

**3. 重启**，验证浏览器名册（`window.__DSH_BOOT__` 含 `@dsh-android/dsh-client-ui-responsive`，`ui-layout` 消失）。

## 断点体系

| 档位 | 宽度 | 形态 |
|---|---|---|
| Wide | ≥1024px | 三栏，上游行为 |
| Narrow | 640–1024px | 上游自动折叠 rail + 手动展开 |
| **Mobile** | <640px | 单栏：sidebar→左抽屉、rightbar→底部 sheet、顶栏+汉堡、安全区 |

横屏手机（≥640 逻辑像素）原样复用 Wide/Narrow 界面。

## 行为说明

- **槽位与服务对齐上游 0.1.7**：`sidebar` / `main` / `rightbar` / `shell.overlay` / `shell.leading`
  与 `ctx.layout` 的提供方式与上游 ui-layout 完全一致，消费方（侧栏、对话区、工具面板）零改动。
  0.1.1 的 `conversation`/`details` 槽位名已被上游删除：中心区是 keyed 的 `main` 槽（每个面板一个
  entry，用 `ctx.layout.selectPanel()` 切换），右栏改叫 `rightbar`；
- **移动形态语义**：汉堡切换抽屉（点遮罩关闭）；`ctx.layout.openRightbar(track, fullscreen)`
  弹出底部 sheet（同一份 `rightbar` 内容，不重挂）；`shell.overlay` 保持最顶层（z 20）；
- **旋转即时切换**：同一套 rAF 节流 ResizeObserver 驱动；`prefers-reduced-motion` 关闭过渡。

## 构建

```sh
npm install          # 基线钉引擎客户端线 @deepseek-ai/* 0.1.7-rc.2（cordis 4.0.4）
                     # 精确版本与逐仓基线由协调仓 scripts/contract.json 的 repoBaselines 门禁
npm run build        # tsc（lib/types）+ tsdown（lib/client.js 浏览器包）
npm run typecheck
```

浏览器包遵循 `__ModuleLoader__.load` 契约；改动后先重建再探测线上服务（registry 提供的是 `lib/client.js` 产物）。
APK 侧把本包产物作为资产 overlay（`app/src/main/assets/patched/ui-responsive-client.js`）在每次引擎启动时
按内容指纹覆写 `profiles/{web,headless}`，所以已发布的旧快照也能自愈——**改完必须 `npm run build` 并同步该资产**。

## 测试

- 单元：`npm test`（vitest，10 文件 / 79 测试）——纯 store draft（三态 toggle、rightbar 展示上报、
  面板选择）、列宽求解、fork 专属客户端效应；
- 宿主 CDP 组件级：412px（抽屉开合/遮罩）与 1280px（三栏回归）——见协调仓库验证日志；
- 旧内核浏览器（ES2024 前 WebView）无法加载客户端包：请用较新 WebView（系统 WebView 即可），
  浏览器兼容插件可作兜底。

## License

MIT。派生自 `@deepseek-ai/dsh-client-ui-layout`（MIT, © 2026 DeepSeek），见 NOTICE。
设计文档：`docs/design.md`。
