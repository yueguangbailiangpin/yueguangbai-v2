import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
/*
 * CSS 分层（7F-1）。顺序即职责，禁止靠尾部追加覆盖修 UI：
 *  1. tokens.css        设计令牌（颜色/字号/间距，三端共享）
 *  2. global.css / design-freeze.css / staff-shell-v2.css /
 *     buyer-portal.css / seller-portal.css
 *     —— legacy 隔离层：仅服务未迁移到新层的买家/卖家页面与旧员工
 *     残留；7F-2/7F-3 迁移完成后逐个退役（见 7F-1 交接文档）。
 *  3. base.css          新员工端作用域 reset/元素默认（.staff-app）
 *  4. primitives.css    新员工端原子组件（sa-）
 *  5. staff-shell.css   员工端 Shell 权威层（sa-）
 *  6. staff-pages.css   员工端页面权威层（sp-）
 * Legacy 先加载、员工端作用域层后加载，避免旧全局规则覆盖员工端；
 * 新员工规则只使用 .staff-app / sa- / sp-，不影响买家端与卖家端。
 */
import './styles/tokens.css';
import './styles/global.css';
import './styles/design-freeze.css';
import './styles/staff-shell-v2.css';
import './styles/buyer-portal.css';
import './styles/seller-portal.css';
import './styles/base.css';
import './styles/primitives.css';
import './styles/staff-shell.css';
import './styles/staff-pages.css';
import './styles/staff-icons.css';

class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    /* Safe recovery intentionally excludes raw exception data. */
  }
  override render(): ReactNode {
    return this.state.failed ? (
      <main className="centered">
        <section className="state" role="alert">
          <h1>页面暂时无法打开</h1>
          <p>请刷新后重试。</p>
        </section>
      </main>
    ) : (
      this.props.children
    );
  }
}

const container = document.getElementById('root');
if (!container) throw new Error('root_element_missing');
createRoot(container).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
