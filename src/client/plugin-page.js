    /**
     * 插件详情页的「指数栏开关」控件。
     *
     * 为什么要这个：指数栏可以被收起来（`cfg.barVisible=false`），收起后
     * **界面上就没有任何入口能再打开它** —— 悬浮窗和设置都在指数栏里面，
     * 指数栏一藏，用户就只能手改配置文件了（用户实测反馈）。
     * 这个控件挂在宿主插件页的 `plugins.detail.actions` 槽位上，
     * 那个页面永远可达（侧栏「插件」），等于给指数栏留了一个**永不消失的开关**。
     *
     * 宿主契约（见 DSH 宿主文档「Detail page extension points」）：
     * - `plugins.detail.actions` 渲染在**页头**，位于页面自己的开关和卸载之前；
     * - 每个条目都带 `subject`：`{kind:'bundle',pkg}` / `{kind:'row',pkg,row}` / `{kind:'item',id}`；
     * - 对无话可说的 subject 必须返回 null（否则会在别人的插件页上出现我们的按钮）。
     *
     * 本插件的详情页是 `kind:'item'`（宿主 render 时用 `data-plugin-item-detail`），
     * 所以只认 id === 本包名 的那一个。
     */
    const PLUGIN_PKG = "@shiqyka/dsh-stock-leek";

    function PluginBarToggle(props) {
      const subject = props && props.subject;
      const s = useStore();
      const cfg = s.config;
      // 只在**本插件自己的**详情页出现：别人的 bundle/row/item 页一律不显示。
      if (!subject || subject.kind !== "item" || subject.id !== PLUGIN_PKG) return null;
      // 配置还没拉回来时先不画（否则会闪一下「隐藏」再变「显示」）
      if (!cfg) return null;

      const shown = cfg.barVisible !== false;
      /**
       * 开关动作走 updateConfig 而不是本地 state：
       * 指数栏的显隐是**配置项**（`cfg.barVisible`），要和设置页里那个
       * 「对话左下角指数栏 显示/隐藏」共用同一份状态，否则两处会各说各话。
       *
       * 打开时顺手把放置方式切回 floating：dock 模式下指数栏渲染在
       * `conversation.composer.dock`，而那个槽位只在**已有对话**里渲染
       * （新会话页宿主不渲染该槽位）。若用户此刻正停在新会话页，
       * 切到 dock 会呈现"点了显示却什么都没出现"——切回 floating 才一定能看到。
       */
      const toggle = () => {
        updateConfig((c) => {
          c.barVisible = !(c.barVisible !== false);
          return c;
        });
        if (!shown && state.barPlacement === "dock") setBarPlacement("floating");
      };

      return h(
        "button",
        {
          className: "sl-pdtoggle" + (shown ? " sl-pdtoggle-on" : ""),
          type: "button",
          "data-sltip": shown
            ? "指数栏当前显示在对话左下角\n点击隐藏（隐藏后可随时回到本页重新打开）"
            : "指数栏当前已隐藏\n点击重新显示在对话左下角",
          onClick: toggle,
        },
        h("span", { className: "sl-pdtoggle-dot", "aria-hidden": "true" }),
        shown ? "指数栏：显示中" : "指数栏：已隐藏",
      );
    }
