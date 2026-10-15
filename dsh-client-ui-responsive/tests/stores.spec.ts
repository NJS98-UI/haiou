// @vitest-environment node
// Layout-store unit tests: drive the pure draft transformations exported by stores.ts
// (immer semantics = in-place draft edits) without the runtime's module loader.
// Covers the three-way toggle semantics (wide/narrow/mobile) and breakpoint-crossing resets.
import { describe, it, expect, vi } from 'vitest'

// The runtime client bundle runs window.__ModuleLoader__.load at its top level (browser-loader form),
// which vitest cannot provide; this test drives only stores.ts's pure layoutActions drafts, so
// defineStore just needs to exist (createLayoutStore is out of scope).
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  defineStore: (decl: unknown) => ({ create: () => decl }),
}))

import { layoutActions } from '../src/client/stores.ts'
import { SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX, DETAILS_DEFAULT, DETAILS_MIN, DETAILS_MAX } from '../src/client/columns.ts'

type LayoutState = {
  panelInfo: { activePanelId: string | null }
  sidebar: number
  details: number
  rightbarShown: boolean
  rightbarTrack: boolean
  rightbarFullscreen: boolean
  rightbarInstant: boolean
  narrow: boolean
  narrowExpanded: boolean
  mobile: boolean
  drawerOpen: boolean
}

/** Clone a fresh draft from the initial state before every call (immer produce semantics). */
function freshDraft(): LayoutState {
  return {
    panelInfo: { activePanelId: null },
    sidebar: SIDEBAR_DEFAULT,
    details: 0,
    rightbarShown: false,
    rightbarTrack: false,
    rightbarFullscreen: false,
    rightbarInstant: false,
    narrow: false,
    narrowExpanded: false,
    mobile: false,
    drawerOpen: false,
  }
}

describe('layoutActions 初始状态', () => {
  it('初始：sidebar=默认宽、details 关闭、右栏未展示、中央面板为会话、非窄屏、非移动、抽屉关', () => {
    const s = freshDraft()
    expect(s.sidebar).toBe(SIDEBAR_DEFAULT)
    expect(s.details).toBe(0)
    expect(s.rightbarShown).toBe(false)
    expect(s.panelInfo.activePanelId).toBeNull()
    expect(s.narrow).toBe(false)
    expect(s.narrowExpanded).toBe(false)
    expect(s.mobile).toBe(false)
    expect(s.drawerOpen).toBe(false)
  })
})

describe('面板宽度写入', () => {
  it('setSidebar 钳入契约区间', () => {
    const d = freshDraft()
    layoutActions.setSidebar(d, 100)
    expect(d.sidebar).toBe(SIDEBAR_MIN)
    layoutActions.setSidebar(d, 9999)
    expect(d.sidebar).toBe(SIDEBAR_MAX)
    layoutActions.setSidebar(d, 300)
    expect(d.sidebar).toBe(300)
  })

  it('setDetails 钳入区间且不跨开关线（0 → 被钳到 min，关闭只能走 closeDetails）', () => {
    const d = freshDraft()
    layoutActions.setDetails(d, 0)
    expect(d.details).toBe(DETAILS_MIN)
    layoutActions.setDetails(d, 9999)
    expect(d.details).toBe(DETAILS_MAX)
  })
})

describe('toggleSidebar 三态语义', () => {
  it('宽屏：翻转宽度偏好（关 ↔ 默认宽）', () => {
    const d = freshDraft()
    layoutActions.toggleSidebar(d)
    expect(d.sidebar).toBe(0)
    layoutActions.toggleSidebar(d)
    expect(d.sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('窄屏：只翻转 narrowExpanded 覆盖，宽度偏好不被重写', () => {
    const d = freshDraft()
    layoutActions.setNarrow(d, true)
    layoutActions.toggleSidebar(d)
    expect(d.narrowExpanded).toBe(true)
    expect(d.sidebar).toBe(SIDEBAR_DEFAULT) // preference preserved
    layoutActions.toggleSidebar(d)
    expect(d.narrowExpanded).toBe(false)
  })

  it('移动形态：翻转抽屉开关，不碰宽度偏好', () => {
    const d = freshDraft()
    layoutActions.setMobile(d, true)
    layoutActions.toggleSidebar(d)
    expect(d.drawerOpen).toBe(true)
    expect(d.sidebar).toBe(SIDEBAR_DEFAULT)
    layoutActions.toggleSidebar(d)
    expect(d.drawerOpen).toBe(false)
  })
})

describe('断点穿越', () => {
  it('进入窄屏重置 narrowExpanded（默认回到自动折叠）', () => {
    const d = freshDraft()
    layoutActions.setNarrow(d, true)
    layoutActions.toggleSidebar(d) // expand override
    expect(d.narrowExpanded).toBe(true)
    layoutActions.setNarrow(d, false) // leave narrow
    layoutActions.setNarrow(d, true) // re-enter
    expect(d.narrowExpanded).toBe(false)
  })

  it('进入移动形态关闭抽屉；离开保留状态', () => {
    const d = freshDraft()
    layoutActions.setMobile(d, true)
    layoutActions.toggleSidebar(d) // drawer opens
    expect(d.drawerOpen).toBe(true)
    layoutActions.setMobile(d, false)
    expect(d.drawerOpen).toBe(true) // kept on exit (unused in the wide form)
    layoutActions.setMobile(d, true)
    expect(d.drawerOpen).toBe(false) // closed on re-entry
  })
})

describe('rightbar 展示上报（0.1.7 契约）', () => {
  it('openRightbar：首次打开写到默认宽并记录 track/fullscreen', () => {
    const d = freshDraft()
    layoutActions.openRightbar(d, true, false)
    expect(d.details).toBe(DETAILS_DEFAULT)
    expect(d.rightbarShown).toBe(true)
    expect(d.rightbarTrack).toBe(true)
    expect(d.rightbarFullscreen).toBe(false)
    expect(d.rightbarInstant).toBe(false)
  })

  it('openRightbar：已打开时不重写宽度偏好', () => {
    const d = freshDraft()
    layoutActions.openRightbar(d, true, false)
    layoutActions.setDetails(d, 400)
    layoutActions.openRightbar(d, true, false)
    expect(d.details).toBe(400)
  })

  it('closeRightbar：只收起展示，宽度偏好跨关闭保留', () => {
    const d = freshDraft()
    layoutActions.openRightbar(d, true, false)
    layoutActions.setDetails(d, 400)
    layoutActions.closeRightbar(d)
    expect(d.rightbarShown).toBe(false)
    expect(d.rightbarTrack).toBe(false)
    expect(d.rightbarFullscreen).toBe(false)
    expect(d.details).toBe(400)
  })

  it('退出全屏置 rightbarInstant；重复关闭为 no-op', () => {
    const d = freshDraft()
    layoutActions.openRightbar(d, true, true)
    layoutActions.openRightbar(d, true, false)
    expect(d.rightbarInstant).toBe(true)
    layoutActions.setSidebar(d, 300)
    layoutActions.closeRightbar(d)
    layoutActions.closeRightbar(d)
    expect(d.rightbarShown).toBe(false)
  })

  it('窄屏首次展开右栏清掉侧栏手动展开覆盖', () => {
    const d = freshDraft()
    layoutActions.setNarrow(d, true)
    layoutActions.toggleSidebar(d)
    expect(d.narrowExpanded).toBe(true)
    layoutActions.openRightbar(d, true, false)
    expect(d.narrowExpanded).toBe(false)
  })
})

describe('中央面板选择', () => {
  it('selectPanel：写入选择，null 回到会话', () => {
    const d = freshDraft()
    layoutActions.selectPanel(d, 'plugin-manager')
    expect(d.panelInfo.activePanelId).toBe('plugin-manager')
    layoutActions.selectPanel(d, null)
    expect(d.panelInfo.activePanelId).toBeNull()
  })

  it('retainMainPanels：选择项离开在册名单时回落会话，在册则不动', () => {
    const d = freshDraft()
    layoutActions.selectPanel(d, 'plugin-manager')
    layoutActions.retainMainPanels(d, ['conversation', 'plugin-manager'])
    expect(d.panelInfo.activePanelId).toBe('plugin-manager')
    layoutActions.retainMainPanels(d, ['conversation'])
    expect(d.panelInfo.activePanelId).toBeNull()
    // 未选择（会话）时名单变化不改写。
    layoutActions.retainMainPanels(d, [])
    expect(d.panelInfo.activePanelId).toBeNull()
  })
})
