    const menuSvg = (children) =>
      h("svg", {
        className: "sl-menu-ico",
        viewBox: "0 0 18 18",
        width: 14, height: 14, "aria-hidden": true,
      }, children);
    const menuPath = (d) => h("path", { d, fill: "none" });
    const menuCircle = (cx, cy, r) => h("circle", { cx, cy, r, fill: "none" });
    const MENU_ICONS = {
      pin: menuSvg([menuPath("M9 2l5 5-2.2 2.2.8 3.2-1.8 1.8-3.2-.8L5.4 15.6 3.4 13.6 5.2 11.8 4.4 8.6 6.6 6.4 9.8 7.2z")]),
      plus: menuSvg([menuPath("M9 4v10"), menuPath("M4 9h10")]),
      minus: menuSvg([menuPath("M4 9h10")]),
      bell: menuSvg([menuPath("M12.5 12H5.5c.8-1 .8-2.2.8-3.5C6.3 6 7.4 4.5 9 4.5s2.7 1.5 2.7 4c0 1.3 0 2.5.8 3.5z"), menuPath("M8 14a1.2 1.2 0 002 0")]),
      pencil: menuSvg([menuPath("M3.5 14.5l.8-3 7.2-7.2 2.2 2.2-7.2 7.2z"), menuPath("M10.5 5.3l2.2 2.2")]),
      list: menuSvg([menuPath("M5 5.5h8"), menuPath("M5 9h8"), menuPath("M5 12.5h8")]),
      trash: menuSvg([menuPath("M3.5 5h11"), menuPath("M7 5V3.5h4V5"), menuPath("M5 5l.7 9.5h6.6L13 5"), menuPath("M7.5 7.5v4.5"), menuPath("M10.5 7.5v4.5")]),
      gear: menuSvg([menuCircle(9, 9, 2.2), menuPath("M9 3.2v1.9"), menuPath("M9 12.9v1.9"), menuPath("M3.2 9h1.9"), menuPath("M12.9 9h1.9"), menuPath("M4.9 4.9l1.3 1.3"), menuPath("M11.8 11.8l1.3 1.3"), menuPath("M13.1 4.9l-1.3 1.3"), menuPath("M6.2 11.8l-1.3 1.3")]),
    };
    /** 单个线性图标（按名字取预构建的元素树） */
    function MenuIcon(props) {
      return MENU_ICONS[props.name] || null;
    }
    function ContextMenu(props) {
      const menu = props.menu;
      useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape") closeMenu(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, []);
      if (!menu) return null;
      // 视口钳制（估算尺寸，渲染后再由 CSS max 限制兜底）
      const x = Math.min(menu.x, window.innerWidth - 190);
      const y = Math.min(menu.y, window.innerHeight - (menu.items.length * 30 + 40));
      return h(
        react.Fragment,
        null,
        h("div", { style: { position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "auto" }, onMouseDown: closeMenu, onContextMenu: (e) => { e.preventDefault(); closeMenu(); } }),
        h(
          "div",
          { className: "sl-root sl-theme-" + state.theme + (state.theme === "light" ? " sl-light" : "") + " sl-menu", style: { left: Math.max(4, x), top: Math.max(4, y) }, onMouseDown: (e) => e.stopPropagation() },
          menu.header ? h("div", { className: "sl-menu-hint" }, menu.header) : null,
          menu.items.map((it, i) =>
            it.sep
              ? h("div", { key: i, className: "sl-menu-sep" })
              : h("button", {
                  key: i,
                  className: "sl-menu-item" + (it.danger ? " sl-menu-danger" : ""),
                  onClick: () => { closeMenu(); try { it.onClick(); } catch { /* ignore */ } },
                }, it.icon ? h(MenuIcon, { name: it.icon }) : null, h("span", null, it.label)),
          ),
        ),
      );
    }

    /** 持仓成本/股数编辑对话框（右键菜单「编辑成本/股数」打开）：跟随悬浮窗定位、拖动时实时贴合 */
    function usePanelRect(active) {
      const [rect, setRect] = useState(null);
      useEffect(() => {
        if (!active) { setRect(null); return undefined; }
        let raf = 0;
        let last = null;
        const measure = () => {
          const el = document.querySelector(".sl-panel");
          if (el) {
            const r = el.getBoundingClientRect();
            if (r.width > 0) {
              if (!last || Math.abs(last.left - r.left) > 0.5 || Math.abs(last.top - r.top) > 0.5 || last.width !== r.width || last.height !== r.height) {
                last = { left: r.left, top: r.top, width: r.width, height: r.height };
                setRect(last);
              }
            }
          }
          raf = requestAnimationFrame(measure);
        };
        measure();
        return () => cancelAnimationFrame(raf);
      }, [active]);
      return rect;
    }
    function EditPosDialog() {
      const s = useStore();
      const ep = s.editPos;
      const [cost, setCost] = useState("");
      const [qty, setQty] = useState("");
      const panelRect = usePanelRect(!!ep);
      const boxRef = useRef(null);
      useEffect(() => {
        if (ep) { setCost(ep.cost || ""); setQty(ep.qty || ""); }
      }, [ep && ep.code]);
      useEffect(() => {
        if (!ep) return undefined;
        const onKey = (e) => { if (e.key === "Escape") setState({ editPos: null }); };
        const onDown = (e) => {
          if (boxRef.current && !boxRef.current.contains(e.target)) setState({ editPos: null });
        };
        window.addEventListener("keydown", onKey);
        document.addEventListener("mousedown", onDown);
        return () => {
          window.removeEventListener("keydown", onKey);
          document.removeEventListener("mousedown", onDown);
        };
      }, [ep]);
      if (!ep) return null;
      const save = () => {
        const c = parseFloat(cost);
        const v = parseInt(qty, 10);
        updatePosition(ep.code, {
          cost: Number.isFinite(c) && c > 0 ? c : 0,
          qty: Number.isFinite(v) && v > 0 ? v : 0,
        });
        setState({ editPos: null });
        toast("已保存 " + (ep.name || ep.code) + " 成本/股数");
      };
      // 定位：贴合悬浮窗（panel）中央；测不到 panel 时回退视口居中
      const boxW = 280;
      const cx = panelRect ? panelRect.left + panelRect.width / 2 : window.innerWidth / 2;
      const cy = panelRect ? panelRect.top + panelRect.height / 2 : window.innerHeight / 2;
      const style = { position: "fixed", left: cx, top: cy, transform: "translate(-50%,-50%)", zIndex: 10002, pointerEvents: "auto" };
      return h(
        "div",
        { className: "sl-root sl-theme-" + s.theme + (s.theme === "light" ? " sl-light" : ""), style },
        h(
          "div",
          { ref: boxRef, style: { width: boxW, background: "var(--sl-bg)", border: "1px solid var(--sl-accent-border)", borderRadius: 10, padding: 12, boxShadow: "var(--sl-shadow)", display: "flex", flexDirection: "column", gap: 8 } },
          h("div", { style: { fontWeight: 700, color: "var(--sl-accent)" } }, "编辑持仓：" + (ep.name || ep.code) + "（" + displayCode(ep.code) + "）"),
          h("label", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
            h("span", { className: "sl-setlabel" }, "成本价"),
            h("input", { className: "sl-input", style: { width: 150 }, type: "number", step: "0.001", min: "0", value: cost, autoFocus: true, placeholder: "如 1274.89", onChange: (e) => setCost(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") save(); } })),
          h("label", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
            h("span", { className: "sl-setlabel" }, "股数"),
            h("input", { className: "sl-input", style: { width: 150 }, type: "number", step: "100", min: "0", value: qty, placeholder: "如 100", onChange: (e) => setQty(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") save(); } })),
          h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 } },
            h("button", { className: "sl-btn sl-btn-ghost", onClick: () => setState({ editPos: null }) }, "取消"),
            h("button", { className: "sl-btn", onClick: save }, "保存")),
        ),
      );
    }

    // ================================================================ 通用悬浮提示（仿收益浮层）
    /**
     * 全局委托：任意元素带 data-sltip="文本"（\n 换行）即触发统一样式浮层。
     * 监听一次（apply 内注册），mouseover 定位到元素上方居中，mouseout 清除。
     */
    function initTipLayer() {
      const onOver = (e) => {
        const t = e.target;
        const el = t && t.closest ? t.closest("[data-sltip]") : null;
        if (!el) return;
        const text = el.getAttribute("data-sltip");
        if (!text) return;
        const r = el.getBoundingClientRect();
        setState({ tip: { x: r.left + r.width / 2, top: r.top, bottom: r.bottom, text } });
      };
      const onOut = (e) => {
        const t = e.target;
        const el = t && t.closest ? t.closest("[data-sltip]") : null;
        if (!el) return;
        const to = e.relatedTarget;
        if (to && to.closest && to.closest("[data-sltip]") === el) return; // 移到子元素，保持
        setState({ tip: null });
      };
      // 页面任意处的按下/点击/滚轮/滚动都立即收起提示
      // （包括点击提示自己 —— 点行进入详情、点胶囊切页签时，提示必须跟着走）
      const hide = () => { if (state.tip) setState({ tip: null }); };
      window.addEventListener("mouseover", onOver, true);
      window.addEventListener("mouseout", onOut, true);
      window.addEventListener("mousedown", hide, true);
      window.addEventListener("click", hide, true);
      window.addEventListener("wheel", hide, { capture: true, passive: true });
      window.addEventListener("scroll", hide, true);
      return () => {
        window.removeEventListener("mouseover", onOver, true);
        window.removeEventListener("mouseout", onOut, true);
        window.removeEventListener("mousedown", hide, true);
        window.removeEventListener("click", hide, true);
        window.removeEventListener("wheel", hide, true);
        window.removeEventListener("scroll", hide, true);
      };
    }
    /** 提示浮层：渲染在 shell.overlay 顶层，fixed 定位，自动上/下翻转 + 水平钳制。 */
    function TipLayer() {
      const s = useStore();
      const tip = s.tip;
      if (!tip) return null;
      const flipDown = tip.top < 96; // 顶部空间不足则显示在下方
      const style = flipDown
        ? { left: tip.x, top: tip.bottom + 8, transform: "translateX(-50%)" }
        : { left: tip.x, top: tip.top - 8, transform: "translateX(-50%) translateY(-100%)" };
      const half = 170; // max-width 320 的一半，水平钳制避免溢出屏幕
      style.left = Math.max(half + 8, Math.min(window.innerWidth - half - 8, tip.x));
      return h("div", { className: "sl-root sl-theme-" + s.theme + (s.theme === "light" ? " sl-light" : "") + " sl-tip", style }, tip.text);
    }

    // ================================================================ 视图：大盘
