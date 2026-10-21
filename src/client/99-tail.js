    const inject = ["slots"];

    /**
     * Client plugin body：
     *  - conversation.composer.dock → 对话输入框下方指数栏（左下角）
     *  - shell.overlay              → 行情悬浮窗
     * @param ctx - client root context。
     */
    function apply(ctx) {
      const withBoundary = (node) => h(ErrorBoundary, { theme: state.theme }, node);
      ctx.effect(initTipLayer);
      ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({ name: "conversation.composer.dock", id: "dsh-stock-leek.bar" }, () => withBoundary(h(IndexBar))));
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-stock-leek.tip-layer", order: 999 }, () => h(TipLayer)));
      // 预警弹窗：**独立 slot**，与悬浮窗（Overlay）的 open 状态解耦。
      // 曾经挂在 Overlay 内部 → 悬浮窗关着时 `if (!s.open) return null` 会连带
      // 把弹窗一起吞掉，导致「不打开悬浮窗就收不到预警」（用户实测反馈）。
      // order 取 1000：排在提示层（999）之后，保证预警在最上层。
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-stock-leek.alert-popup", order: 1000 }, () => withBoundary(h(AlertPopup))));
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-stock-leek.floating-bar", order: -10 }, () => withBoundary(h(FloatingIndexBar))));
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-stock-leek" }, (props) => withBoundary(h(Overlay, props))));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
