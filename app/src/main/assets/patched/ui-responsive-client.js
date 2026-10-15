window.__ModuleLoader__.load({
	id: "@dsh-android/dsh-client-ui-responsive",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
		* LG breakpoint); a manual toggle below it re-expands over the squeezed center
		* (stores.ts narrowExpanded). */
		const SIDEBAR_AUTO_COLLAPSE = 1024;
		/**
		* Clamp a panel width into its contract range.
		* @param px - requested width.
		* @param min - range lower bound.
		* @param max - range upper bound.
		* @returns the clamped width.
		*/
		function clampWidth(px, min, max) {
			return Math.min(max, Math.max(min, Math.round(px)));
		}
		/**
		* Solve the three column widths for one viewport frame. Pure: no hysteresis —
		* the output is a function of (viewport, preferences) only, so recovery on
		* re-widening is automatic. Preferences re-clamp here because they cross the
		* store boundary and callers may still supply stale ranges.
		* @param viewport - available frame width in px.
		* @param sidebar - sidebar width preference in px (0 = closed).
		* @param details - details width preference in px (0 = closed).
		* @returns resolved widths; details 0 means visually closed (never unmounted), while a closed sidebar keeps its compact rail.
		*/
		function computeColumns(viewport, sidebar, details) {
			const s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);
			const d0 = details === 0 ? 0 : clampWidth(details, 300, 520);
			if (s + d0 + 640 <= viewport) return {
				sidebar: s,
				center: viewport - s - d0,
				details: d0
			};
			const d1 = d0 === 0 ? 0 : Math.max(300, viewport - s - 640);
			if (s + d1 + 640 <= viewport) return {
				sidebar: s,
				center: 640,
				details: d1
			};
			return {
				sidebar: s,
				center: Math.max(0, viewport - s),
				details: 0
			};
		}
		//#endregion
		//#region \0dsh-css:D:\work\haiou\dsh-client-ui-responsive\src\client\AppFrame.module.css.mjs
		const css$1 = ".Y28BjG_frame{background:var(--dsw-alias-bg-base);height:100%;transition:grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out);grid-template-rows:100%;display:grid;position:relative;overflow:hidden}.Y28BjG_frame[data-dragging]{transition:none}@media (prefers-reduced-motion:reduce){.Y28BjG_frame{transition:none}}.Y28BjG_sidebarCol{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);min-width:0;overflow:hidden}.Y28BjG_centerCol{flex-direction:column;min-width:0;display:flex;overflow:hidden}.Y28BjG_detailsCol{border-left:1px solid var(--dsw-alias-border-l2);min-width:0;overflow:hidden}.Y28BjG_frame[data-details-collapsed] .Y28BjG_detailsCol{border-left:none}.Y28BjG_handle{cursor:col-resize;z-index:2;touch-action:none;width:8px;transition:left var(--ds-transition-duration-slow) var(--ds-ease-in-out);margin-left:-4px;position:absolute;top:0;bottom:0}.Y28BjG_frame[data-dragging] .Y28BjG_handle{transition:none}@media (prefers-reduced-motion:reduce){.Y28BjG_handle{transition:none}}.Y28BjG_handle[data-side=details]:after{content:\"\";box-sizing:border-box;background:var(--dsw-alias-button-floating-fill);border:1px solid var(--dsw-alias-border-l2-darkmode-thin);opacity:0;width:12px;height:32px;transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out), background var(--ds-transition-duration-slow) var(--ds-ease-in-out);border-radius:10px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}.Y28BjG_detailsCol:hover~.Y28BjG_handle[data-side=details]:after,.Y28BjG_handle[data-side=details]:hover:after,.Y28BjG_handle[data-side=details][data-dragging=true]:after{opacity:1}.Y28BjG_handle[data-side=details]:hover:after,.Y28BjG_handle[data-side=details][data-dragging=true]:after{background:var(--dsw-alias-button-floating-hover);border-color:var(--dsw-alias-border-l3)}.Y28BjG_overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}.Y28BjG_overlayLayer>*{pointer-events:auto}.Y28BjG_mobileFrame{background:var(--dsw-alias-bg-base);flex-direction:column;height:100%;display:flex;position:relative;overflow:clip}.Y28BjG_mobileTopBar{padding:calc(env(safe-area-inset-top) + 8px) 12px 8px;background:var(--dsw-specific-sidebar-fill);border-bottom:1px solid var(--dsw-alias-border-l1);z-index:3;align-items:center;gap:8px;display:flex}.Y28BjG_mobileHamburger{width:44px;height:44px;color:var(--dsw-alias-text-l1);cursor:pointer;touch-action:manipulation;background:0 0;border:none;border-radius:10px;flex:none;font-size:20px}.Y28BjG_mobileHamburger:active{background:var(--dsw-alias-button-floating-fill)}.Y28BjG_mobileTitle{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-text-l1);flex:1;font-size:16px;font-weight:600;overflow:hidden}.Y28BjG_mobileBody{flex-direction:column;flex:1;min-height:0;display:flex}.Y28BjG_mobileBody .Y28BjG_centerCol{flex:1}.Y28BjG_mobileSheet{background:var(--dsw-alias-bg-base);border-top:1px solid var(--dsw-alias-border-l2);z-index:8;max-height:70%;padding-bottom:env(safe-area-inset-bottom);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out);border-radius:16px 16px 0 0;flex-direction:column;display:flex;position:absolute;bottom:0;left:0;right:0;transform:translateY(100%)}.Y28BjG_mobileSheet[data-open]{transform:translateY(0)}.Y28BjG_mobileSheetGrab{background:var(--dsw-alias-border-l2);cursor:pointer;touch-action:manipulation;border-radius:4px;flex:none;width:44px;height:8px;margin:8px auto 4px}.Y28BjG_mobileSheet>:last-child{min-height:0;overflow:auto}.Y28BjG_mobileMask{background:var(--dsw-alias-overlay-mask);opacity:0;pointer-events:none;z-index:9;transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out);position:absolute;inset:0}.Y28BjG_mobileMask[data-open]{opacity:1;pointer-events:auto}.Y28BjG_mobileDrawer{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);z-index:10;width:min(300px,85vw);padding-top:env(safe-area-inset-top);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out);flex-direction:column;display:flex;position:absolute;top:0;bottom:0;left:0;transform:translate(-100%)}.Y28BjG_mobileDrawer[data-open]{transform:translate(0)}.Y28BjG_mobileDrawer>*{min-height:0;overflow:auto}@media (prefers-reduced-motion:reduce){.Y28BjG_mobileSheet,.Y28BjG_mobileMask,.Y28BjG_mobileDrawer{transition:none}}";
		const tagId$1 = "@dsh-android/dsh-client-ui-responsive/AppFrame.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@dsh-android/dsh-client-ui-responsive";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var AppFrame_module_css_default = {
			"centerCol": "Y28BjG_centerCol",
			"mobileHamburger": "Y28BjG_mobileHamburger",
			"mobileFrame": "Y28BjG_mobileFrame",
			"mobileBody": "Y28BjG_mobileBody",
			"mobileTopBar": "Y28BjG_mobileTopBar",
			"overlayLayer": "Y28BjG_overlayLayer",
			"detailsCol": "Y28BjG_detailsCol",
			"handle": "Y28BjG_handle",
			"frame": "Y28BjG_frame",
			"mobileSheetGrab": "Y28BjG_mobileSheetGrab",
			"mobileSheet": "Y28BjG_mobileSheet",
			"mobileDrawer": "Y28BjG_mobileDrawer",
			"mobileTitle": "Y28BjG_mobileTitle",
			"mobileMask": "Y28BjG_mobileMask",
			"sidebarCol": "Y28BjG_sidebarCol"
		};
		//#endregion
		//#region src/client/AppFrame.tsx
		/**
		* Three-column shell frame, registered into the built-in 'root' slot (the web
		* shell renders only 'root'). Owns the grid tracks (sidebar | center |
		* details), the drag handles (pointer capture + rAF throttle), the concession
		* chain (columns.ts), and the child-slot render decisions: the sidebar slot
		* renders HERE with live parameters from the concession solve, and the
		* session-aware occupants render in fixed column positions; strict entries
		* gate themselves on current-session availability while session-maybe
		* entries retain identity. Pure component: everything arrives
		* through the three framework shares — zero cordis or framework imports,
		* zero self-made hooks.
		*/
		/** Center column grid item (session-body building block). */
		function CenterColumn(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: AppFrame_module_css_default.centerCol,
				children: props.children
			});
		}
		/**
		* The keyed `main` occupant sits one level below the column frame so the
		* panel selection subscription (which changes on every panel switch) never
		* re-renders the grid, the resize handles or the other columns.
		*/
		function MainPanel(props) {
			const { usePanelInfo, renderSlot } = props;
			return renderSlot("main", {}, { entryKey: usePanelInfo((info) => info.activePanelId) ?? "conversation" });
		}
		/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
		function DetailsColumn(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: AppFrame_module_css_default.detailsCol,
				children: props.children
			});
		}
		/**
		* One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
		* `side` keys the hover-reveal CSS to the owning column.
		*/
		function DragHandle(props) {
			const [dragging, setDragging] = (0, react.useState)(false);
			const origin = (0, react.useRef)(0);
			const latest = (0, react.useRef)(0);
			const frame = (0, react.useRef)(null);
			const callbacks = (0, react.useRef)({
				onStart: props.onStart,
				onDrag: props.onDrag,
				onEnd: props.onEnd
			});
			callbacks.current = {
				onStart: props.onStart,
				onDrag: props.onDrag,
				onEnd: props.onEnd
			};
			const onPointerDown = (0, react.useCallback)((e) => {
				e.preventDefault();
				e.currentTarget.setPointerCapture(e.pointerId);
				origin.current = e.clientX;
				latest.current = e.clientX;
				callbacks.current.onStart();
				setDragging(true);
			}, []);
			const onPointerMove = (0, react.useCallback)((e) => {
				if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
				latest.current = e.clientX;
				frame.current ??= requestAnimationFrame(() => {
					frame.current = null;
					callbacks.current.onDrag(latest.current - origin.current);
				});
			}, []);
			const onPointerUp = (0, react.useCallback)((e) => {
				if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
				e.currentTarget.releasePointerCapture(e.pointerId);
				if (frame.current !== null) {
					cancelAnimationFrame(frame.current);
					frame.current = null;
				}
				callbacks.current.onDrag(latest.current - origin.current);
				setDragging(false);
				callbacks.current.onEnd();
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: AppFrame_module_css_default.handle,
				style: { left: props.left },
				"data-side": props.side,
				"data-dragging": dragging || void 0,
				onPointerDown,
				onPointerMove,
				onPointerUp
			});
		}
		/** The three-column frame (see module doc). */
		function AppFrame({ useStore, usePanelInfo, actions, renderSlot }) {
			const panels = useStore((s) => s);
			const frameRef = (0, react.useRef)(null);
			const [viewport, setViewport] = (0, react.useState)(() => window.innerWidth);
			(0, react.useEffect)(() => {
				const el = frameRef.current;
				/* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
				if (el === null) return;
				let raf = null;
				const observer = new ResizeObserver(() => {
					raf ??= requestAnimationFrame(() => {
						raf = null;
						const width = el.getBoundingClientRect().width;
						if (width > 0) setViewport(width);
					});
				});
				observer.observe(el);
				return () => {
					observer.disconnect();
					if (raf !== null) cancelAnimationFrame(raf);
				};
			}, []);
			const narrow = viewport < SIDEBAR_AUTO_COLLAPSE;
			(0, react.useEffect)(() => {
				actions.setNarrow(narrow);
			}, [actions, narrow]);
			const mobile = viewport < 640;
			(0, react.useEffect)(() => {
				actions.setMobile(mobile);
			}, [actions, mobile]);
			const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0;
			const cols = computeColumns(viewport, sidebarCollapsed ? 0 : panels.sidebar === 0 ? 280 : panels.sidebar, panels.rightbarShown ? panels.details : 0);
			const colsRef = (0, react.useRef)(cols);
			colsRef.current = cols;
			const sidebarBase = (0, react.useRef)(0);
			const detailsBase = (0, react.useRef)(0);
			const [dragging, setDragging] = (0, react.useState)(false);
			const onDragEnd = (0, react.useCallback)(() => {
				setDragging(false);
			}, []);
			const onSidebarStart = (0, react.useCallback)(() => {
				sidebarBase.current = colsRef.current.sidebar;
				setDragging(true);
			}, []);
			const onDetailsStart = (0, react.useCallback)(() => {
				detailsBase.current = colsRef.current.details;
				setDragging(true);
			}, []);
			const onSidebarDrag = (0, react.useCallback)((dx) => {
				actions.setSidebar(sidebarBase.current + dx);
			}, [actions]);
			const onDetailsDrag = (0, react.useCallback)((dx) => {
				actions.setDetails(detailsBase.current - dx);
			}, [actions]);
			if (mobile) {
				const sheetOpen = panels.rightbarShown;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: frameRef,
					className: AppFrame_module_css_default.mobileFrame,
					"data-mobile": true,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: AppFrame_module_css_default.mobileTopBar,
							"data-mobile-topbar": true,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: AppFrame_module_css_default.mobileHamburger,
								"aria-label": "打开导航",
								onClick: () => actions.toggleSidebar(),
								children: "☰"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: AppFrame_module_css_default.mobileTitle,
								children: "DeepSeek Harness"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: AppFrame_module_css_default.mobileBody,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CenterColumn, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MainPanel, {
								usePanelInfo,
								renderSlot
							}) })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: AppFrame_module_css_default.mobileSheet,
							"data-open": sheetOpen || void 0,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: AppFrame_module_css_default.mobileSheetGrab,
								onClick: () => actions.closeRightbar()
							}), renderSlot("rightbar", {
								width: Math.round(viewport),
								viewportWidth: viewport,
								canShow: true
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: AppFrame_module_css_default.mobileMask,
							"data-open": panels.drawerOpen || void 0,
							onClick: () => actions.toggleSidebar()
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: AppFrame_module_css_default.mobileDrawer,
							"data-open": panels.drawerOpen || void 0,
							children: renderSlot("sidebar", {
								collapsed: false,
								width: 300
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: AppFrame_module_css_default.overlayLayer,
							"data-shell-overlay": true,
							children: renderSlot("shell.overlay", {})
						})
					]
				});
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: frameRef,
				className: AppFrame_module_css_default.frame,
				style: { gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px` },
				"data-sidebar-collapsed": sidebarCollapsed || void 0,
				"data-details-collapsed": cols.details === 0 || void 0,
				"data-dragging": dragging || void 0,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: AppFrame_module_css_default.sidebarCol,
						children: renderSlot("sidebar", {
							collapsed: sidebarCollapsed,
							width: cols.sidebar
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CenterColumn, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MainPanel, {
						usePanelInfo,
						renderSlot
					}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailsColumn, { children: renderSlot("rightbar", {
						width: cols.details,
						viewportWidth: viewport,
						canShow: cols.details > 0
					}) })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: AppFrame_module_css_default.overlayLayer,
						"data-shell-overlay": true,
						children: renderSlot("shell.overlay", {})
					}),
					!sidebarCollapsed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DragHandle, {
						side: "sidebar",
						left: cols.sidebar,
						onStart: onSidebarStart,
						onDrag: onSidebarDrag,
						onEnd: onDragEnd
					}),
					cols.details > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DragHandle, {
						side: "details",
						left: viewport - cols.details,
						onStart: onDetailsStart,
						onDrag: onDetailsDrag,
						onEnd: onDragEnd
					})
				]
			});
		}
		//#endregion
		//#region src/client/stores.ts
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
		/**
		* The complete write set (package-internal export: pure draft mutators, so
		* columns/stores specs drive them without the runtime's module-loader; the
		* register-time actions table below references this literal). Drag writes
		* clamp into the panel's contract range and never cross the open/closed
		* line; open/close transitions write 0 / the default explicitly. Below the
		* auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar toggle
		* flips the narrowExpanded override instead of the preference.
		*/
		const layoutActions = {
			setSidebar: (d, px) => {
				d.sidebar = clampWidth(px, 264, 420);
			},
			setDetails: (d, px) => {
				d.details = clampWidth(px, 300, 520);
			},
			toggleSidebar: (d) => {
				if (d.mobile) d.drawerOpen = !d.drawerOpen;
				else if (d.narrow) d.narrowExpanded = !d.narrowExpanded;
				else d.sidebar = d.sidebar === 0 ? 280 : 0;
			},
			setNarrow: (d, narrow) => {
				if (d.narrow === narrow) return;
				d.narrow = narrow;
				d.narrowExpanded = false;
			},
			setMobile: (d, mobile) => {
				if (d.mobile === mobile) return;
				d.mobile = mobile;
				if (mobile) d.drawerOpen = false;
			},
			openRightbar: (d, track, fullscreen) => {
				if (!d.rightbarShown || d.rightbarTrack !== track || d.rightbarFullscreen !== fullscreen) d.rightbarInstant = !!(d.rightbarFullscreen && !fullscreen);
				if (!d.rightbarShown && d.narrow) d.narrowExpanded = false;
				if (d.details === 0) d.details = 360;
				d.rightbarShown = true;
				d.rightbarTrack = !!track;
				d.rightbarFullscreen = !!fullscreen;
			},
			closeRightbar: (d) => {
				if (!d.rightbarShown) return;
				d.rightbarInstant = !!d.rightbarFullscreen;
				d.rightbarShown = false;
				d.rightbarTrack = false;
				d.rightbarFullscreen = false;
			},
			selectPanel: (d, panelId) => {
				d.panelInfo.activePanelId = panelId;
			},
			retainMainPanels: (d, panelIds) => {
				if (d.panelInfo.activePanelId !== null && !panelIds.includes(d.panelInfo.activePanelId)) d.panelInfo.activePanelId = null;
			}
		};
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
		function createLayoutStore() {
			return (0, _deepseek_ai_dsh_client_store.defineStore)({
				init: () => ({
					panelInfo: { activePanelId: null },
					sidebar: 280,
					details: 0,
					rightbarShown: false,
					rightbarTrack: false,
					rightbarFullscreen: false,
					rightbarInstant: false,
					narrow: false,
					narrowExpanded: false,
					mobile: false,
					drawerOpen: false
				}),
				actions: layoutActions
			});
		}
		//#endregion
		//#region src/client/service.ts
		/** Cross-plugin panel-action face (ctx.layout). */
		var LayoutController = class {
			panels;
			hasMainPanel;
			panelInfo;
			constructor(panels, hasMainPanel, panelInfo) {
				this.panels = panels;
				this.hasMainPanel = hasMainPanel;
				this.panelInfo = panelInfo;
			}
			navigation = new AbortController();
			/** Select a global panel or return to the Conversation. */
			selectPanel(panelId) {
				if (panelId !== null && !this.hasMainPanel(panelId)) throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`);
				this.navigation.abort();
				this.panels.selectPanel(panelId);
			}
			/** @returns the new pending navigation's cancellation signal. */
			beginNavigation() {
				this.navigation.abort();
				this.navigation = new AbortController();
				return this.navigation.signal;
			}
			/** Invalidate pending navigations when the layout owner is unloaded. */
			dispose() {
				this.navigation.abort();
			}
			/** Toggle the sidebar panel (closed ⟷ contract default width; mobile drawer). */
			toggleSidebar() {
				this.panels.toggleSidebar();
			}
			/** Report the right panel's track and fullscreen presentation. */
			openRightbar(track, fullscreen) {
				this.panels.openRightbar(track, fullscreen);
			}
			/** Report the right panel as hidden: no track, no handle. */
			closeRightbar() {
				this.panels.closeRightbar();
			}
		};
		//#endregion
		//#region src/client/theme-presenter.ts
		/** Body attribute selecting the dark base palette in the token stylesheets. */
		const DARK_ATTRIBUTE = "data-ds-dark-theme";
		/** Applies theme snapshots to the document; one instance per plugin fiber. */
		var ThemePresenter = class ThemePresenter {
			static nextId = 0;
			/** Last-writer marker (L3): global writes (colorScheme/dark attribute) are retracted only by the
			*  last apply'ing instance — under HMR dual fibers / multiple coexisting instances, an earlier
			*  dispose must not clear a later writer's global state. */
			uid = "p" + ThemePresenter.nextId++;
			/** Token variables and the values this presenter wrote (L3: dispose retracts only variables whose
			*  value is still "mine" — when a later writer overrode the same token, the earlier dispose must
			*  not delete the later writer's value). */
			appliedTokens = /* @__PURE__ */ new Map();
			/** The single metadata node this presenter inserts and removes. */
			themeColorMeta;
			/** Create the presenter-owned metadata node before the first snapshot arrives. */
			constructor() {
				this.themeColorMeta = document.createElement("meta");
				this.themeColorMeta.name = "theme-color";
			}
			/**
			* Project a snapshot onto the document: set root `color-scheme` and the body
			* palette attribute from `active.colorScheme` (never the id — `system` is
			* resolved upstream), then replace the previously applied token variables
			* with `active.tokens`. Browser theme-color metadata follows the computed
			* body background after those writes, so the rendered palette remains the
			* color authority.
			* @param snapshot - resolved theme snapshot from ctx.theme.
			*/
			apply(snapshot) {
				const scheme = snapshot.active.colorScheme;
				document.documentElement.style.colorScheme = scheme;
				const body = document.body;
				if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, "");
				else body.removeAttribute(DARK_ATTRIBUTE);
				document.documentElement.dataset.dshPresenter = this.uid;
				for (const [name, value] of this.appliedTokens) if (body.style.getPropertyValue(name) === value) body.style.removeProperty(name);
				this.appliedTokens.clear();
				for (const [name, value] of Object.entries(snapshot.active.tokens)) {
					body.style.setProperty(name, value);
					this.appliedTokens.set(name, value);
				}
				this.themeColorMeta.content = getComputedStyle(body).backgroundColor;
				if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
			}
			/** Retract what this presenter wrote: global fields only when still owned
			*  (last writer), token variables and the owned metadata node always. */
			dispose() {
				if (document.documentElement.dataset.dshPresenter === this.uid) {
					document.documentElement.style.removeProperty("color-scheme");
					document.body.removeAttribute(DARK_ATTRIBUTE);
					delete document.documentElement.dataset.dshPresenter;
				}
				const body = document.body;
				for (const [name, value] of this.appliedTokens) if (body.style.getPropertyValue(name) === value) body.style.removeProperty(name);
				this.appliedTokens.clear();
				this.themeColorMeta.remove();
			}
		};
		//#endregion
		//#region src/client/theme-bridge.ts
		/**
		* ThemeBridge: make prefers-color-scheme follow the OS dark state on
		* WebViews whose media query does not track the system uiMode (observed on
		* vivo/Android 16: FORCE_DARK_AUTO leaves matchMedia stuck at light).
		*
		* The shell APK watches Configuration changes and pushes the dark flag via
		* window.__dshThemeBridge.setDark(dark). This module hooks matchMedia for the
		* (prefers-color-scheme: dark) query so the upstream ui-theme service
		* (default preference: system) resolves and live-updates through its own
		* listener — zero upstream changes.
		*/
		var ThemeBridge = class {
			dark = false;
			listeners = /* @__PURE__ */ new Set();
			patched = false;
			/** Install the matchMedia hook and the bridge object (idempotent). */
			install() {
				if (this.patched) return;
				this.patched = true;
				const android = window.androidBridge;
				if (window.__dshThemeBridge) return;
				if (!android || typeof android.getSystemDark !== "function") return;
				const self = this;
				const nativeMatchMedia = window.matchMedia.bind(window);
				window.matchMedia = ((query) => {
					if (!query.includes("prefers-color-scheme")) return nativeMatchMedia(query);
					const onChange = () => {
						for (const listener of self.listeners) try {
							listener();
						} catch {}
					};
					return {
						get matches() {
							return self.dark;
						},
						get media() {
							return query;
						},
						get onchange() {
							return null;
						},
						set onchange(_v) {},
						addEventListener: (type, cb) => {
							if (type !== "change" || typeof cb !== "function") return;
							self.listeners.add(cb);
							onChange();
						},
						removeEventListener: (type, cb) => {
							if (type !== "change" || typeof cb !== "function") return;
							self.listeners.delete(cb);
						},
						addListener: (cb) => {
							self.listeners.add(cb);
						},
						removeListener: (cb) => {
							self.listeners.delete(cb);
						},
						dispatchEvent: () => false
					};
				});
				const globalObj = window;
				globalObj.__dshThemeBridge = { setDark: (d) => {
					if (self.dark === d) return;
					self.dark = d;
					for (const listener of self.listeners) try {
						listener();
					} catch {}
				} };
				try {
					if (android.getSystemDark()) globalObj.__dshThemeBridge.setDark(true);
				} catch {}
			}
		};
		//#endregion
		//#region src/client/enter-guard.ts
		/**
		* EnterGuard: mobile-form Enter-key semantics.
		*
		* On the phone soft keyboard the Enter (newline) key fires a plain keydown
		* Enter — upstream InputBar treats it as submit (keyboard.submit), and there
		* is no Shift to fall back on. This guard, on the mobile form only
		* (viewport < MOBILE_BREAKPOINT), intercepts a plain Enter inside the
		* composer textarea at document capture phase — before React's root listener
		* — and converts it into a newline insertion, leaving the send button as the
		* only send channel.
		*
		* Guards that must stay untouched:
		* - IME composition (isComposing / keyCode 229): the candidate-confirm Enter.
		* - Open command menu ([role=listbox]): Enter picks the highlighted item.
		* - Shift+Enter (external keyboards): upstream native newline.
		* - Desktop/wide viewport: upstream behavior unchanged.
		*/
		var EnterGuard = class {
			onKeyDown = (event) => {
				if (event.key !== "Enter" || event.shiftKey) return;
				if (event.isComposing || event.keyCode === 229) return;
				const target = event.target;
				if (!(target instanceof HTMLElement)) return;
				if (target.closest("[data-composer-card] textarea") === null) return;
				if (document.querySelector("[role=\"listbox\"]") !== null) return;
				if (window.innerWidth >= 640) return;
				event.stopPropagation();
				event.preventDefault();
				const active = document.activeElement;
				if (active instanceof HTMLTextAreaElement && active === target) try {
					document.execCommand("insertText", false, "\n");
				} catch {}
			};
			attach() {
				document.addEventListener("keydown", this.onKeyDown, { capture: true });
			}
			detach() {
				document.removeEventListener("keydown", this.onKeyDown, { capture: true });
			}
		};
		//#endregion
		//#region src/client/keyboard-boundary.ts
		/**
		* KeyboardBoundary (issue #57): Android 16 edge-to-edge WebViews do not
		* shrink the layout viewport when the soft keyboard opens (adjustResize
		* does not resize the WebView content; visualViewport shrinks but
		* innerHeight stays 758). The mobile frame (height: 100%) therefore extends
		* under the keyboard, and its scrollable content leaves a blank band below
		* the composer — swiping up past the input reveals empty black.
		*
		* Fix: while the IME inset is non-zero, pin the mobile frame's height to the
		* visualViewport height (the keyboard's top edge). The frame's overflow:
		* hidden then clips the blank band instead of letting it scroll into view.
		* Restored to 100% when the keyboard closes.
		*
		* The composer seat (position: sticky; bottom: 0) normally relies on
		* composer-insets.css.ts padding-bottom = --dsh-android-ime-bottom to lift
		* the input above the keyboard while the frame keeps its full height. Once
		* this class pins the frame to the keyboard top edge, that same padding
		* becomes redundant and inflates the seat past its sticky container (seat
		* height > scrollBody height makes the sticky bottom anchor inert and the
		* composer drifts to the top of the viewport). While pinned, the seat's
		* padding-bottom is therefore zeroed; it is restored on keyboard close.
		*/
		var KeyboardBoundary = class {
			frame = null;
			seat = null;
			media = null;
			lastIme = 0;
			lastVv = 0;
			/** Watch visualViewport resize + the shell's IME inset variable. */
			attach() {
				window.visualViewport?.addEventListener("resize", this.onViewportChange);
				this.media = typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 640px)") : null;
				this.media?.addEventListener?.("change", this.onViewportChange);
				this.onViewportChange();
			}
			/** Remove listeners and restore the frame and seat styles. */
			detach() {
				window.visualViewport?.removeEventListener("resize", this.onViewportChange);
				this.media?.removeEventListener?.("change", this.onViewportChange);
				this.restore();
			}
			onViewportChange = () => {
				const frame = document.querySelector("[data-mobile]");
				if (frame === null) return;
				this.frame = frame;
				const rootStyle = getComputedStyle(document.documentElement);
				const ime = Number.parseFloat(rootStyle.getPropertyValue("--dsh-android-ime-bottom")) || 0;
				const vv = window.visualViewport;
				const vvHeight = vv === null ? 0 : Math.round(vv.height);
				if (ime > 0 && vvHeight > 0 && (ime !== this.lastIme || vvHeight !== this.lastVv)) {
					this.lastIme = ime;
					this.lastVv = vvHeight;
					frame.style.height = `${vvHeight}px`;
					const seat = document.querySelector("[data-composer-seat]");
					if (seat !== null) {
						this.seat = seat;
						seat.style.paddingBottom = "0px";
					}
				} else if (ime === 0 && (this.lastIme !== 0 || frame.style.height !== "")) this.restore();
			};
			/** Restore the natural frame height and seat padding. */
			restore() {
				if (this.frame !== null) this.frame.style.height = "";
				this.frame = null;
				if (this.seat !== null) this.seat.style.paddingBottom = "";
				this.seat = null;
				this.lastIme = 0;
				this.lastVv = 0;
			}
		};
		//#endregion
		//#region \0dsh-css:D:\work\haiou\dsh-client-ui-responsive\src\client\ExportResultDialog.module.css.mjs
		const css = ".KSw5aa_backdrop{z-index:1;background:var(--dsw-alias-bg-mask-1,#0000003d);justify-content:center;align-items:center;padding:16px;display:flex;position:absolute;inset:0}.KSw5aa_dialog{box-sizing:border-box;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l2,#0000001a);width:min(440px,100%);max-height:70%;color:var(--dsw-alias-label-primary,#0f1115);border-radius:12px;flex-direction:column;gap:12px;padding:16px;display:flex;overflow:auto}.KSw5aa_title{margin:0;font-size:16px;font-weight:600}.KSw5aa_detail{overflow-wrap:anywhere;white-space:pre-wrap;margin:0;font-size:13px;line-height:1.5}.KSw5aa_detail[data-status=success]{color:var(--dsw-alias-state-success-primary)}.KSw5aa_detail[data-status=error]{color:var(--dsw-alias-state-error-primary)}.KSw5aa_actions{justify-content:flex-end;display:flex}.KSw5aa_button{border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground,#fff);cursor:pointer;border-radius:8px;padding:8px 14px;font-size:13px}.KSw5aa_button:hover{background:var(--dsw-alias-button-primary-hover)}";
		const tagId = "@dsh-android/dsh-client-ui-responsive/ExportResultDialog.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@dsh-android/dsh-client-ui-responsive";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ExportResultDialog_module_css_default = {
			"detail": "KSw5aa_detail",
			"backdrop": "KSw5aa_backdrop",
			"title": "KSw5aa_title",
			"actions": "KSw5aa_actions",
			"dialog": "KSw5aa_dialog",
			"button": "KSw5aa_button"
		};
		//#endregion
		//#region src/client/ExportResultDialog.tsx
		/**
		* Export-result dialog: the `shell.overlay` entry that renders the Android
		* shell's session-export outcome. Pure component: state arrives through the
		* store share, dismissal through the bound action. The markup reuses the
		* web-ui dialog conventions (role=dialog / aria-modal) and the shared design
		* tokens, so the dialog matches the app's modal surfaces.
		*/
		/** The single entry component; renders nothing while no result is open. */
		function ExportResultDialog({ useStore, actions }) {
			const state = useStore((s) => s);
			(0, react.useEffect)(() => {
				if (!state.open) return;
				const onKeyDown = (event) => {
					if (event.key === "Escape") actions.close();
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
				};
			}, [state.open, actions]);
			if (!state.open) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ExportResultDialog_module_css_default.backdrop,
				onClick: () => actions.close(),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					role: "dialog",
					"aria-modal": "true",
					"aria-labelledby": "dsh-export-result-title",
					className: ExportResultDialog_module_css_default.dialog,
					onClick: (event) => {
						event.stopPropagation();
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							id: "dsh-export-result-title",
							className: ExportResultDialog_module_css_default.title,
							children: state.title
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: ExportResultDialog_module_css_default.detail,
							"data-status": state.ok ? "success" : "error",
							children: state.detail
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: ExportResultDialog_module_css_default.actions,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ExportResultDialog_module_css_default.button,
								onClick: () => actions.close(),
								children: "关闭"
							})
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/export-result.ts
		/**
		* Export-result dialog store: the single transient in-app feedback surface
		* for the shell's session-export download. The shell pushes the outcome from
		* Kotlin through `window.__dshExportResult`; this store carries it into the
		* `shell.overlay` entry. Module level exports the factory only — a module-level
		* handle would pin store identity across plugin reloads.
		*/
		/**
		* Create the export-result store handle. `show` replaces whatever dialog was
		* open, so a second export supersedes a still-open first result; `close` only
		* folds the dialog, never mutates the last result.
		* @returns the store handle (spec + type + identity + factory in one).
		*/
		function createExportResultStore() {
			return (0, _deepseek_ai_dsh_client_store.defineStore)({
				init: () => ({
					open: false,
					ok: true,
					title: "",
					detail: ""
				}),
				actions: {
					show: (d, result) => {
						d.open = true;
						d.ok = result.ok;
						d.title = result.title;
						d.detail = result.detail;
					},
					close: (d) => {
						d.open = false;
					}
				}
			});
		}
		//#endregion
		//#region src/client/mobile-settings.css.ts
		/**
		* Mobile settings-panel adaptation (dsh-client-ui-responsive issue #1).
		* The upstream settings modal is a fixed 800px two-column panel (188px nav
		* rail + content). On portrait phones the panel squeezes to the viewport but
		* the rail stays 188px wide, crushing the content to ~160px. Selectors key
		* off the dialog's ARIA attributes because CSS Modules class names are
		* hashed and unreachable from another plugin; scoped to the mobile breakpoint.
		*/
		const MOBILE_SETTINGS_CSS = `
@media (max-width: 639px) {
  [role='dialog'][aria-modal='true']:has(> nav) {
    width: calc(100vw - 24px);
    max-width: calc(100vw - 24px);
    height: min(720px, calc(100vh - 24px));
    flex-direction: column;
  }

  [role='dialog'][aria-modal='true']:has(> nav) > nav {
    width: 100%;
    height: auto;
    flex-direction: row;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    overflow-x: auto;
    flex: none;
  }

  [role='dialog'][aria-modal='true']:has(> nav) > nav > div:first-child {
    flex: none;
    padding: 0;
    white-space: nowrap;
  }

  [role='dialog'][aria-modal='true']:has(> nav) > nav > div:nth-child(2) {
    flex-direction: row;
    gap: 4px;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
  }

  /* Content column: flex:1 but min-height:auto would hold the options
     scroll area's full content height and overflow the panel; allow it to
     shrink so the options area scrolls inside. */
  [role='dialog'][aria-modal='true']:has(> nav) > div:nth-child(2) {
    min-height: 0;
  }

  [role='dialog'][aria-modal='true']:has(> nav) > nav > div:nth-child(2) > button {
    /* Review 2026-08-18: the original rule was an unclosed empty block since #2 (two more opening
       than closing braces) and never applied. Completed by container semantics: the nav button
       container is flex-direction: row + overflow-x: auto, so buttons need flex: none to avoid being
       compressed and to scroll horizontally with the container. */
    flex: none;
  }
}
`;
		//#endregion
		//#region src/client/composer-menu.css.ts
		/**
		* Composer command-menu scroll fix (upstream ui-input-trigger):
		* .viewport (the menu's scroll container) is a flex child without flex:1,
		* so when the candidate list exceeds max-height (320px), the viewport grows
		* past the menu and gets clipped by the menu's overflow:hidden — the
		* scrollbar lands outside the visible area and the list appears unscrollable.
		* Fix: let the viewport fill the menu and scroll inside it.
		*/
		const COMPOSER_MENU_CSS = `
[data-composer-card] [role='listbox'] > div {
  flex: 1 1 0%;
  min-height: 0;
}

/* The upstream menu limits itself against viewport y=0. On the mobile form,
 * the fixed top bar owns the upper part of that viewport, so the geometry
 * guard writes a stricter cap for each open menu. */
[data-mobile] [data-composer-card] [role='listbox'] {
  max-height: var(--dsh-mobile-menu-max-height, 320px) !important;
}
`;
		//#endregion
		//#region src/client/composer-row.css.ts
		/**
		* Composer control-row narrow-screen fixes:
		* - The model-selection pill is 176px fixed; on phones below the 400px
		*   breakpoint it overlaps the permission/access pill (device-observed on
		*   360dp phones). Cap its width and ellipsize so both stay tappable.
		* - The row is flex-wrap: wrap (upstream InputBar). On 360dp the left group
		*   (add + access-mode, 88px) + gap (12px) + trailing group (model pill +
		*   context meter + send, 204px at pill 118px) = 304px > 302px content width
		*   (318px card - 16px padding), so the trailing group wraps to a second
		*   line and the add/access controls misalign vertically with the model
		*   picker (issue #54). Capping the pill at 104px shrinks the trailing group
		*   to 182px (282px total), keeping the whole toolbar on one line; the pill's
		*   own content (label + effort + chevron, ~98px) still fits without
		*   truncation. Verified on-device (vivo V2425A, 360dp): tools y 627→670 and
		*   aligns with the model trigger.
		*/
		const COMPOSER_ROW_CSS = `
@media (max-width: 400px) {
  [data-composer-card] [aria-label*='选择模型'],
  [data-composer-card] [aria-label*='model'] {
    max-width: 104px;
  }
  [data-composer-card] [aria-label*='选择模型'] span,
  [data-composer-card] [aria-label*='model'] span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
`;
		//#endregion
		//#region src/client/composer-insets.css.ts
		/**
		* Composer insets adaptation for mobile/edge-to-edge:
		* On Android edge-to-edge mode, the shell supplies --dsh-android-system-bottom
		* (gesture / nav-bar height) and --dsh-android-ime-bottom (soft keyboard height).
		* Padding the whole composer seat ([data-composer-seat]) pushes the input card,
		* mode pills, anchored command menu, and the StatsLine footer above the navigation
		* bar / gesture pill and the soft keyboard.
		* On desktop / non-Android environments where CSS variables are unset,
		* max(0px, 0px, 0px) evaluates cleanly to 0px (zero side-effects).
		*/
		const COMPOSER_INSETS_CSS = `
[data-composer-seat] {
  padding-bottom: max(
    env(safe-area-inset-bottom, 0px),
    var(--dsh-android-system-bottom, 0px),
    var(--dsh-android-ime-bottom, 0px)
  );
}
`;
		//#endregion
		//#region src/client/trajectory-details.css.ts
		/**
		* Trajectory local details panel (upstream ui-trajectory) on narrow screens
		* (issue apk#67): the upstream ≤760px media query positions the panel
		* absolute within the ledger region — sandwiched between the trajectory
		* timeline bar above and the composer seat below (which also covers its
		* bottom), leaving a cramped reading band. Overlay it full-viewport inside
		* the mobile frame: fixed positioning escapes the ledger, so the panel spans
		* the whole screen (header + tabs fixed, body scrolls) and the input bar
		* never covers it. The upstream col-resize handle is pointless on touch.
		*/
		const TRAJECTORY_DETAILS_CSS = `
@media (max-width: 760px) {
  /* aside-scoped: the upstream panel's tablist ALSO carries aria-label="Event
     details", so a bare attribute selector would also turn the tabs into a
     fixed full-screen overlay covering the header and the close button. */
  [data-mobile] aside[aria-label="Event details"] {
    position: fixed;
    inset: 0;
    z-index: 40;
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    border-left: none;
    box-shadow: none;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  [data-mobile] aside[aria-label="Event details"] [aria-label="Resize event details"] {
    display: none;
  }
  /* The panel's fixed z-index lives inside the ledger's stacking context
     (position:relative; z-index:0; isolation:isolate), so it loses to the
     top bar (z3), the tabs and the timeline bar (z1) — the banner then
     covers the panel and the tabs/timeline stay visible above it. While the
     panel is open, raise the ledger itself so the whole subtree (panel
     included) covers them.
     2026-08-23 (#17 回归修复)：:has() 是 Chromium 105+；MIUI12 旧 WebView
     (Chromium 83) 整条规则被丢弃 → 面板遮挡回归。保留 :has() 路径（新内核
     零开销，无 JS 依赖）并追加 class 路径（旧内核由 TrajectoryPanelsObserver
     在面板开合时切换 data-mobile-ledger-raised）。 */
  [data-mobile] [class*="ledger"]:has(aside[aria-label="Event details"]) {
    z-index: 12;
  }
  [data-mobile] [class*="ledger"].data-mobile-ledger-raised {
    z-index: 12;
  }
}
`;
		//#endregion
		//#region src/client/trajectory-panels-observer.ts
		/**
		* 轨迹详情面板开合的 class 降级路径（2026-08-23，#17 回归修复）：
		* 主 CSS 用 :has()（Chromium 105+）抬升 ledger z-index；旧 WebView（MIUI12
		* 时代 Chromium 83）不支持 :has()，整条规则被丢弃 → 面板被顶部 banner 遮挡。
		* 本观察器用 MutationObserver 检测 aside[aria-label="Event details"] 的存在，
		* 给所属 ledger 切换 data-mobile-ledger-raised class（trajectory-details.css.ts
		* 的伴随规则兜底），并在浏览器原生支持 :has() 时自动停摆（零重复开销）。
		*/
		var TrajectoryPanelsObserver = class {
			mutationObserver = new MutationObserver((records) => {
				if (records.some((record) => this.isRelevantMutation(record))) this.sync();
			});
			ledger;
			attached = false;
			constructor(ledger) {
				this.ledger = ledger;
			}
			/** 开始监听面板开合（幂等）。 */
			attach() {
				if (this.attached) return;
				if (this.supportsHasSelector()) return;
				this.attached = true;
				this.mutationObserver.observe(document.body, {
					childList: true,
					subtree: true
				});
				this.sync();
			}
			/** 停止监听并清除 class。 */
			detach() {
				this.mutationObserver.disconnect();
				if (this.attached && this.ledger !== null) this.ledger.classList.remove("data-mobile-ledger-raised");
				this.attached = false;
			}
			/** 面板存在 → 抬升 ledger（class 路径，CSS .data-mobile-ledger-raised）；否则移除。 */
			sync() {
				if (this.ledger === null) return;
				const panel = this.ledger.querySelector("aside[aria-label=\"Event details\"]");
				this.ledger.classList.toggle("data-mobile-ledger-raised", panel !== null);
			}
			isRelevantMutation(record) {
				return [
					record.target,
					...record.addedNodes,
					...record.removedNodes
				].some((node) => {
					if (!(node instanceof Element)) return false;
					return node.matches("aside[aria-label=\"Event details\"]") || node.querySelector("aside[aria-label=\"Event details\"]") !== null;
				});
			}
			/** CSS 支持探测：:has() 对旧内核很可能是 SyntaxError 整条丢弃后的误报，
			*  用 CSS.supports 的官方探测（Chromium 105+ 才有 CSS.supports('selector(:has(*))') 真值）。 */
			supportsHasSelector() {
				try {
					return typeof CSS !== "undefined" && CSS.supports !== void 0 && CSS.supports("selector(:has(*))");
				} catch {
					return false;
				}
			}
		};
		//#endregion
		//#region src/client/menu-viewport-guard.ts
		/** Maximum command-menu height from the upstream visual specification. */
		const MENU_CAP = 320;
		/** Space kept below the mobile top bar before the command menu begins. */
		const TOPBAR_CLEARANCE = 12;
		/**
		* Calculate the usable height for an upward-opening command menu.
		* The menu bottom is anchored to the composer, while the mobile top bar
		* occupies part of the viewport above it.
		*/
		function mobileMenuMaxHeight(menuBottom, topbarBottom, chromeHeight = 0) {
			return Math.max(0, Math.min(MENU_CAP, Math.floor(menuBottom - topbarBottom - TOPBAR_CLEARANCE - chromeHeight)));
		}
		/**
		* Keeps the upstream bottom-anchored command menu below the mobile top bar.
		* The upstream hook clamps only to viewport top; the frame owns the extra
		* mobile chrome and applies this additional geometric constraint.
		*/
		var MenuViewportGuard = class {
			onViewportChange = () => {
				this.queue();
			};
			mutationObserver = new MutationObserver((records) => {
				if (records.some((record) => this.isRelevantMutation(record))) this.queue();
			});
			resizeObserver = new ResizeObserver(() => {
				this.queue();
			});
			frame = null;
			observed = [];
			menu = null;
			/** Start observing mobile menu geometry. */
			attach() {
				this.mutationObserver.observe(document.body, {
					childList: true,
					subtree: true
				});
				window.addEventListener("resize", this.onViewportChange);
				window.addEventListener("scroll", this.onViewportChange, true);
				window.visualViewport?.addEventListener("resize", this.onViewportChange);
				this.queue();
			}
			/** Stop observing and remove the transient inline constraint. */
			detach() {
				this.mutationObserver.disconnect();
				this.resizeObserver.disconnect();
				window.removeEventListener("resize", this.onViewportChange);
				window.removeEventListener("scroll", this.onViewportChange, true);
				window.visualViewport?.removeEventListener("resize", this.onViewportChange);
				if (this.frame !== null) cancelAnimationFrame(this.frame);
				this.frame = null;
				this.menu?.style.removeProperty("--dsh-mobile-menu-max-height");
				this.menu = null;
				this.observed = [];
			}
			queue() {
				if (this.frame !== null) return;
				this.frame = requestAnimationFrame(() => {
					this.frame = null;
					this.apply();
				});
			}
			apply() {
				const topbar = document.querySelector("[data-mobile-topbar]");
				const menu = document.querySelector("[data-composer-card] [role=\"listbox\"]");
				if (topbar === null || menu === null) {
					this.menu?.style.removeProperty("--dsh-mobile-menu-max-height");
					this.menu = null;
					this.syncObserved([]);
					return;
				}
				const seat = menu.closest("[data-composer-seat]");
				const card = menu.closest("[data-composer-card]");
				this.menu = menu;
				this.syncObserved([
					topbar,
					seat,
					card
				].filter((element) => element !== null));
				const value = `${mobileMenuMaxHeight(menu.getBoundingClientRect().bottom, topbar.getBoundingClientRect().bottom, menuChromeHeight(menu))}px`;
				if (menu.style.getPropertyValue("--dsh-mobile-menu-max-height") !== value) menu.style.setProperty("--dsh-mobile-menu-max-height", value);
			}
			syncObserved(next) {
				if (next.length === this.observed.length && next.every((element, index) => element === this.observed[index])) return;
				this.resizeObserver.disconnect();
				for (const element of next) this.resizeObserver.observe(element);
				this.observed = next;
			}
			isRelevantMutation(record) {
				if (record.target instanceof Element && record.target.closest("[data-composer-card]") !== null) return true;
				return [...record.addedNodes, ...record.removedNodes].some((node) => {
					if (!(node instanceof Element)) return false;
					return node.matches("[data-composer-card], [role=\"listbox\"]") || node.querySelector("[data-composer-card], [role=\"listbox\"]") !== null;
				});
			}
		};
		/** Height excluded from CSS max-height when the menu uses content-box sizing. */
		function menuChromeHeight(menu) {
			const style = getComputedStyle(menu);
			if (style.boxSizing === "border-box") return 0;
			return [
				"paddingTop",
				"paddingBottom",
				"borderTopWidth",
				"borderBottomWidth"
			].map((property) => Number.parseFloat(style[property]) || 0).reduce((total, value) => total + value, 0);
		}
		//#endregion
		//#region src/client/session-log-dialog.css.ts
		/**
		* Hide the upstream session-log-export modal on Android shell builds.
		*
		* The shell APK already owns the export result surface: MainActivity pushes
		* the final success/failure through `window.__dshExportResult`, and
		* `ExportResultDialog` renders it in `shell.overlay`. The upstream
		* `session-log-export` modal also opens (preparing → success/error), so two
		* dialogs stack. The upstream CSS Module class names are hashed, so this
		* stylesheet targets the modal's stable ARIA attributes instead.
		*/
		const SESSION_LOG_DIALOG_HIDE_CSS = `
[role="presentation"]:has([role="dialog"][aria-label^="正在导出 Session"]),
[role="presentation"]:has([role="dialog"][aria-label^="Session 导出"]),
[role="presentation"]:has([role="dialog"][aria-label^="Exporting Session"]),
[role="presentation"]:has([role="dialog"][aria-label^="Session download"]),
[role="presentation"]:has([role="dialog"][aria-label^="Session export"]) {
  display: none !important;
}
`;
		//#endregion
		//#region src/client/dev-section/DevSection.tsx
		/**
		* Developer-options settings page (Android shell facilities): restart / shut down (both with a
		* custom confirm) / refresh UI / open console / dev debug-log toggle. Registered at the upstream
		* settings.section extension point (auto-projected by ui-settings-general's nav, zero upstream
		* changes). Bridge calls go through window.androidBridge (injected by MainActivity's
		* addJavascriptInterface).
		*
		* Restart and shut down draw a custom frontend confirm because WebView's window.confirm is
		* unreliable under the shell's auto-approving onJsAlert; "Shut down" stops the engine and falls
		* back to the init screen (shell shutdownToGuide bridge).
		*/
		const CONFIRM_TEXT = {
			restart: {
				title: "重启 DeepSeek Harness？",
				desc: "将终止并自动重新启动本地引擎与页面（约数秒）。未发送的内容会保留在输入框。",
				ok: "重启"
			},
			close: {
				title: "关闭并回退到初始化界面？",
				desc: "将停止本地引擎并退出到初始化界面；引擎不会自动重启，需手动再次启动。",
				ok: "关闭"
			}
		};
		/**
		* Render the developer-options section content column.
		* @param props - composed slot props (contract/slots.ts).
		* @returns the section element tree.
		*/
		function DevSection({ renderSlot }) {
			const [devLog, setDevLog] = (0, react.useState)(() => {
				try {
					return window.androidBridge?.getDevLogEnabled?.() ?? false;
				} catch {
					return false;
				}
			});
			const [restarting, setRestarting] = (0, react.useState)(false);
			const [allFiles, setAllFiles] = (0, react.useState)(null);
			const [confirm, setConfirm] = (0, react.useState)(null);
			const [incomingBytes, setIncomingBytes] = (0, react.useState)(null);
			const [incomingMsg, setIncomingMsg] = (0, react.useState)(null);
			const [cleaning, setCleaning] = (0, react.useState)(false);
			const refreshIncoming = (0, react.useCallback)(async () => {
				try {
					const r = await fetch("/api/android/file-incoming");
					if (r.ok) {
						const j = await r.json();
						setIncomingBytes(typeof j.bytes === "number" ? j.bytes : null);
					}
				} catch {}
			}, []);
			(0, react.useEffect)(() => {
				refreshIncoming();
			}, [refreshIncoming]);
			const cleanIncoming = (0, react.useCallback)(async () => {
				setCleaning(true);
				setIncomingMsg(null);
				try {
					const j = await (await fetch("/api/android/file-incoming/clean", { method: "POST" })).json().catch(() => null);
					setIncomingMsg(j?.ok ? `已清空临时工作区（${j.removed ?? 0} 项）——相关会话中的文件引用将失效` : "清理失败");
				} catch {
					setIncomingMsg("清理请求失败（仅安卓宿主可用）");
				} finally {
					setCleaning(false);
					refreshIncoming();
				}
			}, [refreshIncoming]);
			const fmtBytes = (n) => {
				if (n >= 1048576) return (n / 1024 / 1024).toFixed(1) + " MB";
				if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
				return n + " B";
			};
			(0, react.useEffect)(() => {
				try {
					setAllFiles(window.androidBridge?.hasAllFilesAccess?.() ?? false);
				} catch {
					setAllFiles(false);
				}
			}, []);
			const askRestart = (0, react.useCallback)(() => setConfirm("restart"), []);
			const askClose = (0, react.useCallback)(() => setConfirm("close"), []);
			const cancelConfirm = (0, react.useCallback)(() => setConfirm(null), []);
			const doRestart = (0, react.useCallback)(() => {
				setConfirm(null);
				setRestarting(true);
				try {
					window.androidBridge?.restartEngine?.();
				} catch {}
				window.setTimeout(() => setRestarting(false), 2e3);
			}, []);
			const doClose = (0, react.useCallback)(() => {
				setConfirm(null);
				try {
					window.androidBridge?.shutdownToGuide?.();
				} catch {}
			}, []);
			const reload = (0, react.useCallback)(() => {
				try {
					window.androidBridge?.reloadWebUI?.();
				} catch {}
			}, []);
			const openConsole = (0, react.useCallback)(() => {
				try {
					window.androidBridge?.openConsole?.();
				} catch {}
			}, []);
			const toggleLog = (0, react.useCallback)((enabled) => {
				setDevLog(enabled);
				try {
					window.androidBridge?.setDevLogEnabled?.(enabled);
				} catch {}
			}, []);
			const onKeyDown = (0, react.useCallback)((e) => {
				if (e.key === "Escape") cancelConfirm();
			}, [cancelConfirm]);
			const logPathHint = allFiles === false ? "未授予「所有文件访问」：日志将写入应用私有目录，授权后自动切换公共目录。" : "开启后按天写入 Documents/dshdata/log/dsh-<日期>.log。";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-plugin": "dev-section",
				onKeyDown,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-dev-note",
						children: "Android 壳调试设施：控制台为快照内嵌 Termux bash；日志默认关闭。"
					}),
					renderSlot?.("settings.dev.item", {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-dev-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-dev-btn",
								onClick: askRestart,
								disabled: restarting,
								children: restarting ? "重启中…" : "重启"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-dev-btn dsh-dev-danger",
								onClick: askClose,
								children: "关闭"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-dev-btn",
								onClick: reload,
								children: "刷新界面"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-dev-btn",
								onClick: openConsole,
								children: "打开控制台"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dsh-dev-row dsh-dev-switch",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: devLog,
							onChange: (e) => toggleLog(e.target.checked)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "开发者调试日志" })]
					}),
					incomingBytes !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-dev-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["文件直达临时工作区占用：", fmtBytes(incomingBytes)] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsh-dev-btn dsh-dev-danger",
							disabled: cleaning || incomingBytes === 0,
							onClick: () => void cleanIncoming(),
							children: cleaning ? "清理中…" : "一键清理"
						})]
					}),
					incomingMsg !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-dev-hint",
						children: incomingMsg
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-dev-hint",
						children: "清理会删除临时工作区内的外部文件；相关会话中的文件引用将失效（D15：纯手动清理，无自动清理）。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-dev-hint",
						children: logPathHint
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-dev-warn",
						children: "日志包含命令与模型内容，仅用于排查，请及时清理。"
					}),
					confirm !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-dev-modal-overlay",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": CONFIRM_TEXT[confirm].title,
						onClick: cancelConfirm,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-dev-modal",
							role: "document",
							onClick: (e) => e.stopPropagation(),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsh-dev-modal-title",
									children: CONFIRM_TEXT[confirm].title
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsh-dev-modal-desc",
									children: CONFIRM_TEXT[confirm].desc
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-dev-modal-actions",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-dev-btn",
										autoFocus: true,
										onClick: cancelConfirm,
										children: "取消"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: confirm === "close" ? "dsh-dev-btn dsh-dev-danger" : "dsh-dev-btn",
										onClick: confirm === "restart" ? doRestart : doClose,
										children: CONFIRM_TEXT[confirm].ok
									})]
								})
							]
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/dev-section/dev-section.css.ts
		/**
		* Developer-options settings-page styles: reuse --dsw-* semantic tokens (auto light/dark), buttons in
		* a wrapping row layout; on narrow screens (mobile form) buttons become a two-column grid.
		* Injection matches mobile-settings.css.ts (style tag + data-plugin attribute; this page's root
		* selector uses [data-plugin='dev-section'] against class-hash churn).
		*/
		const DEV_SECTION_CSS = `
[data-plugin='dev-section'] {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 12px;
}

.dsh-dev-note {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary, #666);
}

.dsh-dev-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.dsh-dev-btn {
  min-height: 36px;
  padding: 6px 14px;
  border: 1px solid var(--dsw-alias-border-strong, #ccc);
  border-radius: 8px;
  background: var(--dsw-alias-bg-elevated, #fff);
  color: var(--dsw-alias-label-primary, #222);
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}

.dsh-dev-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.dsh-dev-danger {
  border-color: var(--dsw-alias-danger-fg, #c0392b);
  color: var(--dsw-alias-danger-fg, #c0392b);
}

.dsh-dev-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  padding: 20px;
}

.dsh-dev-modal {
  width: 100%;
  max-width: 360px;
  padding: 18px 20px;
  border: 1px solid var(--dsw-alias-border-strong, #ccc);
  border-radius: 12px;
  background: var(--dsw-alias-bg-elevated, #fff);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25);
}

.dsh-dev-modal-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #222);
}

.dsh-dev-modal-desc {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary, #666);
}

.dsh-dev-modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.dsh-dev-switch {
  font-size: 14px;
  color: var(--dsw-alias-label-primary, #222);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}

.dsh-dev-switch input {
  width: 16px;
  height: 16px;
  margin: 0;
}

.dsh-dev-label {
  font-size: 14px;
  color: var(--dsw-alias-label-primary, #222);
  min-width: 64px;
}

.dsh-dev-value {
  font-size: 13px;
  color: var(--dsw-alias-label-secondary, #666);
  min-width: 44px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.dsh-dev-row input[type='range'] {
  flex: 1;
  min-width: 120px;
}

.dsh-dev-hint {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #666);
}

.dsh-dev-warn {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-danger-fg, #c0392b);
}

/* Dark-theme fallback (#43, 2026-08-18): in some environments --dsw-alias-bg-elevated is undefined
 * and falls back to #fff (white bg), while label-primary is white text in dark mode → white-on-white.
 * Provide explicit theme-consistent fallbacks for tokens that may not exist. */
@media (prefers-color-scheme: dark) {
  .dsh-dev-btn {
    background: var(--dsw-alias-bg-elevated, #26262b);
    color: var(--dsw-alias-label-primary, #f2f2f4);
    border-color: var(--dsw-alias-border-strong, #55555c);
  }
  .dsh-dev-note, .dsh-dev-hint {
    color: var(--dsw-alias-label-secondary, #c9c9cf);
  }
  .dsh-dev-warn {
    color: var(--dsw-alias-danger-fg, #ff9c9c);
  }
  .dsh-dev-danger {
    border-color: var(--dsw-alias-danger-fg, #ff9c9c);
    color: var(--dsw-alias-danger-fg, #ff9c9c);
  }
  .dsh-dev-modal {
    background: var(--dsw-alias-bg-elevated, #26262b);
    border-color: var(--dsw-alias-border-strong, #55555c);
  }
  .dsh-dev-modal-title {
    color: var(--dsw-alias-label-primary, #f2f2f4);
  }
  .dsh-dev-modal-desc {
    color: var(--dsw-alias-label-secondary, #c9c9cf);
  }
}

@media (max-width: 639px) {
  .dsh-dev-btn {
    flex: 1 1 calc(50% - 5px);
    text-align: center;
  }
}
`;
		//#endregion
		//#region src/client/general-settings/GeneralSettings.tsx
		/**
		* General-settings additions for the Android shell (issue #59): the upstream
		* Settings → General section lost its two Android-only rows — the font-size
		* slider (WebView textZoom, 50–200%) and the immersive status-bar toggle.
		* The shell bridges exist (androidBridge.setTextZoom / setImmersiveMode, both
		* persisted by MainActivity), but no settings page ever registered the rows.
		* Registered at the upstream settings.general.item extension point (auto
		* projected into the General section nav), mirroring DevSection.
		*
		* The slider reflects the persisted value only while the page lives; the
		* shell persists textZoom in SharedPreferences and applies it at startup, so
		* there is no getter — the UI starts at 100% and the slider is an action
		* control, not a mirror. The immersive toggle reads localStorage
		* (dsh.android.immersive, written by the patched index.html immersive script)
		* for its initial state.
		*/
		const TEXT_ZOOM_MIN = 50;
		const TEXT_ZOOM_MAX = 200;
		const TEXT_ZOOM_STEP = 10;
		const IMMERSIVE_KEY = "dsh.android.immersive";
		/** Read the persisted immersive flag with the same default the shell uses (true). */
		function readImmersive() {
			try {
				return localStorage.getItem(IMMERSIVE_KEY) !== "0";
			} catch {
				return true;
			}
		}
		/**
		* Render the Android general-settings rows (font slider + immersive toggle).
		* @param props - composed slot props (contract/slots.ts).
		* @returns the section element tree.
		*/
		function GeneralSettings(_props) {
			const [textZoom, setTextZoom] = (0, react.useState)(100);
			const [immersive, setImmersive] = (0, react.useState)(readImmersive);
			(0, react.useEffect)(() => {
				setImmersive(readImmersive());
			}, []);
			const applyTextZoom = (0, react.useCallback)((percent) => {
				const clamped = Math.min(TEXT_ZOOM_MAX, Math.max(TEXT_ZOOM_MIN, percent));
				setTextZoom(clamped);
				try {
					window.androidBridge?.setTextZoom?.(clamped);
				} catch {}
			}, []);
			const toggleImmersive = (0, react.useCallback)((enabled) => {
				setImmersive(enabled);
				try {
					localStorage.setItem(IMMERSIVE_KEY, enabled ? "1" : "0");
				} catch {}
				try {
					window.androidBridge?.setImmersiveMode?.(enabled);
				} catch {}
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-plugin": "android-general",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-dev-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								className: "dsh-dev-label",
								htmlFor: "dsh-text-zoom",
								children: "字体大小"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								id: "dsh-text-zoom",
								type: "range",
								min: TEXT_ZOOM_MIN,
								max: TEXT_ZOOM_MAX,
								step: TEXT_ZOOM_STEP,
								value: textZoom,
								onChange: (e) => applyTextZoom(Number(e.currentTarget.value))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsh-dev-value",
								children: [textZoom, "%"]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-dev-hint",
						children: "调整页面字体缩放（50–200%），立即生效并持久化。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dsh-dev-row dsh-dev-switch",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: immersive,
							onChange: (e) => toggleImmersive(e.target.checked)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "沉浸式状态栏" })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-dev-hint",
						children: "常态隐藏系统状态栏，边缘滑动临时呼出；关闭后常驻显示。"
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* Required services (cordis fiber inject — the loader passes all module
		* exports as an object plugin).
		*
		* `uiWorkspace` is deliberately NOT listed: dsh-client-ui-workspace declares an
		* edge to this layout plugin, so depending on it back would deadlock the boot
		* (the frame must activate first). The F5 poller below reaches it through the
		* lazy ctx getter instead, inside its existing retry guard.
		*/
		const inject = ["slots", "theme"];
		/**
		* Client plugin body: provide ctx.layout, then one register() call — AppFrame
		* into 'root' with the five child-slot declarations and the layout store seat.
		* The 0.1.7 registration has no inject hook, so the store handle is created
		* here and its single instance is shared between the frame and the service
		* face. Later effects carry the Android/mobile UI adaptations.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				const handle = createLayoutStore();
				const instance = handle.create();
				const store = {
					...handle,
					create: () => instance
				};
				const retainMainPanels = () => {
					instance.actions.retainMainPanels(ctx.slots.entries("main").flatMap((entry) => entry.options.key === void 0 ? [] : [entry.options.key]));
				};
				const layout = new LayoutController(instance.actions, (id) => ctx.slots.entries("main").some((entry) => entry.options.key === id), {
					getSnapshot: () => instance.getSnapshot().panelInfo,
					subscribe: (listener) => instance.subscribe(listener)
				});
				const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: layout.panelInfo } });
				const disposeService = ctx.reflect.provide("layout", layout);
				const disposeRegistration = ctx.slots.register({
					name: "root",
					children: {
						"sidebar": {
							kind: "single",
							scope: "root"
						},
						"main": {
							kind: "keyed",
							scope: "root"
						},
						"rightbar": {
							kind: "single",
							scope: "root"
						},
						"shell.overlay": {
							kind: "list",
							scope: "root"
						},
						"shell.leading": {
							kind: "single",
							scope: "root"
						}
					},
					store
				}, AppFrame);
				const disposePanels = ctx.slots.subscribe("main", retainMainPanels);
				retainMainPanels();
				return () => {
					layout.dispose();
					disposePanels();
					disposeRegistration();
					disposePanelInfo();
					disposeService();
				};
			}, "ui-layout: service + root registration");
			ctx.effect(() => {
				const style = document.createElement("style");
				style.setAttribute("data-plugin", "mobile-settings");
				style.textContent = MOBILE_SETTINGS_CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, "ui-layout: mobile settings styles");
			ctx.effect(() => {
				const style = document.createElement("style");
				style.setAttribute("data-plugin", "dev-section");
				style.textContent = DEV_SECTION_CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, "ui-layout: dev section styles");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "android-dev",
				order: 99,
				label: () => "开发者选项",
				children: { "settings.dev.item": {
					kind: "list",
					scope: "root"
				} }
			}, DevSection));
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "android-general",
				order: 90,
				label: () => "Android 显示"
			}, GeneralSettings));
			ctx.effect(() => {
				const style = document.createElement("style");
				style.setAttribute("data-plugin", "composer-row");
				style.textContent = COMPOSER_ROW_CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, "ui-layout: composer row narrow fix");
			ctx.effect(() => {
				const style = document.createElement("style");
				style.setAttribute("data-plugin", "composer-insets");
				style.textContent = COMPOSER_INSETS_CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, "ui-layout: composer insets adaptation");
			ctx.effect(() => {
				const style = document.createElement("style");
				style.setAttribute("data-plugin", "composer-menu");
				style.textContent = COMPOSER_MENU_CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, "ui-layout: composer menu scroll fix");
			ctx.effect(() => {
				const style = document.createElement("style");
				style.setAttribute("data-plugin", "trajectory-details");
				style.textContent = TRAJECTORY_DETAILS_CSS;
				document.head.appendChild(style);
				const observer = new TrajectoryPanelsObserver(document.querySelector("[class*=\"ledger\"]"));
				observer.attach();
				return () => {
					observer.detach();
					style.remove();
				};
			}, "ui-layout: trajectory details full-viewport overlay + :has() fallback");
			ctx.effect(() => {
				const guard = new MenuViewportGuard();
				guard.attach();
				return () => {
					guard.detach();
				};
			}, "ui-layout: mobile command menu top clearance");
			ctx.effect(() => {
				const style = document.createElement("style");
				style.setAttribute("data-plugin", "session-log-dialog");
				style.textContent = SESSION_LOG_DIALOG_HIDE_CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, "ui-layout: hide upstream session-log dialog");
			ctx.effect(() => {
				const presenter = new ThemePresenter();
				presenter.apply(ctx.theme.getTheme());
				const off = ctx.on("theme/change", (snapshot) => {
					presenter.apply(snapshot);
				});
				return () => {
					off();
					presenter.dispose();
				};
			}, "ui-layout: theme presenter");
			ctx.effect(() => {
				const guard = new EnterGuard();
				guard.attach();
				return () => {
					guard.detach();
				};
			}, "ui-layout: mobile enter guard");
			ctx.effect(() => {
				const boundary = new KeyboardBoundary();
				boundary.attach();
				return () => {
					boundary.detach();
				};
			}, "ui-layout: mobile keyboard boundary");
			ctx.effect(() => {
				new ThemeBridge().install();
				return () => {};
			}, "ui-layout: theme bridge");
			let exportActions;
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "export-result",
				store: createExportResultStore,
				inject: (actions) => {
					exportActions = actions;
					return {};
				}
			}, ExportResultDialog));
			ctx.effect(() => {
				const opened = /* @__PURE__ */ new Set();
				let busy = false;
				const poll = async () => {
					if (busy) return;
					busy = true;
					try {
						const r = await fetch("/api/android/file-incoming");
						if (!r.ok) return;
						const j = await r.json().catch(() => null);
						if (!j?.items) return;
						for (const item of j.items) {
							if (!item.sessionId || opened.has(item.sessionId)) continue;
							try {
								ctx.uiWorkspace.openSession(item.sessionId);
								opened.add(item.sessionId);
								fetch("/api/android/file-incoming/claim", {
									method: "POST",
									headers: { "content-type": "application/json" },
									body: JSON.stringify({ file: item.file })
								}).catch(() => {});
							} catch {}
						}
					} catch {} finally {
						busy = false;
					}
				};
				const timer = window.setInterval(() => {
					if (document.visibilityState === "visible") poll();
				}, 4e3);
				const onVisible = () => {
					if (document.visibilityState === "visible") poll();
				};
				document.addEventListener("visibilitychange", onVisible);
				window.addEventListener("focus", onVisible);
				poll();
				return () => {
					window.clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisible);
					window.removeEventListener("focus", onVisible);
				};
			}, "ui-responsive: file-incoming consumer (F5)");
			ctx.effect(() => {
				const onResult = (event) => {
					const payload = event.detail;
					if (payload === null || typeof payload !== "object") return;
					if (typeof payload.ok !== "boolean" || typeof payload.title !== "string" || typeof payload.detail !== "string") return;
					exportActions?.show(payload);
				};
				const bridge = (payload) => {
					window.dispatchEvent(new CustomEvent("dsh:export-result", { detail: payload }));
				};
				window.__dshExportResult = bridge;
				window.addEventListener("dsh:export-result", onResult);
				return () => {
					window.removeEventListener("dsh:export-result", onResult);
					delete window.__dshExportResult;
				};
			}, "ui-layout: export result dialog bridge");
		}
		//#endregion
		exports.LayoutController = LayoutController;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map