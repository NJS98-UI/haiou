/**
 * Layout plugin, browser half: one register() call contributes AppFrame into
 * the runtime's built-in 'root' slot and, in the same breath, declares the
 * five child slots (declaration = exclusive render authority), seats the
 * layout store (panel geometry), and wires the panel-action service face.
 * ctx.layout selects the main panel and controls column geometry; Session
 * selection belongs to the Workspace navigation service. A second effect seats
 * the theme presenter, which projects ctx.theme snapshots onto document.body,
 * and the remaining effects carry the Android/mobile UI adaptations.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Side-effect type imports: the renderer declares 'root' + ctx.slots, the
// session plugin contributes useSessions, the workspace plugin ctx.uiWorkspace,
// the theme plugin ctx.theme.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { BoundActions, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PanelInfo } from './service.ts'
import { AppFrame } from './AppFrame.tsx'
import { createLayoutStore } from './stores.ts'
import { LayoutController } from './service.ts'
import { ThemePresenter } from './theme-presenter.ts'
import { ThemeBridge } from './theme-bridge.ts'
import { EnterGuard } from './enter-guard.ts'
import { KeyboardBoundary } from './keyboard-boundary.ts'
import { ExportResultDialog } from './ExportResultDialog.tsx'
import { createExportResultStore, type ExportResultPayload } from './export-result.ts'
import { MOBILE_SETTINGS_CSS } from './mobile-settings.css.ts'
import { COMPOSER_MENU_CSS } from './composer-menu.css.ts'
import { COMPOSER_ROW_CSS } from './composer-row.css.ts'
import { COMPOSER_INSETS_CSS } from './composer-insets.css.ts'
import { TRAJECTORY_DETAILS_CSS } from './trajectory-details.css.ts'
import { TrajectoryPanelsObserver } from './trajectory-panels-observer.ts'
import { MenuViewportGuard } from './menu-viewport-guard.ts'
import { SESSION_LOG_DIALOG_HIDE_CSS } from './session-log-dialog.css.ts'
import { DevSection } from './dev-section/DevSection.tsx'
import { DEV_SECTION_CSS } from './dev-section/dev-section.css.ts'
import { GeneralSettings } from './general-settings/GeneralSettings.tsx'

// Contract exports only (export-convergence rule: cross-package consumers
// keep a symbol exported; test-only/package-internal symbols live off /src).
// ILayout: the ctx.layout face consumers and test fakes type against.
// OwnerShare contracts below are the render-side halves registrants compose
// against; the frame components and the store factory are package-internal.
export { LayoutController } from './service.ts'
export type { ILayout, MainPanelId, PanelInfo } from './service.ts'

/** Selector hook over root-scoped panel selection. */
export type UsePanelInfo = SnapshotSelectorHook<PanelInfo>

declare global {
  interface Window {
    /** Android shell session-export outcome bridge (success / failure). */
    __dshExportResult?: (payload: ExportResultPayload) => void
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The outward face only; the concrete service stays inside this plugin. */
    layout: import('./service.ts').ILayout
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface GlobalStandardProps {
    /** Subscribe to the selected main panel independently of parent renders. */
    usePanelInfo: UsePanelInfo
  }
  interface SlotMap {
    // The 'root' entry itself is the runtime's built-in slot (declared
    // there); these five are the frame's children, declared by the same
    // register() call that contributes AppFrame. Session owners never pass
    // sessionId: the framework injects it as a standard prop.
    /**
     * The whole left column. OCCUPIED by ui-sidebar's SidebarRoot, which
     * declares the workspace and settings seats inside it — registering here
     * replaces the navigation column outright rather than adding to it, and
     * the seats it declares disappear with it. To add something to the
     * sidebar, register into one of those inner seats instead.
     *
     * The occupant receives the frame's live column state (collapsed, width)
     * and is expected to render the compact control rail while collapsed.
     */
    'sidebar': { kind: 'single'; scope: 'root'; owner: SidebarOwnerProps }
    /**
     * Central panel selected by sidebar entry id. The reserved `conversation`
     * key hosts the Conversation; other keys receive no Session binding.
     */
    'main': { kind: 'keyed'; scope: 'root' }
    /**
     * The right column: a track the centre makes room for, or nothing. OCCUPIED
     * by the right Sidebar, which uses the resolved column width in normal
     * mode and covers the viewport in fullscreen, retaining the wide-screen
     * column reservation underneath.
     *
     * Whether the panel is shown, and whether it takes a track, is the
     * occupant's own recorded business — it reports the composition of its
     * expanded and presentation state through `ctx.layout`, and the frame sizes
     * the track and places the resize handle from that. The expand control is
     * not this column's: it is a button in the conversation header. The root
     * occupant decides when to render its Session-bound content.
     */
    'rightbar': { kind: 'single'; scope: 'root'; owner: RightbarOwnerProps }
    /**
     * Frame-wide floating layer, above every column and outside their scroll
     * containers. Deliberately generic and unowned by any feature: a badge, a
     * toast stack or a status pill all belong here, and entries order among
     * themselves. The layer itself is click-through — entries opt back into
     * pointer events — so an occupant never blocks the app underneath.
     *
     * This is the additive seat for a frame-wide surface of your own: a fresh
     * `id` is added beside the shipped entries instead of replacing them.
     */
    'shell.overlay': { kind: 'list'; scope: 'root' }
    /**
     * Window-chrome seat at the frame's top-left, over every main panel.
     * Mounted only while the sidebar column is fully hidden, so the occupant
     * can assume the frame edge is the window edge. OCCUPIED by ui-sidebar's
     * reopen/New Session controls.
     */
    'shell.leading': { kind: 'single'; scope: 'root' }
    /**
     * Developer-options child seat (2026-08-23): feature-owned blocks under the
     *「开发者选项」section — ADB authorization panel etc. Listed like the
     * general.item seat the shell declares; registered by dsh-android-bridge.
     */
    'settings.dev.item': { kind: 'list'; scope: 'root' }
  }
}

// OwnerShare contracts — the render-side share the slot owner supplies at
// renderSlot. Registrants IMPORT these and compose their full component props
// through the four-share intersection (PropsRuntime & PropsRenderSlots &
// PropsStore & I). Conversation business state and actions arrive through
// framework-standard hooks and each registrant's inject face, not owner props.

/** Sidebar owner share: live column state from the frame's concession solve. */
export interface SidebarOwnerProps {
  /** True when the sidebar is closed (the column renders the compact control rail). */
  collapsed: boolean
  /** Rendered column width in px (SIDEBAR_COLLAPSED when collapsed). */
  width: number
}

/** Right column owner share: resolved normal geometry and opening eligibility. */
export interface RightbarOwnerProps {
  /** Resolved normal panel width in px, not the saved preference; zero if it cannot fit. */
  width: number
  /** Current frame width in px. */
  viewportWidth: number
  /**
   * Whether a normal right panel can retain 300px beside a 400px center.
   * Before a narrow opening, includes the space from collapsing the left sidebar.
   */
  canShow: boolean
}

/**
 * Required services (cordis fiber inject — the loader passes all module
 * exports as an object plugin).
 *
 * `uiWorkspace` is deliberately NOT listed: dsh-client-ui-workspace declares an
 * edge to this layout plugin, so depending on it back would deadlock the boot
 * (the frame must activate first). The F5 poller below reaches it through the
 * lazy ctx getter instead, inside its existing retry guard.
 */
export const inject = ['slots', 'theme']

/**
 * Client plugin body: provide ctx.layout, then one register() call — AppFrame
 * into 'root' with the five child-slot declarations and the layout store seat.
 * The 0.1.7 registration has no inject hook, so the store handle is created
 * here and its single instance is shared between the frame and the service
 * face. Later effects carry the Android/mobile UI adaptations.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const handle = createLayoutStore()
    const instance = handle.create()
    // The frame gets the same instance the service writes: one source of truth
    // for panel geometry and the central-panel selection.
    const store = { ...handle, create: () => instance }
    const retainMainPanels = (): void => {
      instance.actions.retainMainPanels(
        ctx.slots.entries('main').flatMap((entry) => entry.options.key === undefined ? [] : [entry.options.key]),
      )
    }
    const layout = new LayoutController(
      instance.actions,
      (id) => ctx.slots.entries('main').some((entry) => entry.options.key === id),
      { getSnapshot: () => instance.getSnapshot().panelInfo, subscribe: (listener) => instance.subscribe(listener) },
    )
    // Publish usePanelInfo as a root-scoped standard hook for every panel-aware
    // component, independently of the frame's own renders.
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: layout.panelInfo } })
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'main': { kind: 'keyed', scope: 'root' },
        'rightbar': { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
        'shell.leading': { kind: 'single', scope: 'root' },
      },
      // Exclusive store: the shared-instance handle above — the framework
      // delivers useStore/actions to AppFrame as standard props.
      store,
    }, AppFrame)
    const disposePanels = ctx.slots.subscribe('main', retainMainPanels)
    retainMainPanels()
    return () => {
      layout.dispose()
      disposePanels()
      disposeRegistration()
      disposePanelInfo()
      // provide()'s disposer settles asynchronously; teardown is synchronous fire-and-forget.
      void disposeService()
    }
  }, 'ui-layout: service + root registration')

  // Mobile settings-panel adaptation: the upstream settings modal is a
  // fixed 800px two-column panel; below the mobile breakpoint it is
  // re-shaped to a single column (nav strip scrolls horizontally). The
  // upstream CSS Modules class names are hashed and unreachable from here,
  // so the stylesheet targets the dialog's ARIA attributes instead.
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'mobile-settings')
    style.textContent = MOBILE_SETTINGS_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'ui-layout: mobile settings styles')

  // Developer options: a settings page on the upstream official
  // settings.section extension point — the shell projects the nav row from
  // the registration options, so no upstream DOM injection is needed.
  // Android shell facilities: restart engine / reload UI / console / dev log.
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'dev-section')
    style.textContent = DEV_SECTION_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'ui-layout: dev section styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'android-dev',
    order: 99,
    label: () => '开发者选项',
    // 开发者选项子区（2026-08-23）：ADB 授权面板等安卓调试设施挂进此槽——不开独立导航行。
    children: { 'settings.dev.item': { kind: 'list', scope: 'root' } },
  }, DevSection))

  // Android general-settings rows (issue #59): font-size slider + immersive
  // status-bar toggle. The upstream General section lost these two rows; the
  // shell bridges (setTextZoom / setImmersiveMode) exist and persist, the UI
  // never called them. Registered into settings.general.item with a low order
  // so the rows appear after the built-in items.
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'android-general',
    order: 90,
    label: () => 'Android 显示',
  }, GeneralSettings))

  // Composer control-row narrow fix: the 176px model pill overlaps the
  // permission pill below the 400px breakpoint; cap it on phones.
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'composer-row')
    style.textContent = COMPOSER_ROW_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'ui-layout: composer row narrow fix')

  // Composer insets adaptation: pad composer seat with system bottom / IME bottom.
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'composer-insets')
    style.textContent = COMPOSER_INSETS_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'ui-layout: composer insets adaptation')

  // Composer command-menu scroll fix: the upstream menu viewport lacks
  // flex:1, so an over-long candidate list is clipped unscrollable.
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'composer-menu')
    style.textContent = COMPOSER_MENU_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'ui-layout: composer menu scroll fix')

  // Trajectory local details panel (issue apk#67): on narrow screens the
  // upstream panel is confined between the timeline bar and the composer seat.
  // Overlay it full-viewport so it has real reading space (fixed escapes the
  // ledger; the panel's own body scrolls).
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'trajectory-details')
    style.textContent = TRAJECTORY_DETAILS_CSS
    document.head.appendChild(style)
    // 旧 WebView 不认 :has()（#17 回归，MIUI12/Chromium 83）：class 降级路径兜底。
    const ledger = document.querySelector<HTMLElement>('[class*="ledger"]')
    const observer = new TrajectoryPanelsObserver(ledger)
    observer.attach()
    return () => {
      observer.detach()
      style.remove()
    }
  }, 'ui-layout: trajectory details full-viewport overlay + :has() fallback')

  // Mobile chrome occupies the top viewport edge; keep an upward-opening
  // command menu below it rather than hiding its first rows beneath the bar.
  ctx.effect(() => {
    const guard = new MenuViewportGuard()
    guard.attach()
    return () => { guard.detach() }
  }, 'ui-layout: mobile command menu top clearance')

  // Session-log export: the shell owns the only result dialog (success/failure
  // via window.__dshExportResult). Hide the upstream preparing/success/error
  // modal so two dialogs never stack on Android.
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'session-log-dialog')
    style.textContent = SESSION_LOG_DIALOG_HIDE_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'ui-layout: hide upstream session-log dialog')

  // Theme presentation: pure DOM writes from resolved snapshots — initial
  // state through the getter once, then event-driven only; no React path.
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-layout: theme presenter')

  // Mobile Enter guard: on the mobile form the soft-keyboard Enter key must
  // insert a newline instead of submitting — the send button is the only
  // send channel. Desktop and command-menu/IME paths stay untouched.
  ctx.effect(() => {
    const guard = new EnterGuard()
    guard.attach()
    return () => { guard.detach() }
  }, 'ui-layout: mobile enter guard')

  // Mobile keyboard boundary (issue #57): while the IME is open the mobile
  // frame keeps its 100% height (the layout viewport does not shrink on
  // Android 16 edge-to-edge), leaving a scrollable blank band under the
  // composer. Pin the frame to the visualViewport height while an IME inset
  // is present so the blank band is clipped instead of scrolled into view.
  ctx.effect(() => {
    const boundary = new KeyboardBoundary()
    boundary.attach()
    return () => { boundary.detach() }
  }, 'ui-layout: mobile keyboard boundary')

  // Theme bridge: prefers-color-scheme → OS dark state on WebViews whose
  // media query does not track uiMode (vivo/Android 16 observed). The shell
  // pushes window.__dshThemeBridge.setDark() on Configuration changes.
  ctx.effect(() => {
    const bridge = new ThemeBridge()
    bridge.install()
    return () => { /* the hook is global and idempotent: no teardown needed */ }
  }, 'ui-layout: theme bridge')

  // Export-result dialog: the shell's session-export download finishes on a
  // background thread and reports through window.__dshExportResult. The bridge
  // dispatches a DOM event into the React tree; the dialog entry reads it from
  // the store below. Registration waits on the shell.overlay declaration
  // owned by this plugin's root entry.
  let exportActions: BoundActions<ReturnType<typeof createExportResultStore>> | undefined
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'export-result',
    store: createExportResultStore,
    inject: (actions: BoundActions<ReturnType<typeof createExportResultStore>>) => {
      exportActions = actions
      return {}
    },
  }, ExportResultDialog))

  // PRD F5 消费端（2026-08-23 补齐）：外部文件/图片 → 宿主 dsh-android-file-open 已创建
  // 强制新会话（种子消息 = @文件路径 + 上下文）。本消费端轮询 GET /api/android/file-incoming，
  // 对带 sessionId 的条目：自动切到该会话（绝不并入既有会话）→ claim 删除条目。
  // 失败重试（会话可能尚未同步进客户端列表）；非安卓宿主无该端点时静默跳过。
  ctx.effect(() => {
    const opened = new Set<string>()
    let busy = false
    const poll = async (): Promise<void> => {
      if (busy) return
      busy = true
      try {
        const r = await fetch('/api/android/file-incoming')
        if (!r.ok) return
        const j = (await r.json().catch(() => null)) as { items?: Array<{ sessionId?: string; file?: string }> } | null
        if (!j?.items) return
        for (const item of j.items) {
          if (!item.sessionId || opened.has(item.sessionId)) continue
          try {
            // Lazy ctx getter (see the inject note above): the workspace
            // plugin activates after this entry, so an early poll just retries.
            ctx.uiWorkspace.openSession(item.sessionId as SessionId)
            opened.add(item.sessionId)
            void fetch('/api/android/file-incoming/claim', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ file: item.file }),
            }).catch(() => { /* claim 失败（条目已删/端点缺）不阻断 */ })
          } catch {
            /* 会话尚未同步进列表：下轮重试 */
          }
        }
      } catch {
        /* 端点不存在（桌面/非壳宿主）：静默 */
      } finally {
        busy = false
      }
    }
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void poll() }, 4000)
    const onVisible = (): void => { if (document.visibilityState === 'visible') void poll() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    void poll()
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, 'ui-responsive: file-incoming consumer (F5)')

  ctx.effect(() => {
    const onResult = (event: Event): void => {
      const payload = (event as CustomEvent<ExportResultPayload>).detail
      if (payload === null || typeof payload !== 'object') return
      if (typeof payload.ok !== 'boolean' || typeof payload.title !== 'string' || typeof payload.detail !== 'string') return
      exportActions?.show(payload)
    }
    const bridge = (payload: ExportResultPayload): void => {
      window.dispatchEvent(new CustomEvent('dsh:export-result', { detail: payload }))
    }
    window.__dshExportResult = bridge
    window.addEventListener('dsh:export-result', onResult)
    return () => {
      window.removeEventListener('dsh:export-result', onResult)
      delete window.__dshExportResult
    }
  }, 'ui-layout: export result dialog bridge')
}
