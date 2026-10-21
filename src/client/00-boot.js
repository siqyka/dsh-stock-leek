/**
 * dsh-stock-leek — 浏览器端（client.js）
 *
 * DSH 客户端插件（__ModuleLoader__ 形态）：
 *   1. conversation.composer.dock → 对话输入框下方「左下角指数栏」（上证/深证…，可配置）
 *   2. shell.overlay              → 可拖动悬浮窗：大盘 / 自选 / 持仓 / 设置 + 个股详情（分时/K线）
 *
 * 数据来自 Host 端 /dsh-stock-leek/* 路由（腾讯财经行情）。
 * 配置持久化在 Host 的 ~/.dsh/dsh-stock-leek/config.json（localStorage 作首屏缓存）。
 * 图表为自绘 SVG（分时折线 + K线蜡烛 + MA + 盈亏曲线），不依赖 CDN。
 * 配色 A 股惯例：红涨绿跌。
 */
window.__ModuleLoader__.load({
  // 必须等于 package.json 的 name：客户端加载器会校验"加载到的 bundle 是否用
  // __ModuleLoader__.load 注册了它期望的 id"，而期望的 id 来自包名。
  id: "@shiqyka/dsh-stock-leek",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    const { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } = react;
    const h = react.createElement;

    // 错误边界：任一视图抛错时降级为小卡片，避免整棵 shell.overlay（悬浮窗+指数栏）被连带卸载。
    class ErrorBoundary extends react.Component {
      constructor(props) {
        super(props);
        this.state = { err: null };
      }
      static getDerivedStateFromError(err) {
        return { err };
      }
      componentDidCatch(err, info) {
        try { console.error("[dsh-stock-leek] view crashed:", err && err.stack ? err.stack : err, info && info.componentStack); } catch { /* ignore */ }
      }
      render() {
        if (this.state.err) {
          return h(
            "div",
            { className: "sl-root sl-theme-" + (this.props.theme || "dark") + (this.props.theme === "light" ? " sl-light" : ""), style: { padding: 10 } },
            h("div", { className: "sl-empty" }, "⚠ 视图出错：" + String((this.state.err && this.state.err.message) || this.state.err)),
            h("div", { style: { textAlign: "center", padding: "4px 0" } },
              h("button", { className: "sl-btn", onClick: () => this.setState({ err: null }) }, "重试")),
          );
        }
        return this.props.children;
      }
    }

    // ================================================================ CSS
