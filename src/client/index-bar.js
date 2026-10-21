    function useComposerAnchor() {
      const [rect, setRect] = useState(null);
      // 上一次"真的量到了 composer"的结果。用 ref 存，避免进依赖反复重建定时器。
      const lastGoodRef = useRef(null);
      useEffect(() => {
        let alive = true;
        let last = null;
        const measure = () => {
          if (!alive) return;
          let next = null;
          const seat = document.querySelector("[data-composer-seat]") || document.querySelector('[data-conversation-region="composer"]');
          if (seat) {
            const r = seat.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              next = { left: r.left + 10, bottom: Math.max(8, window.innerHeight - r.bottom + 6), width: Math.max(200, r.width - 20), found: true };
              lastGoodRef.current = next;
            }
          }
          if (!next) {
            // 量不到 composer：优先粘住上次的有效位置（不跳），否则才用视口兜底
            const prev = lastGoodRef.current;
            next = prev
              ? { ...prev, found: false }
              : { left: 16, bottom: 14, width: Math.min(560, Math.max(220, window.innerWidth - 32)), found: false };
          }
          if (!last || Math.abs(next.left - last.left) > 1 || Math.abs(next.bottom - last.bottom) > 1 || Math.abs(next.width - last.width) > 1) {
            last = next;
            setRect(next);
          }
        };
        measure();
        const iv = setInterval(measure, 400);
        window.addEventListener("resize", measure);
        return () => {
          alive = false;
          clearInterval(iv);
          window.removeEventListener("resize", measure);
        };
      }, []);
      return rect;
    }

    /**
     * 放置模式 floating：shell.overlay 内 fixed 悬浮，可自由移动（默认自动锚定到对话左下角）。
     * 交互：点击任意指数 → 打开大悬浮窗；⚙ 短按=设置、按住拖动=移动指数栏、双击=回到自动锚定。
     */
    function FloatingIndexBar() {
      const s = useStore();
      useEffect(() => { initStore(); }, []);
      const rect = useComposerAnchor();
      const cfg = s.config;
      const [dragging, setDragging] = useState(false);
      const dragRef = useRef(null); // {ox,oy,sx,sy,moved}
      const suppressClickRef = useRef(false); // 拖动后抑制随之而来的 click（避免误开设置）
      const rootRef = useRef(null);

      // 全局拖动：⚙ 按下后由 window 跟踪移动/抬起
      useEffect(() => {
        const onMove = (e) => {
          const d = dragRef.current;
          if (!d) return;
          const dx = e.clientX - d.sx;
          const dy = e.clientY - d.sy;
          if (!d.moved && Math.hypot(dx, dy) < 4) return; // 阈值内视为点击
          d.moved = true;
          if (!dragging) setDragging(true);
          const x = clamp(e.clientX - d.ox, 4, window.innerWidth - 40);
          const y = clamp(e.clientY - d.oy, 4, window.innerHeight - 24);
          setBarPos({ x, y }, false); // 拖动中仅更新内存，避免每帧写 localStorage
        };
        const onUp = () => {
          const d = dragRef.current;
          if (!d) return;
          dragRef.current = null;
          if (d.moved) {
            setDragging(false);
            setBarPos(state.barPos); // 抬起时落盘最终位置
            suppressClickRef.current = true; // 抑制紧随的 click
            setTimeout(() => { suppressClickRef.current = false; }, 0);
          }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
        };
      }, [dragging]);

      const startGearDrag = (e) => {
        if (e.button !== undefined && e.button !== 0) return; // 仅左键
        if (!rootRef.current) return;
        const r = rootRef.current.getBoundingClientRect();
        dragRef.current = { ox: e.clientX - r.left, oy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
      };
      const resetPos = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = null;
        setDragging(false);
        setBarPos(null);
        toast("指数栏已回到自动锚定位置");
      };

      // 视口尺寸 + 悬浮栏实测尺寸：用于**渲染时**把坐标钳进可视区。
      // 关键：钳制只影响本次显示，绝不回写 localStorage —— 否则缩小窗口时
      // 用户设定的原始坐标会被钳制值覆盖，再放大就回不到原位
      // （用户报告："放大缩小放大，悬浮又不在原来的位置了"）。
      const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
      const [barSize, setBarSize] = useState({ w: 260, h: 28 });
      useClockTick(30000); // 保证按时段展开/收起不依赖行情推送
      useEffect(() => {
        const sync = () => {
          setVp((p) => (p.w === window.innerWidth && p.h === window.innerHeight ? p : { w: window.innerWidth, h: window.innerHeight }));
          const el = rootRef.current;
          if (el && el.offsetWidth) {
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            setBarSize((p) => (p.w === w && p.h === h ? p : { w, h }));
          }
        };
        sync();
        window.addEventListener("resize", sync);
        return () => window.removeEventListener("resize", sync);
      }, []);
      // 每次渲染后补测实际尺寸（切换 full/compact 等会改变宽度）
      useEffect(() => {
        const el = rootRef.current;
        if (!el || !el.offsetWidth) return;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        setBarSize((p) => (p.w === w && p.h === h ? p : { w, h }));
      });

      if (!cfg || !cfg.barVisible || s.barPlacement === "dock") return null;
      if (!rect && !s.barPos) return null;
      // 手动位置：仅渲染时钳进视口（存储里始终保留用户的原位坐标）
      const clampedPos = s.barPos
        ? {
            x: clamp(s.barPos.x, 4, Math.max(4, vp.w - barSize.w - 4)),
            y: clamp(s.barPos.y, 4, Math.max(4, vp.h - barSize.h - 4)),
          }
        : null;
      const posStyle = clampedPos
        ? { left: clampedPos.x, top: clampedPos.y }
        : { left: rect.left, bottom: rect.bottom, maxWidth: rect.width };
      const base = rootProps(s, cfg);
      const gearProps = {
        className: "sl-bar-btn sl-gear" + (dragging ? " sl-gear-dragging" : ""),
        "data-sltip": "点击=设置 · 按住拖动=自由移动指数栏 · 双击=回到自动锚定",
        onPointerDown: startGearDrag,
        onDoubleClick: resetPos,
        onClick: (e) => {
          if (suppressClickRef.current || (dragRef.current && dragRef.current.moved)) return; // 拖动结束，忽略 click
          openOverlay("settings");
        },
      };
      return h(
        "div",
        {
          ref: rootRef,
          className: base.className,
          style: Object.assign({}, base.style, { position: "fixed", zIndex: 9985, pointerEvents: "none" }, posStyle),
        },
        h(
          "div",
          { className: "sl-bar-wrap" + (dragging ? " sl-bar-dragging" : ""), style: { pointerEvents: "auto", display: "inline-flex", alignItems: "center", maxWidth: "100%" } },
          renderBarContent(s, cfg, gearProps),
        ),
      );
    }

    function IndexChip(props) {
      const { idx, q } = props;
      const cfg = useStore().config;
      const elRef = useRef(null);
      const up = q && q.percent > 0;
      const down = q && q.percent < 0;
      const col = up ? "var(--sl-up)" : down ? "var(--sl-down)" : "var(--sl-flat)";
      const lastPrice = q ? q.price : null;
      const prevPriceRef = useRef(undefined);
      useEffect(() => {
        const prev = prevPriceRef.current;
        prevPriceRef.current = lastPrice;
        if (prev === undefined || prev === null || lastPrice === null || prev === lastPrice) return;
        const el = elRef.current;
        if (!el) return;
        el.classList.remove("sl-flash-up", "sl-flash-down");
        void el.offsetWidth;
        el.classList.add(lastPrice > prev ? "sl-flash-up" : "sl-flash-down");
      }, [lastPrice]);
      const compact = cfg && cfg.barStyle === "compact";
      return h(
        "span",
        {
          ref: elRef,
          className: "sl-chip",
          onClick: props.onOpen,
          "data-sltip": q
            ? idx.name + "（" + displayCode(idx.code) + "）\n现 " + fmtPrice(q.price) + " 涨跌 " + (q.change >= 0 ? "+" : "") + fmtPrice(q.change) + " " + fmtPct(q.percent) + "\n今开 " + fmtPrice(q.open) + " 昨收 " + fmtPrice(q.yestclose) + "\n最高 " + fmtPrice(q.high) + " 最低 " + fmtPrice(q.low) + "\n成交 " + fmtMoney(q.amount, idx.code) + " · " + fmtTime(q.time)
            : (idx.name || idx.code) + "：行情获取中",
        },
        h("span", { className: "sl-chip-name" }, shortIndexName(idx.name, idx.code)),
        !compact ? h("span", { className: "sl-chip-price", style: { color: col } }, q ? fmtPrice(q.price) : "--") : null,
        h("span", { className: "sl-chip-pct", style: { color: col } }, q ? fmtPct(q.percent) : "--"),
      );
    }

    // ================================================================ 插件主体
    /** Required services: slots（布局挂载点）。 */
