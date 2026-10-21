    function TxnPanel(props) {
      const { p, form, setForm, submitTxn, todayDate } = props;
      const set = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));
      return h(
        "div",
        { className: "sl-txn-panel" },
        h(
          "div",
          { className: "sl-txn-form" },
          h("span", { className: "sl-seg sl-txn-seg" },
            [["buy", "买入"], ["sell", "卖出"]].map(([v, t]) =>
              h("button", { key: v, className: form.side === v ? "on" : "", onClick: () => set("side", v) }, t))),
          h("input", { className: "sl-mini sl-txn-price", type: "number", step: "0.001", min: "0", placeholder: "价格", value: form.price, onChange: (e) => set("price", e.target.value) }),
          h("input", { className: "sl-mini sl-txn-qty", type: "number", step: "100", min: "0", placeholder: "股数", value: form.qty, onChange: (e) => set("qty", e.target.value) }),
          h("input", { className: "sl-mini sl-txn-date-input", type: "date", value: form.date || todayDate || "", onChange: (e) => set("date", e.target.value), "data-sltip": "成交日期（默认今日）" }),
          h("button", { className: "sl-btn sl-txn-add", onClick: () => submitTxn(p) }, "＋记一笔"),
        ),
        h("div", { className: "sl-txn-hint" }, "成交明细见右键「📒 交易记录」"),
      );
    }

    /**
     * 交易记录二级页：只显示**被右键那只股票**的成交（最新在前）。
     * 挂在持仓 tab 下（与预警挂在设置下同一套路），「← 返回」回持仓列表。
     */
    function TxnRecordsView(props) {
      const s = useStore();
      const cfg = s.config;
      const panel = props.panel;
      const listRef = useRef(null);
      // 成交明细按 MAX_VISIBLE_ROWS 封顶（与大盘/自选/持仓同一套 10 行上限）。
      // Hooks 不能放在 early return 之后，所以行数在这里用 cfg 安全取值。
      const rowCount = (() => {
        if (!cfg || !panel) return 0;
        const pp = cfgFind(cfg.positions, panel.code);
        return ((pp && pp.txns) || []).length;
      })();
      const rowCap = useListCap(listRef, rowCount);
      if (!cfg || !panel) return h("div", { className: "sl-empty" }, "加载中…");
      const p = cfgFind(cfg.positions, panel.code);
      const q = s.quotes[panel.code];
      const txns = ((p && p.txns) || []).slice().reverse(); // 最新在前
      const today = quoteDate(q);
      // 汇总：买入额 / 卖出额 / 净股数（净=0 说明已清仓）
      let buyAmt = 0, sellAmt = 0, net = 0;
      for (const t of txns) {
        net += t.qty;
        if (t.qty > 0) buyAmt += t.price * t.qty;
        else sellAmt += t.price * -t.qty;
      }
      const todayTxns = txns.filter((t) => t.date === today);
      return h(
        "div",
        { className: "sl-txnrec" },
        h("div", { className: "sl-dhead" },
          h("div", { className: "sl-dtop" },
            h("button", { className: "sl-back", onClick: () => setState({ txnPanel: null }) }, "← 返回"),
            h("span", { className: "sl-dname" }, "📒 交易记录：" + (panel.name || displayCode(panel.code)) + "（" + displayCode(panel.code) + "）"))),
        txns.length === 0
          ? h("div", { className: "sl-empty" }, "还没有交易记录。右键持仓行「记一笔交易」补录。")
          : h(
              react.Fragment,
              null,
              // 汇总条：买入/卖出成交额 + 净股数（清仓时净=0）
              // 用 fmtSigned0 而非 fmtMoney：后者对 0 返回 "-"，汇总里"买 -"读不通
              h("div", { className: "sl-txnrec-sum" },
                h("span", { "data-sltip": "全部买入成交合计 " + fmtExact(buyAmt) + " 元" }, "买 ", h("b", { className: "sl-up" }, fmtSigned0(buyAmt))),
                h("span", { "data-sltip": "全部卖出成交合计 " + fmtExact(sellAmt) + " 元" }, "卖 ", h("b", { className: "sl-down" }, fmtSigned0(sellAmt))),
                h("span", { "data-sltip": "累计净买入股数（0 = 已清仓）" }, "净 ", h("b", null, net + " 股")),
                h("span", { style: { flex: 1 } }),
                h("span", { className: "sl-txnrec-cnt" }, txns.length + " 笔" + (todayTxns.length ? " · 今日 " + todayTxns.length + " 笔" : ""))),
              h("div", { className: "sl-txnrec-head" },
                h("span", null, "方向"), h("span", null, "日期"), h("span", null, "价格"), h("span", null, "股数"), h("span", null, "金额"), h("span", null, "")),
              h("div", {
                className: "sl-txnrec-list" + (rowCap ? " sl-sortable-cap" : ""),
                ref: listRef,
                style: rowCap ? { maxHeight: rowCap + "px" } : null,
              },
                txns.map((t, ti) =>
                  h(
                    "div",
                    { key: t.id, "data-sl-idx": ti, className: "sl-txn-row" },
                    h("span", { className: "sl-txn-side " + (t.qty > 0 ? "sl-up" : "sl-down") }, t.qty > 0 ? "买" : "卖"),
                    h("span", { className: "sl-txn-date" }, t.date || "-"),
                    h("span", { className: "sl-txn-num" }, "@" + fmtPrice(t.price)),
                    h("span", { className: "sl-txn-num" }, Math.abs(t.qty) + "股"),
                    h("span", { className: "sl-txn-amt" }, fmtMoney(Math.abs(t.price * t.qty), "")),
                    t.date === today ? h("span", { className: "sl-txn-today" }, "今") : null,
                    h("button", { className: "sl-x", "data-sltip": "删除该笔成交", onClick: () => removeTxn(panel.code, t.id) }, "✕"),
                  ),
                ))),
      );
    }

    // ================================================================ 视图：设置
