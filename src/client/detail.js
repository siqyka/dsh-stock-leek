    function useConversationRect(active) {
      const [rect, setRect] = useState(null);
      useEffect(() => {
        if (!active) return undefined;
        let alive = true;
        let last = null;
        const measure = () => {
          if (!alive) return;
          let next = null;
          const seat = document.querySelector("[data-composer-seat]")
            || document.querySelector('[data-conversation-region="composer"]');
          if (seat) {
            // composer 往上找 1~2 层即对话面板容器。
            // ⚠️ 曾爬 3 层：容易越过对话面板爬到侧边栏/应用根容器，
            // 那样"对话区内居中"的基准就偏了，弹窗看着不在中间（实测反馈）。
            // 这里取更保守的 2 层，并对几何做合理性检查（宽度应显著小于视口）。
            let box = seat;
            for (let i = 0; i < 2 && box && box.parentElement; i++) box = box.parentElement;
            const r = box.getBoundingClientRect();
            if (r.width > 200 && r.height > 120 && r.width <= window.innerWidth) {
              next = { left: r.left, top: r.top, width: r.width, height: r.height };
            }
          }
          if (!next) {
            // 回退：**视口居中**（与主路径的居中语义一致）。
            // ⚠️ 这里曾遗留「贴左」（left: 24）——它是"贴左对齐"那版的产物，
            // 用户改回居中后仍留着，导致探测不到 composer seat 时弹窗跑偏到
            // 屏幕左边、看着完全不在中间（实测反馈「中间的没有看到」）。
            // 两条路径必须给出一致的视觉位置。
            const w = Math.min(520, Math.max(200, window.innerWidth - 64));
            next = { left: Math.round((window.innerWidth - w) / 2), top: 72, width: w, height: window.innerHeight - 160 };
          }
          // 诊断钩子：浏览器控制台可查「弹窗实际用的几何 + 是否走了回退」。
          // 排查「弹窗不在中间」这类问题时，比猜宿主 DOM 结构快得多：
          //   __sl_conv_rect__   → { left, top, width, height, fallback }
          globalThis.__sl_conv_rect__ = Object.assign({}, next, { fallback: !seat, vw: window.innerWidth, vh: window.innerHeight });
          if (!last || Math.abs(next.left - last.left) > 1 || Math.abs(next.top - last.top) > 1 || Math.abs(next.width - last.width) > 1) {
            last = next;
            setRect(next);
          }
        };
        measure();
        const iv = setInterval(measure, 500);
        window.addEventListener("resize", measure);
        return () => {
          alive = false;
          clearInterval(iv);
          window.removeEventListener("resize", measure);
        };
      }, [active]);
      return rect;
    }

    const ALERT_POPUP_MS = 10000;
    function AlertPopup() {
      const s = useStore();
      const list = s.alertPopups || [];
      // hook 必须无条件在顶层调用（有弹窗时才需要测量 → 用 active 参数控制内部行为）
      const convRect = useConversationRect(list.length > 0);
      // 已到期的自动关闭：只在可见时推进（隐藏时把剩余时间冻结）
      useEffect(() => {
        if (!list.length) return undefined;
        if (typeof document !== "undefined" && document.hidden) return undefined;
        const started = Date.now();
        // 每条各自计自己的剩余时间：新弹的不会因为旧的在倒计时而被提前清掉
        const timers = list.map((ev) => {
          const age = Date.now() - (Number(ev.shownAt) || started);
          const left = Math.max(0, ALERT_POPUP_MS - age);
          return setTimeout(() => dismissAlertPopup(ev.id), left);
        });
        return () => { for (const t of timers) clearTimeout(t); };
      }, [list.map((x) => x.id).join(","), s.visibleTick]);
      useEffect(() => {
        if (!list.length) return undefined;
        // Escape 关闭最上面一条（与其它弹层习惯一致）
        const onKey = (e) => { if (e.key === "Escape") dismissAlertPopup(list[list.length - 1].id); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [list.length]);
      if (!list.length) return null;
      // 定位：**对话区顶部居中**（用户指定回到 29d4fcf 那版的观感）。
      //   - 探测到对话区：在对话区内水平居中、贴其顶部
      //   - 探测不到：视口居中（translateX(-50%)，与 29d4fcf 回退一致）
      //
      // ⚠️ 相对 29d4fcf 的唯一加强：坐标仍**钳进视口**。那版没钳制，
      // 窗口缩小时弹窗会跑到可视区外（用户实测「全屏可见、缩小就消失」）。
      // 居中语义不变，只是把结果夹在可视范围内。
      const vw = (typeof window !== "undefined" && window.innerWidth) || 1024;
      const vh = (typeof window !== "undefined" && window.innerHeight) || 768;
      const conv = convRect;
      // 宽度：优先贴合对话区（上限 560），并夹进视口
      const wantW = conv ? Math.min(560, Math.max(240, conv.width - 48)) : 360;
      const boxW = Math.round(Math.max(200, Math.min(wantW, vw - 32)));
      // 顶部：贴对话区顶部（回退 72）
      const wantTop = conv ? conv.top + 12 : 72;
      const top = Math.round(Math.max(8, Math.min(wantTop, Math.max(8, vh - 120))));
      let style;
      if (conv) {
        // 对话区内居中
        const centered = Math.round(conv.left + (conv.width - boxW) / 2);
        const left = Math.round(Math.max(8, Math.min(centered, vw - boxW - 8)));
        style = {
          position: "fixed", left, top, width: boxW, zIndex: 10005,
          display: "flex", flexDirection: "column", gap: 8, pointerEvents: "auto",
          maxHeight: Math.round(Math.min(Math.max(120, conv.height - 32), vh - top - 16)), overflowY: "auto",
        };
      } else {
        // 回退：视口居中（与 29d4fcf 一致），宽度按视口夹紧避免越界
        style = {
          position: "fixed", left: "50%", transform: "translateX(-50%)", top, width: boxW, zIndex: 10005,
          display: "flex", flexDirection: "column", gap: 8, pointerEvents: "auto",
          maxHeight: Math.round(Math.max(160, vh - top - 24)), overflowY: "auto",
        };
      }
      return h("div", {
        className: "sl-root sl-theme-" + s.theme + (s.theme === "light" ? " sl-light" : ""),
        style,
      },
        list.map((ev) => h("div", {
          key: ev.id,
          className: "sl-alert-pop",
          role: "alert",
          "data-sltip": "点击进入预警设置；10 秒后自动消失，也可点 ✕ 立即关闭\n同一规则每个交易日只提示一次，次日符合条件时会再提示",
          onClick: () => { openAlertPanel(); },
        },
          h("div", { className: "sl-alert-pop-head" },
            h("span", { className: "sl-alert-pop-title" }, "🔔 预警 · " + ev.name),
            // 叠加计数：本条卡片承载了多少条溢出预警（最多展示 3 条，多余叠到最早那条）
            Number(ev.overflow) > 0
              ? h("span", {
                  className: "sl-alert-pop-more",
                  "data-sltip": "另有 " + ev.overflow + " 条预警被合并到这条（同时最多展示 3 条）",
                }, "+" + ev.overflow)
              : null,
            h("button", {
              className: "sl-x",
              "data-sltip": "立即关闭（不必等 10 秒）",
              onClick: (e) => { e.stopPropagation(); dismissAlertPopup(ev.id); },
            }, "✕")),
          h("div", { className: "sl-alert-pop-row sl-alert-pop-main" },
            h("span", { className: "sl-alert-pop-cond" }, alertRuleText(ev)),
            h("span", { className: "sl-alert-pop-val" }, fmtPrice(ev.price)),
            Number.isFinite(Number(ev.percent))
              ? h("span", { className: Number(ev.percent) > 0 ? "sl-up" : Number(ev.percent) < 0 ? "sl-down" : "sl-flat" }, fmtPct(ev.percent))
              : null,
            h("span", { className: "sl-alert-pop-time" },
              new Date(Number(ev.at) || Date.now()).toLocaleTimeString("zh-CN", { hour12: false }))),
          // 倒计时进度条：让"还剩多久"可见，避免用户以为它会一直留着
          h("div", { className: "sl-alert-pop-bar", style: { animationDuration: ALERT_POPUP_MS + "ms" } }),
        )),
        list.length > 1 || list.some((x) => Number(x.overflow) > 0)
          ? h("button", {
              className: "sl-btn sl-btn-ghost",
              "data-sltip": "关闭全部预警弹窗（含被合并的条数）",
              onClick: () => dismissAllAlertPopups(),
            }, "全部关闭（" + list.reduce((n, x) => n + 1 + (Number(x.overflow) || 0), 0) + "）")
          : null,
      );
    }

    // ================================================================ 视图：个股详情
    function DetailView(props) {
      const s = useStore();
      const { code, name } = props.detail;
      const [period, setPeriod] = useState("minute");
      const [minute, setMinute] = useState(null);
      const [kline, setKline] = useState(null);
      const [candle, setCandle] = useState(null); // K线中选中/钉住的那一根（顶部指标区显示其信息）
      const cfg = s.config;
      // MA 选择存于全局配置 cfg.ma（跨股票/周期/会话保持）
      const maList = Array.isArray(cfg && cfg.ma) ? cfg.ma : MA_DEF;
      const maOn = {};
      for (const p of MA_ALL) maOn[p] = maList.indexOf(p) >= 0;
      const pos = cfg ? cfgFind(cfg.positions, code) : null; // 当前股票的持仓（用于成本线）
      const q = s.quotes[code];
      /**
       * K 线刷新用 tick：与盈亏曲线同一套 `curveRefreshTick`（按 pollMs 分桶）。
       *
       * 为什么必须让 K 线跟着行情走：原来 effect 只依赖 `[code, period]`，
       * 也就是**切到日K 拉一次就再也不更新**。于是盘前打开日K 的人会一直看到
       * 「最后一根是昨天」——盘中今天那根永远不出现（用户报的正是这个）。
       * 日K 缓存也有 60s TTL，但光靠它不够：不重新发请求就永远拿不到新的。
       */
      const curPollMs = cfg && Number.isFinite(cfg.pollMs) ? cfg.pollMs : 5000;
      const klineTick = curveRefreshTick(s.updatedAt, curPollMs);
      useEffect(() => {
        let alive = true;
        // 只有切股票/切周期时才清空并显示"加载中"；单纯因 tick 重拉时**保留旧图**，
        // 否则每次刷新都会闪一下空白（盘中每几秒闪一次非常难看）。
        if (period === "minute") {
          setMinute(null); setCandle(null);
          api("/minute", { code }).then((r) => { if (alive) setMinute(r); }).catch(() => { if (alive) setMinute({ points: [], error: "获取失败" }); });
        } else {
          setKline(null); setCandle(null);
          api("/kline", { code, period, count: 120 }).then((r) => { if (alive) setKline(r); }).catch(() => { if (alive) setKline({ candles: [], error: "获取失败" }); });
        }
        return () => { alive = false; };
      }, [code, period]);
      // 单独的「静默刷新」effect：跟随 tick 重拉，**不清空**当前图（不闪）
      // 依赖里带上 code/period：否则切股票后闭包还拿着旧 code，
      // 会把上一只票的数据写进当前视图（tick 恰好没变时就会发生）。
      useEffect(() => {
        let alive = true;
        // 守卫写在体内（不用 `if (!klineTick) return undefined` 提前返回）：
        // 提前返回会让这个 effect 不注册 cleanup，容易和别的 effect 槽位混淆。
        if (klineTick) {
          const isMin = period === "minute";
          const done = (r) => {
            if (!alive || !r) return;
            if (isMin) { if (Array.isArray(r.points)) setMinute(r); }
            else if (Array.isArray(r.candles)) setKline(r);
          };
          if (isMin) {
            api("/minute", { code }).then(done).catch(() => {});
          } else {
            api("/kline", { code, period, count: 120 }).then(done).catch(() => {});
          }
        }
        return () => { alive = false; };
      }, [klineTick, code, period]);
      const col = q ? (q.percent > 0 ? "var(--sl-up)" : q.percent < 0 ? "var(--sl-down)" : "var(--sl-flat)") : "var(--sl-flat)";
      const chart =
        period === "minute"
          ? minute === null
            ? h("div", { className: "sl-empty" }, "分时加载中…")
            : h(MinuteChart, { points: minute.points, prevClose: minute.prevClose, color: col, height: 180 })
          : kline === null
            ? h("div", { className: "sl-empty" }, "K线加载中…")
            : h(KlineChart, { candles: kline.candles, error: kline.error, symbol: code, period: period, height: 200, riseColor: cfg ? cfg.riseColor : null, fallColor: cfg ? cfg.fallColor : null, ma: maList, cost: pos ? pos.cost || null : null, onCandle: setCandle });
      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", minHeight: 0 } },
        h("div", { className: "sl-dhead" },
          h("div", { className: "sl-dtop" },
            h("button", { className: "sl-back", onClick: () => setState({ detail: null }) }, "← 返回"),
            h("span", { className: "sl-dname" }, (q && q.name) || name || displayCode(code)),
            h("span", { style: { color: "var(--sl-muted)" } }, displayCode(code)),
            h("span", { style: { flex: 1 } }),
            pos && pos.cost
              ? h("span", {
                  className: "sl-cost-badge",
                  style: { color: q && q.price >= pos.cost ? "var(--sl-up)" : "var(--sl-down)" },
                  "data-sltip": "持仓成本 " + fmtPrice(pos.cost) + "（" + pos.qty + " 股）\nK 线图中的虚线即成本价，现价在其下方时变红",
                }, "成本 " + fmtPrice(pos.cost))
              : null,
            h("span", { className: "sl-dprice", style: { color: col } }, q ? fmtPrice(q.price) : "--"),
            h("span", { style: { color: col, fontWeight: 600 } }, q ? fmtPct(q.percent) : "")),
          // 顶部指标区：选中 K 线时显示该根信息，否则显示当日行情
          h("div", { className: "sl-stats" },
            candle
              ? [
                  ["日期", candle.time],
                  ["开", fmtPrice(candle.open)], ["高", fmtPrice(candle.high)],
                  ["低", fmtPrice(candle.low)], ["收", fmtPrice(candle.close)],
                  ["涨跌", (candle.chg >= 0 ? "+" : "") + fmtPrice(candle.chg)],
                  ["幅", candle.chgPct !== null ? fmtPct(candle.chgPct) : "—"],
                  ["量", fmtQty(candle.volume, code)],
                  candle.amp !== null ? ["振幅", fmtPct(candle.amp)] : null,
                ].filter(Boolean).map(([k, v]) => h("span", { key: k }, k + " ", h("b", { style: k === "涨跌" || k === "幅" ? { color: candle.close >= candle.open ? "var(--sl-up)" : "var(--sl-down)" } : null }, v)))
              : q
                ? [
                    ["今开", fmtPrice(q.open)], ["昨收", fmtPrice(q.yestclose)], ["最高", fmtPrice(q.high)], ["最低", fmtPrice(q.low)],
                    ["成交", fmtQty(q.volume, code)], ["金额", fmtMoney(q.amount, code)],
                    q.turnover !== null && q.turnover !== undefined ? ["换手", q.turnover + "%"] : null,
                    q.pe ? ["PE", q.pe] : null, q.pb ? ["PB", q.pb] : null,
                  ].filter(Boolean).map(([k, v]) => h("span", { key: k }, k + " ", h("b", null, v)))
                : h("span", null, "行情获取中…"),
            h("span", { style: { width: "100%" } }, candle ? "已选中该根 K 线 · 双击图表或点击空白处取消" : "更新时间：" + fmtTime(q && q.time)),
          ),
          h("div", { className: "sl-tabs", style: { padding: "2px 0" } },
            [["minute", "分时"], ["day", "日K"], ["week", "周K"], ["month", "月K"]].map(([p, t]) =>
              h("button", { key: p, className: "sl-tab" + (period === p ? " sl-tab-on" : ""), onClick: () => setPeriod(p) }, t)),
            period !== "minute"
              ? h("span", { style: { display: "inline-flex", gap: 2, marginLeft: "auto" } },
                  [5, 10, 20, 60].map((p) =>
                    h("button", { key: p, className: "sl-tab" + (maOn[p] ? " sl-tab-on" : ""), style: { padding: "1px 6px", fontSize: 10 }, onClick: () => toggleMa(p) }, "MA" + p)))
              : null),
        ),
        h("div", { className: "sl-chartbox" }, chart),
        // 五档盘口：跟行情快照一起来，不额外请求；放在图下方，避免挤压 K 线主视图
        h(OrderBook, { q, cfg }),
      );
    }

    /**
     * 五档买卖盘（Order Book）。
     *
     * 数据来自行情快照本身的 `q.book`（腾讯同一份响应里就有买一~买五/卖一~卖五），
     * 不额外发请求，跟随现有刷新间隔一起更新。
     *
     * **集合竞价时段（9:15–9:25 / 14:57–15:00）没有真实盘口**：沪深两市在竞价阶段
     * 不披露委托明细，腾讯这时给的是「虚拟匹配价 + 可匹配量」，表现为买一与卖一
     * **同价同量、且只有一档**（实测 09:21 的 sh600519：买卖都只有 1320.97×68）。
     * 直接照着画会让人误以为是真实挂单簿，所以这种形态改标成「集合竞价」并只显示
     * 这一行匹配价/匹配量 —— 说清楚它是什么，比画一格假盘口有用。
     */
    function OrderBook(props) {
      const q = props.q;
      const book = q && q.book;
      /**
       * 布局 / 挂单量口径都存进全局配置（cfg.bookLayout / cfg.bookUnit），
       * 所以切一次就跨股票、跨重开保持。与 pnlCurve 同一套做法：
       * 读走 cfg（带默认值兜底），写走 updateConfig（会落盘 + 跨标签页广播）。
       *
       * 必须只存在配置里、**不要再用本地 useState**：
       * 两处状态并存时，配置回填会把本地值覆盖掉，表现为"点了按钮又弹回去"。
       */
      const cfgNow = (props.cfg) || {};
      const unit = cfgNow.bookUnit === "amount" ? "amount" : "lots";
      const layout = cfgNow.bookLayout === "rows" ? "rows" : "cols";
      const setUnit = (v) => updateConfig((c) => { c.bookUnit = v; return c; });
      const setLayout = (v) => updateConfig((c) => { c.bookLayout = v; return c; });
      if (!book || ((book.bids || []).length === 0 && (book.asks || []).length === 0)) {
        return h("div", { className: "sl-empty", style: { padding: "6px 8px" } }, "该股暂无五档盘口数据（停牌、集合竞价前，或港美股不提供）");
      }
      const bids = book.bids || [];
      const asks = book.asks || [];
      /**
       * 是否处于「集合竞价」形态。lib/shared.js 的内联副本，两端由 drift 对拍。
       *
       * 判据：只有一档 + 买卖同价同量 + 今开仍为 0。
       * 竞价阶段交易所不披露委托明细，腾讯给的是虚拟匹配价 + 可匹配量
       * （实测 09:21 的 sh600519：买卖都只有 1320.97×68、今开 0.00）。
       * 今开的排除条件用来避开盘中恰好同价同量的巧合。
       */
      function isAuctionBook(book, open) {
        const bs = (book && book.bids) || [];
        const as = (book && book.asks) || [];
        if (bs.length !== 1 || as.length !== 1) return false;
        if (bs[0].price !== as[0].price) return false;
        if (bs[0].qty !== as[0].qty) return false;
        return !(Number(open) > 0);
      }
      const isAuction = isAuctionBook(book, q.open);
      const amountOf = (x) => x.price * x.qty;
      // 横条基准：按当前展示口径取最大值，切换单位时条长也一起变
      const metric = (x) => (unit === "lots" ? x.qty / 100 : amountOf(x));
      const maxMetric = Math.max(1, ...bids.map(metric), ...asks.map(metric));
      // 委比 = (买量 − 卖量) / (买量 + 卖量)，始终按股数算（金额受价格影响，不适合做委比）
      const sumB = bids.reduce((a, x) => a + x.qty, 0);
      const sumA = asks.reduce((a, x) => a + x.qty, 0);
      const ratio = sumB + sumA > 0 ? ((sumB - sumA) / (sumB + sumA)) * 100 : null;
      /** 单档显示值：手数按「N手」（1手=100股）；金额按万/亿。 */
      const valText = (x) => (unit === "lots" ? Math.round(x.qty / 100) + "手" : fmtMoney(amountOf(x), ""));
      const valTip = (x, side, lv) =>
        (side === "bid" ? "买" : "卖") + lv + "  " + fmtPrice(x.price) +
        "\n" + x.qty + " 股（" + Math.round(x.qty / 100) + " 手）" +
        "\n金额 " + fmtExact(amountOf(x)) + " 元";
      const bar = (x) => h("span", { className: "sl-ob-bar" }, h("i", { style: { width: Math.max(2, Math.round((metric(x) / maxMetric) * 100)) + "%" } }));
      const row = (side, lv, x) => {
        const isBid = side === "bid";
        return h("div", {
          key: side + lv,
          className: "sl-ob-row " + (isBid ? "sl-ob-bid" : "sl-ob-ask"),
          "data-sltip": valTip(x, side, lv),
        },
          h("span", { className: "sl-ob-lv" }, lv),
          h("span", { className: "sl-ob-price" }, fmtPrice(x.price)),
          h("span", { className: "sl-ob-qty" }, valText(x)),
          bar(x));
      };
      const pad = (arr, n) => (arr.length >= n ? arr : arr.concat(Array.from({ length: n - arr.length }, (_, i) => h("div", { key: "pad" + i, className: "sl-ob-row sl-ob-pad" }))));
      const head = h("div", { className: "sl-ob-head" },
        h("span", null, "五档盘口"),
        h("span", { style: { flex: 1 } }),
        // 布局切换：左右 / 上下
        h("span", { className: "sl-ob-unit" },
          [["cols", "左右"], ["rows", "上下"]].map(([v, t]) =>
            h("button", {
              key: v,
              className: layout === v ? "on" : "",
              "data-sltip": v === "cols" ? "左右结构：卖盘在左、买盘在右" : "上下结构：卖5→卖1 在上、现价居中、买1→买5 在下（券商软件惯例）",
              onClick: () => setLayout(v),
            }, t))),
        // 单位切换：手数 / 金额
        h("span", { className: "sl-ob-unit" },
          [["lots", "手数"], ["amount", "金额"]].map(([v, t]) =>
            h("button", {
              key: v,
              className: unit === v ? "on" : "",
              "data-sltip": v === "lots" ? "按手数显示（1 手 = 100 股）" : "按挂单金额显示（价格 × 股数）",
              onClick: () => setUnit(v),
            }, t))),
        ratio !== null
          ? h("span", {
              className: "sl-ob-ratio " + (ratio > 0 ? "sl-up" : ratio < 0 ? "sl-down" : "sl-flat"),
              "data-sltip": "委比 = (买五档总量 − 卖五档总量) ÷ 两者之和\n买 " + sumB + " 股 / 卖 " + sumA + " 股",
            }, "委比 " + (ratio > 0 ? "+" : "") + ratio.toFixed(1) + "%")
          : null);

      // **集合竞价**：没有真实盘口，只说清楚"虚拟匹配价 + 可匹配量"是什么。
      // 画成买一/卖一各一行同价同量会让人误以为是真实挂单簿（实测就是这么返回的）。
      if (isAuction) {
        const m = bids[0];
        return h("div", { className: "sl-ob sl-ob-auction" },
          head,
          h("div", {
            className: "sl-ob-auction-row",
            "data-sltip": "集合竞价阶段（9:15–9:25 / 14:57–15:00）交易所不披露委托明细。\n"
              + "这里显示的是腾讯给出的**虚拟匹配价**与**可匹配量**，不是真实挂单簿。",
          },
            h("span", { className: "sl-ob-auction-tag" }, "集合竞价"),
            h("span", { className: "sl-ob-auction-px" }, fmtPrice(m.price)),
            h("span", { className: "sl-ob-auction-qty" }, unit === "lots" ? Math.round(m.qty / 100) + "手" : fmtMoney(amountOf(m), "")),
            h("span", { style: { flex: 1 } }),
            h("span", { className: "sl-ob-auction-hint" }, "虚拟匹配价 · 非真实挂单")),
          h("div", { className: "sl-ob-auction-note" }, "开盘后自动切换为五档盘口"));
      }

      if (layout === "rows") {
        // **上下结构**（券商软件惯例）：卖5→卖1 在上、现价居中、买1→买5 在下。
        // 注意这里卖盘要**倒序**（卖5 在顶），与左右结构的卖1 在顶正好相反 ——
        // 因为上下结构讲究"价格向中间收敛"：上半部价高在下、下半部价低在上。
        const askRows = asks.map((x, i) => row("ask", "卖" + (i + 1), x)).reverse();
        const bidRows = bids.map((x, i) => row("bid", "买" + (i + 1), x));
        return h("div", { className: "sl-ob sl-ob-rows" },
          head,
          h("div", { className: "sl-ob-stack sl-ob-stack-ask" }, pad(askRows, 5)),
          h("div", { className: "sl-ob-mid" },
            h("span", null, "现价"),
            h("b", { style: { color: q.percent > 0 ? "var(--sl-up)" : q.percent < 0 ? "var(--sl-down)" : "var(--sl-flat)" } }, fmtPrice(q.price))),
          h("div", { className: "sl-ob-stack sl-ob-stack-bid" }, pad(bidRows, 5)));
      }
      // **左右结构**（默认）：卖盘在左、买盘在右，两列都从贴近现价的一档往下排
      const askRows = asks.map((x, i) => row("ask", "卖" + (i + 1), x));
      const bidRows = bids.map((x, i) => row("bid", "买" + (i + 1), x));
      return h("div", { className: "sl-ob sl-ob-cols-layout" },
        head,
        h("div", { className: "sl-ob-cols" },
          h("span", { className: "sl-ob-colhead sl-ob-t-ask" }, "卖盘"),
          h("span", { className: "sl-ob-colhead sl-ob-t-bid" }, "买盘")),
        h("div", { className: "sl-ob-body" },
          h("div", { className: "sl-ob-side sl-ob-side-ask" }, pad(askRows, 5)),
          h("div", { className: "sl-ob-side sl-ob-side-bid" }, pad(bidRows, 5))));
    }

    /**
     * 标题栏数据新鲜度徽标：显示「距上次成功拿到行情已过去多久」。
     * - 语义是正计时（越大越旧），不是倒计时；上限约等于设置的刷新间隔 pollMs。
     * - 自带 1s ticker 驱动自身重渲染，避免数字僵住不动（旧实现只在别的状态变化时才重算）。
     * - 只在悬浮窗打开时挂载（Overlay 里 s.open 为真才渲染），面板关闭后不留空转定时器。
     * - updatedAt 为 0（从未拿到数据）时显示 —，避免 Date.now()-0 算出天文数字。
     */
