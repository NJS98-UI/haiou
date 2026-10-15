/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed), the right panel's reported presentation, and the central
 * panel selection. Module level exports the factory only — a module-level
 * handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads). register() receives
 * the factory (exclusive use: the framework instantiates per entry), AppFrame
 * derives its PropsStore share from the return type, and the service face
 * receives the bound actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'
import type { MainPanelId } from './service.ts'

/**
 * Layout store state: panel width preferences in px (0 = closed), plus the
 * narrow-viewport pair — `narrow` mirrors AppFrame's breakpoint reading
 * (viewport < SIDEBAR_AUTO_COLLAPSE) so toggleSidebar can pick semantics, and
 * `narrowExpanded` is the manual override that re-expands the auto-collapsed
 * sidebar over the squeezed center without rewriting the width preference.
 *
 * The 0.1.7 right-column facts (`rightbar*`) are reported BY the occupant
 * through ctx.layout and only read here: the frame sizes the track and places
 * the resize handle from them. `panelInfo` is nested so the shared root source
 * keeps a stable identity until the selection actually changes.
 */
type LayoutState = {
  /** Mutable twin of {@link PanelInfo}: the published face is read-only. */
  panelInfo: { activePanelId: MainPanelId | null }
  sidebar: number
  details: number
  /** Whether the right panel is drawn at all (reported by its occupant). */
  rightbarShown: boolean
  /** Whether the normal panel width reserves a grid track (reported). */
  rightbarTrack: boolean
  /** Reported fullscreen presentation; hides the outer resize handle. */
  rightbarFullscreen: boolean
  /** Suppress transitions for a fullscreen exit until another geometry action. */
  rightbarInstant: boolean
  narrow: boolean
  narrowExpanded: boolean
  /** Mobile form active (viewport < MOBILE_BREAKPOINT, fed by AppFrame). */
  mobile: boolean
  /** Mobile drawer open state (flipped by toggleSidebar in mobile mode). */
  drawerOpen: boolean
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  setMobile: (draft: LayoutState, mobile: boolean) => void
  openRightbar: (draft: LayoutState, track: boolean, fullscreen: boolean) => void
  closeRightbar: (draft: LayoutState) => void
  selectPanel: (draft: LayoutState, panelId: MainPanelId | null) => void
  retainMainPanels: (draft: LayoutState, panelIds: readonly string[]) => void
}

/**
 * The complete write set (package-internal export: pure draft mutators, so
 * columns/stores specs drive them without the runtime's module-loader; the
 * register-time actions table below references this literal). Drag writes
 * clamp into the panel's contract range and never cross the open/closed
 * line; open/close transitions write 0 / the default explicitly. Below the
 * auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar toggle
 * flips the narrowExpanded override instead of the preference.
 */
export const layoutActions: LayoutActions = {
  setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
  setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
  // Mobile toggles flip the drawer, narrow toggles flip only the override,
  // wide toggles flip the width preference (the preference survives narrow
  // overrides untouched, so re-widening restores the pre-squeeze layout).
  toggleSidebar: (d) => {
    if (d.mobile) d.drawerOpen = !d.drawerOpen
    else if (d.narrow) d.narrowExpanded = !d.narrowExpanded
    else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
  },
  // Crossing the breakpoint in either direction drops the override: the
  // narrow default is auto-collapsed, the wide state is the preference.
  setNarrow: (d, narrow: boolean) => {
    if (d.narrow === narrow) return
    d.narrow = narrow
    d.narrowExpanded = false
  },
  // Crossing into mobile closes the drawer; leaving mobile keeps the
  // state (unused in the wide form).
  setMobile: (d, mobile: boolean) => {
    if (d.mobile === mobile) return
    d.mobile = mobile
    if (mobile) d.drawerOpen = false
  },
  /* 0.1.7 layout contract: the right panel reports its presentation through
     ctx.layout.openRightbar/closeRightbar; `details` stays the width
     preference (responsive concessions never rewrite it). */
  openRightbar: (d, track: boolean, fullscreen: boolean) => {
    if (!d.rightbarShown || d.rightbarTrack !== track || d.rightbarFullscreen !== fullscreen) {
      d.rightbarInstant = !!(d.rightbarFullscreen && !fullscreen)
    }
    // Opening the right panel clears the narrow sidebar re-expand override.
    if (!d.rightbarShown && d.narrow) d.narrowExpanded = false
    if (d.details === 0) d.details = DETAILS_DEFAULT
    d.rightbarShown = true
    d.rightbarTrack = !!track
    d.rightbarFullscreen = !!fullscreen
  },
  closeRightbar: (d) => {
    if (!d.rightbarShown) return
    d.rightbarInstant = !!d.rightbarFullscreen
    d.rightbarShown = false
    d.rightbarTrack = false
    d.rightbarFullscreen = false
  },
  /* Central-panel selection: null returns to the Conversation entry. */
  selectPanel: (d, panelId: MainPanelId | null) => { d.panelInfo.activePanelId = panelId },
  // A selected panel that has left the live main roster falls back to the
  // Conversation, so a deregistered occupant can never leave a blank center.
  retainMainPanels: (d, panelIds: readonly string[]) => {
    if (d.panelInfo.activePanelId !== null && !panelIds.includes(d.panelInfo.activePanelId)) {
      d.panelInfo.activePanelId = null
    }
  },
}

/**
 * Create the layout panel store handle. The preference IS the width, so
 * closing a panel forgets its drag width — reopening restores the contract
 * default. Actions are the complete write set: drag writes clamp
 * into the panel's contract range and never cross the open/closed line;
 * open/close transitions write 0 / the default explicitly. Below the
 * auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar toggle
 * flips the narrowExpanded override instead of the preference.
 * `panelInfo` is nested so the shared root source keeps a stable identity
 * until the selection actually changes (useSyncExternalStore contract).
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions> {
  const handle = defineStore({
    init: (): LayoutState => ({
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
    }),
    actions: layoutActions,
  })
  return handle
}
