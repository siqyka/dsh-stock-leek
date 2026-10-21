    function SettingsView() {
      const s = useStore();
      const cfg = s.config;
      const [probe, setProbe] = useState(null);
      const [probing, setProbing] = useState(false);
      if (!cfg) return h("div", { className: "sl-empty" }, "加载中…");
      const seg = (label, options, value, onChange) =>
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel" }, label),
          h("span", { className: "sl-seg" }, options.map(([v, t]) =>
            h("button", { key: v, className: v === value ? "on" : "", onClick: () => onChange(v) }, t))));
      return h(
        "div",
        { className: "sl-set" },
        // 配置损坏告警：常驻顶部，不随 toast 消失
        s.configWarning
          ? h("div", { className: "sl-warn" },
              h("span", { style: { flex: 1, minWidth: 0 } }, "⚠ " + s.configWarning.text),
              h("button", { className: "sl-x", "data-sltip": "我已知晓并要处理（关闭该提示）", onClick: () => dismissConfigWarning() }, "✕"))
          : null,
        seg("对话左下角指数栏", [["on", "显示"], ["off", "隐藏"]], cfg.barVisible ? "on" : "off",
          (v) => updateConfig((c) => { c.barVisible = v === "on"; return c; })),
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel" }, "放置方式"),
          h("span", { className: "sl-seg" }, [
            ["floating", "悬浮锚定", "悬浮锚定：自动跟随对话输入区左下角，新会话页与已有对话都显示。"],
            ["dock", "嵌入输入框", "嵌入输入框：作为平台 composer.dock 槽位内容，仅在「已有对话」显示（新会话页该槽位宿主不渲染，属平台限制）。"],
          ].map(([v, t, tip]) =>
            h("button", { key: v, className: s.barPlacement === v ? "on" : "", "data-sltip": tip, onClick: () => setBarPlacement(v) }, t)))),
        seg("指数栏样式", [["full", "点位+涨跌"], ["compact", "仅涨跌幅"]], cfg.barStyle,
          (v) => updateConfig((c) => { c.barStyle = v; return c; })),
        seg("指数栏位置", [["left", "居左"], ["center", "居中"], ["right", "居右"]], cfg.barAlign,
          (v) => updateConfig((c) => { c.barAlign = v; return c; })),
        seg("刷新间隔", [[3000, "3s"], [5000, "5s"], [10000, "10s"], [30000, "30s"], [60000, "60s"]], cfg.pollMs,
          (v) => updateConfig((c) => { c.pollMs = v; return c; })),
        // 自动刷新市场（**多选**）：关掉的市场不刷行情、不评估预警、指数栏不因它展开。
        // 「已收盘自动停」按各市场的交易时段判定；这里的开关是叠加在其上的总闸。
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel", "data-sltip": "关闭的市场：不刷新行情、不评估预警\n指数栏也不因它展开。收盘的市场自动停（无需开关）" }, "自动刷新市场"),
          h("span", { className: "sl-seg" },
            [["cn", "A股"], ["hk", "港股"], ["us", "美股"]].map(([k, label]) => {
              const paused = ((cfg.pausedMarkets) || []).includes(k);
              return h("button", {
                key: k,
                className: paused ? "" : "on",
                "data-sltip": paused
                  ? label + "已暂停：不刷新行情、不评估预警、指数栏不因它展开"
                  : label + "自动刷新：收盘后自动停",
                onClick: () => updateConfig((c) => {
                  const cur = Array.isArray(c.pausedMarkets) ? c.pausedMarkets.slice() : [];
                  c.pausedMarkets = paused ? cur.filter((x) => x !== k) : cur.concat([k]);
                  return c;
                }),
              }, label);
            }))),
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel" }, "涨色 / 跌色"),
          h("span", { style: { display: "flex", gap: 8, alignItems: "center" } },
            h("input", { className: "sl-color", type: "color", value: cfg.riseColor, onChange: (e) => updateConfig((c) => { c.riseColor = e.target.value; return c; }) }),
            h("input", { className: "sl-color", type: "color", value: cfg.fallColor, onChange: (e) => updateConfig((c) => { c.fallColor = e.target.value; return c; }) }))),
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel" }, "股票预警"),
          h("button", {
            className: "sl-btn",
            "data-sltip": "规则管理 / 桌面通知",
            onClick: () => openAlertPanel(),
          }, (() => {
            // 触发历史已去掉 → 没有「未读数」可算，改为显示规则条数。
            // 规则不再有启用/停用之分，所以这里就是纯粹的总数。
            const list = cfg.alerts || [];
            return list.length ? "🔔 预警（" + list.length + " 条）" : "🔔 预警";
          })())),
        h("div", { className: "sl-setrow" },
          h("button", {
            className: "sl-btn", disabled: probing,
            onClick: async () => {
              setProbing(true);
              try { setProbe(await api("/probe")); } catch (e) { setProbe({ ok: false, checks: [{ label: "请求失败", ok: false, detail: String(e.message || e) }] }); }
              setProbing(false);
            },
          }, probing ? "测试中…" : "🔌 测试数据源"),
          h("button", {
            className: "sl-btn sl-btn-ghost",
            onClick: () => { if (confirm("恢复默认配置？自选/持仓/预警将被清空。")) { localStorage.removeItem(LS_CONFIG); updateConfig(() => ({ version: 1, indices: [], barIndices: [], watchlist: [], positions: [], pollMs: 5000, riseColor: "#f5455c", fallColor: "#1eb980", barStyle: "full", barAlign: "left", barPlacement: "floating", barVisible: true, remind: true, alerts: [], pausedMarkets: [], pnlCurve: true })); } },
          }, "恢复默认")),
        probe
          ? h("div", { className: "sl-note" },
              probe.checks.map((c, i) => h("div", { key: i }, (c.ok ? "✓ " : "✗ ") + c.label + "（" + c.ms + "ms）： " + c.detail)),
              probe.configPath ? "配置文件：" + probe.configPath : "")
          : null,
      );
    }

    // ================================================================ 视图：预警
    function AlertView() {
      const s = useStore();
      const cfg = s.config;
      const [form, setForm] = useState({ code: "", type: "price_above", value: "" });
      const groupRef = useRef(null);
      // 规则按**组**封顶（一组=一只股票），与大盘/自选/持仓同一套 10 行上限。
      // 必须在 early return 之前调用（Hooks 规则），所以 count 用 cfg 安全取值。
      const alertGroups = groupAlerts(cfg && Array.isArray(cfg.alerts) ? cfg.alerts : []);
      const groupCap = useListCap(groupRef, alertGroups.length);
      if (!cfg) return h("div", { className: "sl-empty" }, "加载中…");
      const rules = Array.isArray(cfg.alerts) ? cfg.alerts : [];
      // 触发历史已按要求去掉（Host 不再落盘 events，界面也不再展示）
      const on = cfg.remind !== false; // 总开关
      // 可选代码：自选 + 持仓 + 指数候选（去重，保持用户熟悉的名字）
      const pool = [];
      const seen = new Set();
      for (const list of [cfg.positions, cfg.watchlist, cfg.indices]) {
        for (const x of list || []) {
          if (!x || seen.has(x.code)) continue;
          seen.add(x.code);
          pool.push({ code: x.code, name: x.name || displayCode(x.code) });
        }
      }
      const submit = () => {
        const code = String(form.code || "").trim();
        if (!code) { toast("请先选择或填写股票代码", "#ff5555"); return; }
        const isCost = form.type === "cost_above" || form.type === "cost_below";
        const raw = isCost ? 0 : Number(form.value);
        if (!isCost && (!Number.isFinite(raw) || raw <= 0)) { toast("阈值需为正数", "#ff5555"); return; }
        const hit = pool.find((p) => p.code === code);
        const ok = addAlert({ code, name: hit ? hit.name : displayCode(code), type: form.type, value: raw });
        if (ok) setForm({ code: "", type: form.type, value: "" });
      };
      return h(
        "div",
        { className: "sl-alert" },
        // 二级页返回头：预警不占 tab，从设置页进入（复用详情页的返回样式）
        h("div", { className: "sl-dhead" },
          h("div", { className: "sl-dtop" },
            h("button", { className: "sl-back", onClick: () => setState({ alertPanel: false }) }, "← 返回"),
            h("span", { className: "sl-dname" }, "🔔 预警"),
            h("span", { style: { flex: 1 } }),
            s.alertLive
              ? h("span", { style: { color: "var(--sl-muted)", fontSize: 10 }, "data-sltip": "预警通道已连接：隐藏页面也会保持（零上游请求），触发即推送" }, "通道已连接")
              : null)),
        // 总开关：关掉后规则保留但不评估（Host 侧同样以它为门）
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel" }, "预警总开关"),
          h("span", { className: "sl-seg" },
            h("button", {
              className: on ? "on" : "",
              "data-sltip": on ? "已开启：有规则就会评估" : "已关闭：规则保留但不评估",
              onClick: () => updateConfig((c) => { c.remind = !on; return c; }),
            }, on ? "已开启" : "已关闭"))),
        // 桌面通知：权限只在这里申请（用户手势），绝不在加载时弹框（§7.2）
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel" }, "桌面通知"),
          h("span", { style: { display: "flex", alignItems: "center", gap: 6 } },
            h("span", {
              className: "sl-alert-unit",
              "data-sltip": s.alertLive
                ? "预警通道已连接：隐藏页面也会保持（零上游请求），触发即推送"
                : "预警通道未连接：触发事件仍由 Host 记录，回到页面会自动对账补齐",
            }, s.alertLive ? "通道已连接" : "通道未连接"),
            h("button", {
              className: "sl-btn" + (s.notifyPerm === "granted" ? "" : " sl-btn-ghost"),
              "data-sltip": notifyPermission() === "unsupported"
                ? "当前环境没有 Notification（webview 常见）：历史与角标照常可用"
                : "点此申请系统通知权限（浏览器要求用户手势，所以不在加载时弹）",
              onClick: () => requestNotifyPermission(),
            }, s.notifyPerm === "granted" ? "通知已开启" : "开启桌面通知"))),
        // 新增规则：代码 + 类型 + 阈值
        h("div", { className: "sl-alert-add" },
          h("input", {
            className: "sl-input", placeholder: "代码/选择", value: form.code, list: "sl-alert-codes",
            onChange: (e) => setForm(Object.assign({}, form, { code: e.target.value })),
          }),
          h("datalist", { id: "sl-alert-codes" }, pool.slice(0, 60).map((p) => h("option", { key: p.code, value: p.code }, p.name))),
          h("select", {
            className: "sl-input sl-alert-type", value: form.type,
            onChange: (e) => setForm(Object.assign({}, form, { type: e.target.value })),
          }, Object.keys(ALERT_TYPE_LABEL).map((t) =>
            h("option", { key: t, value: t, disabled: t === "limit_near" && !/^(sh|sz|bj)/i.test(form.code) }, ALERT_TYPE_LABEL[t]))),
          form.type === "cost_above" || form.type === "cost_below"
            ? h("span", { className: "sl-alert-unit", "data-sltip": "成本类规则不需要阈值：以该股持仓成本价为判据" }, "成本价")
            : h("input", {
                className: "sl-input sl-alert-val", placeholder: "阈值", value: form.value,
                onChange: (e) => setForm(Object.assign({}, form, { value: e.target.value })),
              }),
          form.type === "cost_above" || form.type === "cost_below" ? null
            : h("span", { className: "sl-alert-unit" }, alertUnit(form.type)),
          h("button", { className: "sl-btn", onClick: submit }, "＋ 添加")),
        pool.length === 0
          ? h("div", { className: "sl-note" }, "提示：先在自选/持仓里添加股票，或在上面直接填写代码。")
          : null,
        // 规则列表：**按代码分组的抽屉**（同一只票的多条规则收在一组里）。
        // 分组是派生视图，cfg.alerts 仍是扁平数组、Host 状态机仍按规则 id 索引，
        // 所以存储与评估层完全不感知分组。手风琴单开，与持仓页 openCode 同一套交互。
        rules.length === 0
          ? h("div", { className: "sl-empty" }, "还没有预警规则。可在自选/持仓行右键「设为预警」，或在上方添加。")
          : h("div", {
              className: "sl-alert-list" + (groupCap ? " sl-sortable-cap" : ""),
              ref: groupRef,
              style: groupCap ? { maxHeight: groupCap + "px" } : null,
            }, alertGroups.map((g, gi) => {
              const open = s.alertOpen === g.code;
              const firedN = g.rules.filter((r) => (s.alertStates || {})[r.id] && s.alertStates[r.id].phase === "fired").length;
              return h(
                "div",
                { key: g.code, "data-sl-idx": gi, className: "sl-alert-group" },
                h("div", {
                  className: "sl-alert-ghead",
                  onClick: () => setState({ alertOpen: open ? null : g.code }),
                  "data-sltip": open ? "点击收起该股的预警规则" : "点击展开该股的 " + g.rules.length + " 条规则",
                },
                  h("span", { className: "sl-alert-gnm" }, g.name),
                  h("span", { className: "sl-alert-gcode" }, displayCode(g.code)),
                  h("span", { style: { flex: 1 } }),
                  firedN > 0
                    ? h("span", { className: "sl-alert-fired", "data-sltip": "今日已触发 " + firedN + " 条；回落到滞回带外才会重新待命" }, "已触发 " + firedN)
                    : null,
                  // 纯计数，不是开关：规则没有启用/停用之分（删除即停用）
                  h("span", { className: "sl-alert-gcnt" }, g.rules.length + " 条"),
                  h("span", { className: "sl-alert-garw" }, open ? "▾" : "▸")),
                open
                  ? h("div", { className: "sl-alert-gbody" },
                      g.rules.map((r) => {
                        const st = (s.alertStates || {})[r.id];
                        return h("div", { key: r.id, className: "sl-alert-row" },
                          h("span", { className: "sl-alert-cond" }, alertRuleText(r)),
                          st && st.phase === "fired"
                            ? h("span", { className: "sl-alert-fired", "data-sltip": "今日已触发过；回落到滞回带外才会重新待命" }, "已触发")
                            : null,
                          h("button", { className: "sl-x", "data-sltip": "删除该规则", onClick: () => removeAlert(r.id) }, "✕"));
                      }))
                  : null,
              );
            })),
      );
    }

    /**
     * 右键「设为预警」的规则对话框：预填该股现价/成本价，选类型 + 阈值即可。
     * 结构与定位对齐 EditPosDialog（同样用内联样式 + usePanelRect 贴合悬浮窗），
     * 不引入新的弹层类名——项目里弹层本来就没走 CSS 类。
     */
    function AddAlertDialog() {
      const s = useStore();
      const d = s.addAlert;
      const [type, setType] = useState("price_above");
      const [value, setValue] = useState("");
      const panelRect = usePanelRect(!!d);
      const boxRef = useRef(null);
      // 每次换股票/重新打开时按预填值初始化（成本类不需要阈值）
      useEffect(() => {
        if (!d) return;
        const pre = d.preset || {};
        setType(pre.type || "price_above");
        setValue(Number.isFinite(pre.value) && pre.value > 0 ? String(Math.round(pre.value * 10000) / 10000) : "");
      }, [d && d.code, d && d.preset && d.preset.type]);
      useEffect(() => {
        if (!d) return undefined;
        const onKey = (e) => { if (e.key === "Escape") setState({ addAlert: null }); };
        const onDown = (e) => {
          if (boxRef.current && !boxRef.current.contains(e.target)) setState({ addAlert: null });
        };
        window.addEventListener("keydown", onKey);
        document.addEventListener("mousedown", onDown);
        return () => {
          window.removeEventListener("keydown", onKey);
          document.removeEventListener("mousedown", onDown);
        };
      }, [d]);
      if (!d) return null;
      const isCost = type === "cost_above" || type === "cost_below";
      const isLimit = type === "limit_near";
      const limitOk = /^(sh|sz|bj)/i.test(d.code);
      const submit = () => {
        const raw = isCost ? 0 : Number(value);
        if (!isCost && (!Number.isFinite(raw) || raw <= 0)) { toast("阈值需为正数", "#ff5555"); return; }
        const ok = addAlert({ code: d.code, name: d.name, type, value: raw });
        if (ok) setState({ addAlert: null });
      };
      const boxW = 300;
      const cx = panelRect ? panelRect.left + panelRect.width / 2 : window.innerWidth / 2;
      const cy = panelRect ? panelRect.top + panelRect.height / 2 : window.innerHeight / 2;
      const style = { position: "fixed", left: cx, top: cy, transform: "translate(-50%,-50%)", zIndex: 10002, pointerEvents: "auto" };
      const row = (label, node) => h("label", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
        h("span", { className: "sl-setlabel" }, label), node);
      return h(
        "div",
        { className: "sl-root sl-theme-" + s.theme + (s.theme === "light" ? " sl-light" : ""), style },
        h(
          "div",
          { ref: boxRef, style: { width: boxW, background: "var(--sl-bg)", border: "1px solid var(--sl-accent-border)", borderRadius: 10, padding: 12, boxShadow: "var(--sl-shadow)", display: "flex", flexDirection: "column", gap: 8 } },
          h("div", { style: { fontWeight: 700, color: "var(--sl-accent)" } }, "🔔 设为预警：" + (d.name || displayCode(d.code)) + "（" + displayCode(d.code) + "）"),
          row("条件", h("select", {
            className: "sl-input", style: { width: 170 }, value: type,
            onChange: (e) => setType(e.target.value),
          }, Object.keys(ALERT_TYPE_LABEL).map((t) =>
            h("option", { key: t, value: t, disabled: t === "limit_near" && !limitOk }, ALERT_TYPE_LABEL[t])))),
          isLimit && !limitOk
            ? h("div", { className: "sl-note" }, "港/美股没有涨跌停，该类型仅对 A 股可用。")
            : null,
          isCost
            ? h("div", { className: "sl-note" }, "以该股持仓成本价为判据（成本缺失时自动跳过，不会误报）。")
            : row("阈值", h("span", { style: { display: "flex", alignItems: "center", gap: 6 } },
                h("input", {
                  className: "sl-input", style: { width: 110 }, type: "number", step: "0.01", min: "0",
                  value, autoFocus: true, placeholder: "阈值",
                  onChange: (e) => setValue(e.target.value),
                  onKeyDown: (e) => { if (e.key === "Enter") submit(); },
                }),
                h("span", { style: { color: "var(--sl-muted)" } }, alertUnit(type)))),
          h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 } },
            h("button", { className: "sl-btn sl-btn-ghost", onClick: () => setState({ addAlert: null }) }, "取消"),
            h("button", { className: "sl-btn", onClick: submit }, "添加规则")),
        ),
      );
    }

    /**
     * 预警弹窗：触发时**无条件弹出**（页面可见或隐藏都弹），必须手动确认。
     *
     * 为什么不复用 toast：toast 是 pointer-events:none 的单行提示、2.6 秒自散，
     * 极易被忽略；而预警是"错过了就失去意义"的事件。这里的弹窗：
     *   - 挂在 shell.overlay 顶层（fixed + 高 z-index），窗口恢复时一定可见
     *   - **10 秒后自动消失**，也可点击 ✕ / Escape / 点主体立即关掉
     *   - 多条触发时堆叠展示（队列上限 5，避免离开一天回来被刷屏）
     *   - 点击弹窗主体 → 进预警二级页看历史并标记已读
     *
     * ⚠️ 倒计时**只在页面可见时走**：隐藏时暂停。否则弹窗会在你看不见的时候
     * 悄悄过期——那正好违背「隐藏也要能收到预警」这条要求。重新可见后给满 10 秒。
     */
    /**
     * 探测对话区几何：预警弹窗要显示在「对话消息区」里（用户指定位置），
     * 而不是屏幕右上角。用宿主已稳定的 composer 槽位反推：
     *   - composer seat 的父容器即对话面板（消息区 + 输入区）
     *   - 弹窗落在该容器顶部居中，宽度取容器宽度的一部分
     * 找不到时回退视口上方居中（保证任何宿主版本下都能显示）。
     * 与 useComposerAnchor 同款做法：轮询 + resize，容忍宿主改版。
     */
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

