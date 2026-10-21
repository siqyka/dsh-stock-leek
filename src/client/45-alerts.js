    let alertEs = null;
    let alertEsTried = false;
    /** 桌面通知能力探测：DSH 宿主可能是 webview，Notification 未必存在 */
    function notifySupported() {
      return typeof Notification === "function";
    }
    function notifyPermission() {
      if (!notifySupported()) return "unsupported";
      return Notification.permission; // "granted" | "denied" | "default"
    }
    /**
     * 三级降级（§7.3）：
     *   页面可见            → toast + 铃铛角标
     *   隐藏 + 已授权        → 系统通知（点击回到页面）
     *   隐藏 + 未授权/不可用 → document.title 加 ⚠ 前缀
     * 全不可用也仍有历史 + 角标——功能不依赖通知成立。
     */
    function flashTitle(text) {
      const base = document.title.replace(/^⚠ /, "");
      document.title = "⚠ " + base;
      clearTimeout(flashTitle._t);
      flashTitle._t = setTimeout(() => { document.title = base; }, 6000);
    }
    /**
     * 多标签页去重（§7.4）：三个标签页都隐藏 → 会弹三条重复系统通知。
     * 用 navigator.locks 按事件 id 认领，抢到的才弹；不支持时退回「照弹」。
     */
    function claimEvent(key) {
      if (typeof navigator === "undefined" || !navigator.locks || !navigator.locks.request) {
        return Promise.resolve(true); // 无 locks：照弹（注释说明，不静默丢通知）
      }
      return new Promise((resolve) => {
        try {
          navigator.locks.request("sl-alert-" + key, { ifAvailable: true }, (lock) => {
            if (!lock) { resolve(false); return undefined; } // 别的标签页抢到了
            resolve(true);
            return new Promise((r) => setTimeout(r, 1500)); // 持锁一小会儿，挡住并发重复
          }).catch(() => resolve(true));
        } catch {
          resolve(true);
        }
      });
    }
    /**
     * 收到一条预警事件。
     *
     * 关键行为：**无论页面可见与否，都在应用内弹一个必须手动确认的预警弹窗**
     * （用户明确要求）。原因：DSH 是 Electron webview，隐藏/最小化时
     * document.title 根本看不见，系统通知又未必可用——只靠那两条等于收不到。
     * 应用内弹窗挂在 shell.overlay 上，窗口恢复时一定在，且不会被忽略。
     *
     * 系统通知作为**叠加增强**（可见时也发）：能弹就多一条通道，不互斥。
     */
    async function notifyAlert(ev) {
      const name = (ev && ev.name) || displayCode(ev && ev.code);
      const cond = alertRuleText(ev); // 成本类不带「成本价」后缀（类型标签已含），与列表口径一致
      const body = name + " " + cond + "，现价 " + fmtPrice(ev.price);
      const hidden = typeof document !== "undefined" && document.hidden;

      // ① 应用内弹窗：唯一的**保证通道**，可见与否都弹
      pushAlertPopup(ev);

      // ② 不再补 toast：用户明确不要 —— 弹窗本身已足够醒目，
      //    top 处再飘一条「⚠ 苹果 现价上穿…」属于重复打扰（截图反馈）。
      //    去掉后预警只剩「弹窗」一种可见通道（+可选系统通知）。

      // ③ 系统通知：能力具备就发（用户点过「开启桌面通知」）；隐藏时去重防三连弹
      if (notifyPermission() === "granted") {
        if (hidden) {
          const mine = await claimEvent(String(ev.ruleId || "") + ":" + String(ev.at || ""));
          if (!mine) return; // 另一个标签页已弹过
        }
        try {
          const n = new Notification("🔔 预警 · " + name, { body, tag: "sl-" + (ev.ruleId || "") + "-" + (ev.at || "") });
          n.onclick = () => { try { window.focus(); } catch { /* ignore */ } openAlertPanel(); };
        } catch {
          flashTitle(body); // 构造失败（权限被收回等）→ 退回标题提示，弹窗仍在
        }
      } else if (hidden) {
        flashTitle(body); // 无通知能力时的额外兜底（弹窗已在，这条只是锦上添花）
      }
    }
    /**
     * 预警弹窗入队。
     *
     * 规则（用户要求）：**同一时间最多展示 3 条**；再多时不再新增卡片，
     * 而是把溢出的**叠加到最早那条**上（它显示「+N」计数）。
     * 好处：短时间密集触发（如开盘多条同时命中）不会把屏幕铺满，
     * 但也不会丢信息——被叠加的条数明确可见。
     */
    const ALERT_POPUP_MAX = 3;
    function pushAlertPopup(ev) {
      const hidden = typeof document !== "undefined" && document.hidden;
      const item = {
        id: String(ev.ruleId || "") + ":" + String(ev.at || Date.now()),
        name: (ev && ev.name) || displayCode(ev && ev.code),
        code: ev && ev.code,
        type: ev && ev.type,
        value: ev && ev.value,
        price: ev && ev.price,
        percent: ev && ev.percent,
        at: (ev && ev.at) || Date.now(),
        overflow: 0, // 被叠加到本条的数量（>0 时卡片上显示 +N）
        // 可见计时的起点；0 = 尚未开始（页面当时不可见，等恢复可见再起算）。
        // 隐藏期间不推进，否则弹窗会在用户看不见时过期——那等于没弹。
        shownAt: hidden ? 0 : Date.now(),
      };
      const list = (state.alertPopups || []).filter((x) => x.id !== item.id);
      if (list.length >= ALERT_POPUP_MAX) {
        // 满了：叠加到**最早那条**（index 0），不新增卡片
        const head = list[0];
        list[0] = Object.assign({}, head, {
          overflow: (Number(head.overflow) || 0) + 1,
          // 叠加时刷新计时起点：让用户有完整 10 秒看清「又来了几条」
          shownAt: hidden ? 0 : Date.now(),
        });
        setState({ alertPopups: list });
        return;
      }
      list.push(item);
      setState({ alertPopups: list });
    }
    function dismissAlertPopup(id) {
      setState({ alertPopups: (state.alertPopups || []).filter((x) => x.id !== id) });
    }
    function dismissAllAlertPopups() {
      if ((state.alertPopups || []).length) setState({ alertPopups: [] });
    }
    // 测试钩子：暴露真实内部路径供 e2e 驱动通知降级/通道语义。
    // 用 globalThis 而非 export（浏览器工厂没有模块出口），与 __sl_test_state__ 同惯例。
    globalThis.__sl_notify_test__ = notifyAlert;
    globalThis.__sl_alert_stream_open__ = () => !!alertEs;
    function openAlertStream() {
      if (!sseSupported()) return;
      closeAlertStream();
      try {
        alertEs = new EventSource(BASE + "/alert-stream");
      } catch {
        alertEs = null;
        return;
      }
      alertEs.onopen = () => {
        alertEsTried = true;
        // 重连后先对账：冻结期间漏掉的事件靠账本补齐（不假设流不断，§7.1 修订）
        refreshAlerts();
      };
      alertEs.onmessage = (evt) => {
        let payload;
        try {
          payload = JSON.parse(evt.data);
        } catch {
          return;
        }
        if (!payload || payload.type !== "alert" || !payload.event) return;
        // 触发历史已去掉：事件不再入 state，直接交给弹窗通道
        notifyAlert(payload.event);
      };
      alertEs.onerror = () => {
        // 与行情流不同：这里**不回落到轮询**，只标注断开并稍后重连——
        // 预警数据由 Host 照常记录，客户端断了也不丢事件。
        setState({ alertLive: false });
        closeAlertStream();
        clearTimeout(openAlertStream._t);
        openAlertStream._t = setTimeout(() => { if (!document.hidden) openAlertStream(); }, 15000);
      };
      setState({ alertLive: true });
    }
    function closeAlertStream() {
      if (!alertEs) return;
      try {
        alertEs.close();
      } catch { /* ignore */ }
      alertEs = null;
      setState({ alertLive: false });
    }
    /** 申请桌面通知权限：**只在用户点按钮时**调用（浏览器要求手势，开局弹框体验也差） */
    async function requestNotifyPermission() {
      if (!notifySupported()) { toast("当前环境不支持系统通知（历史与角标仍可用）", "#e6a23c"); return "unsupported"; }
      try {
        const p = await Notification.requestPermission();
        setState({ notifyPerm: p });
        toast(p === "granted" ? "已开启桌面通知" : "未获得通知权限（历史与角标仍可用）", p === "granted" ? null : "#e6a23c");
        return p;
      } catch {
        return "unsupported";
      }
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        clearTimeout(pollTimer);
        closeStream(); // 隐藏时断开行情 SSE（与服务端连接数对齐）
        // 预警流**故意不断**：它只在触发时有数据、零上游请求（§7.1）。
        // 这正是「关掉页面也能收到预警」成立的前提。
      } else if (pollActive) {
        refreshQuotes();
        schedulePoll();
        if (sseTried && sseSupported()) openStream(); // 可见时恢复行情通道
        refreshAlerts(); // 回到页面先对账（冻结期间可能漏了事件）
        if (!alertEs && sseSupported()) openAlertStream();
        // 恢复可见：给隐藏期间弹出的预警补上计时起点（它们此前 shownAt=0，未开始倒计时），
        // 并 bump visibleTick 让 AlertPopup 的计时 effect 重跑
        const pops = state.alertPopups || [];
        if (pops.some((p) => !p.shownAt)) {
          const now = Date.now();
          setState({ alertPopups: pops.map((p) => (p.shownAt ? p : Object.assign({}, p, { shownAt: now }))) });
        } else {
          setState({ visibleTick: (state.visibleTick || 0) + 1 });
        }
      }
    });

    // 初始化：localStorage 秒开 → host 配置覆盖
