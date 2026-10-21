    let inited = false;
    async function initStore() {
      if (inited) return;
      inited = true;
      try {
        const t = localStorage.getItem(LS_THEME);
        if (t === "light" || t === "dark") setState({ theme: t });
      } catch { /* ignore */ }
      try {
        const p = localStorage.getItem(LS_PLACEMENT);
        if (p === "dock" || p === "floating") setState({ barPlacement: p });
      } catch { /* ignore */ }
      try {
        const bp = localStorage.getItem(LS_BAR_POS);
        if (bp) {
          const o = JSON.parse(bp);
          if (o && typeof o.x === "number" && typeof o.y === "number") setState({ barPos: o });
        }
      } catch { /* ignore */ }
      let cfg = null;
      try {
        const raw = localStorage.getItem(LS_CONFIG);
        if (raw) cfg = JSON.parse(raw);
      } catch { /* ignore */ }

      // 通知权限只**读**不申请（申请必须由用户手势触发，§7.2）
      setState({ notifyPerm: notifyPermission() });
      if (cfg && Array.isArray(cfg.indices)) setState({ config: cfg });
      try {
        const r = await api("/config");
        if (r && r.config) {
          // 兼容旧版 host：其不认识的可选字段（如 ma/alerts）会被丢弃，优先保留本地已有值
          const merged = Object.assign({}, r.config);
          if (!Array.isArray(merged.ma) && cfg && Array.isArray(cfg.ma)) merged.ma = cfg.ma;
          // 老 Host 的白名单重建会吃掉 alerts（与当年 ma 被吃同一个坑）：
          // 本地有规则而回包没有 → 保留本地，避免 UI 上规则凭空消失
          if (!Array.isArray(merged.alerts) && cfg && Array.isArray(cfg.alerts)) merged.alerts = cfg.alerts;
          // 同上：老 Host 吃掉 pausedMarkets（市场开关）时保留本地选择
          if (!Array.isArray(merged.pausedMarkets) && cfg && Array.isArray(cfg.pausedMarkets)) merged.pausedMarkets = cfg.pausedMarkets;
          setState({ config: merged });
          try { localStorage.setItem(LS_CONFIG, JSON.stringify(merged)); } catch { /* ignore */ }
        }
        if (Array.isArray(r.quotes)) {
          const quotes = Object.assign({}, state.quotes);
          for (const row of r.quotes) quotes[row.code] = row;
          setState({ quotes, updatedAt: r.updatedAt || Date.now() });
        }
        if (r && r.warning) {
          // 配置文件损坏：明确告知，不要静默吞掉用户的持仓数据
          configWarning(r.warning);
        }
      } catch { /* host 不可达：用本地缓存 */ }
      startPolling();
      refreshAlerts(); // 首屏补一次规则状态（不等 alert-stream 连上）
      openAlertStream(); // 预警通道与行情通道独立：隐藏不断，重连先对账
    }

    // 配置操作 helpers
    function cfgFind(list, code) {
      return list.find((x) => x.code === code);
    }
    function addIndex(item) {
      updateConfig((cfg) => {
        if (cfgFind(cfg.indices, item.code)) {
          toast("该指数已在列表中");
          return null;
        }
        cfg.indices.push({ code: item.code, name: item.name || displayCode(item.code) });
        return cfg;
      });
    }
    function removeIndex(code) {
      updateConfig((cfg) => {
        cfg.indices = cfg.indices.filter((x) => x.code !== code);
        cfg.barIndices = cfg.barIndices.filter((x) => x !== code);
        return cfg;
      });
    }
    function toggleMa(period) {
      // MA 选择全局通用：写回配置，跨股票/周期/会话保持
      updateConfig((c) => {
        const cur = Array.isArray(c.ma) ? c.ma.slice() : [5, 10, 20];
        const i = cur.indexOf(period);
        if (i >= 0) cur.splice(i, 1);
        else cur.push(period);
        c.ma = MA_ALL.filter((p) => cur.indexOf(p) >= 0); // 固定顺序
        return c;
      });
    }
    function toggleBarIndex(code) {
      updateConfig((cfg) => {
        const i = cfg.barIndices.indexOf(code);
        if (i >= 0) cfg.barIndices.splice(i, 1);
        else {
          if (cfg.barIndices.length >= 8) {
            toast("指数栏最多显示 8 个");
            return null;
          }
          cfg.barIndices.push(code);
        }
        return cfg;
      });
    }
    /** 通用重排（拖动排序）：把 cfg[key] 列表第 from 项移动到 to 位置 */
    function reorderList(key, from, to) {
      updateConfig((cfg) => {
        const arr = cfg[key];
        if (!Array.isArray(arr) || from < 0 || from >= arr.length) return null;
        const [item] = arr.splice(from, 1);
        arr.splice(Math.max(0, Math.min(arr.length, to)), 0, item);
        return cfg;
      });
    }
    /** 拖动排序后短暂抑制 click（跨浏览器：pointer capture 释放后 click 目标不确定） */
    let slDragStamp = 0;
    function justDragged() {
      return Date.now() - slDragStamp < 250;
    }
    /**
     * 左键拖动排序 hook：listRef 指向包含各行的容器（每行带 data-sl-idx）。
     * 返回 { drag, startDrag }；drag={from,overAt} 用于渲染落点指示线，startDrag(index,e) 挂到行手柄。
     */
    function useDragReorder(listRef, commit) {
      const [drag, setDrag] = useState(null);
      const dragRef = useRef(null);
      const commitRef = useRef(commit);
      commitRef.current = commit;
      const dragging = !!drag;
      const startDrag = (index, e) => {
        if (e.button !== undefined && e.button !== 0) return; // 仅左键
        dragRef.current = { from: index, overAt: index, moved: false };
        setDrag({ from: index, overAt: index });
        e.preventDefault();
        // 指针捕获：后续 move/up 重定向到手柄，事件仍冒泡到 window 监听
        try { if (e.currentTarget && e.currentTarget.setPointerCapture && e.pointerId !== undefined) e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      };
      useEffect(() => {
        if (!dragging) return undefined;
        const onMove = (ev) => {
          const d = dragRef.current;
          const container = listRef.current;
          if (!d || !container) return;
          const rows = Array.prototype.slice.call(container.querySelectorAll("[data-sl-idx]"));
          let overAt = d.from;
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i].getBoundingClientRect();
            if (ev.clientY < r.top + r.height / 2) { overAt = i; break; }
            overAt = i + 1;
          }
          if (overAt !== d.from) d.moved = true;
          if (overAt !== d.overAt) { d.overAt = overAt; setDrag({ from: d.from, overAt: overAt }); }
        };
        const onUp = () => {
          const d = dragRef.current;
          dragRef.current = null;
          setDrag(null);
          if (!d) return;
          slDragStamp = Date.now(); // 抑制紧随的 click（避免误开详情）
          let to = d.overAt;
          if (to > d.from) to -= 1; // 移除自身后目标位前移
          if (to !== d.from) commitRef.current(d.from, to);
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
      return { drag, startDrag };
    }
    /** 落点指示线（在行之间） */
    function DropLine() {
      return h("div", { className: "sl-dropline" });
    }

    /** 列表超过该行数时，内部出现滚动条（表头与搜索框留在视野内） */
    const MAX_VISIBLE_ROWS = 10;

    /**
     * 给可排序列表加「最多显示 MAX_VISIBLE_ROWS 行」的上限。
     *
     * 上限按**实测行高**算，而不是写死像素：大盘行是两行式名称（名称+代码），
     * 自选行更矮，写死常量会在其中一种布局下多露半行或提前截断。
     *
     * 行高取前若干行的**最小值**：持仓行展开后会多出交易面板，比收起时高得多，
     * 若恰好用第一行（可能正展开着）当基准，上限会被撑成一大截，等于没限制。
     *
     * 行数不足上限时返回 null，不加 class，让容器自然撑开
     * （否则会出现"能滚但没内容"的空滚动条）。
     *
     * 用 ResizeObserver 跟踪：窗口缩放会改变字号进而改变行高，只测一次会失准。
     */
    function useListCap(listRef, count) {
      const [cap, setCap] = useState(null);
      useEffect(() => {
        const el = listRef.current;
        if (!el) return undefined;
        const measure = () => {
          if (count <= MAX_VISIBLE_ROWS) { setCap(null); return; }
          const rows = el.querySelectorAll("[data-sl-idx]");
          let rowH = 0;
          const n = Math.min(rows.length, 12);
          for (let i = 0; i < n; i++) {
            const h = rows[i].getBoundingClientRect().height;
            // 测试环境与首帧可能量不到高度，量不到就保持现状，等下一轮
            if (h > 0 && (rowH === 0 || h < rowH)) rowH = h;
          }
          if (!rowH) return;
          setCap(Math.round(rowH * MAX_VISIBLE_ROWS) + 1);
        };
        measure();
        let ro = null;
        try {
          if (typeof ResizeObserver === "function") {
            ro = new ResizeObserver(measure);
            ro.observe(el);
          }
        } catch { /* 老浏览器无 ResizeObserver，量一次也够用 */ }
        return () => { if (ro) ro.disconnect(); };
      }, [listRef, count]);
      return cap;
    }
