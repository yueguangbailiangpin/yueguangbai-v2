import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { runtimeConfig } from './config/runtime-config';
import './styles/tokens.css';
import './styles/global.css';
import './styles/design-freeze.css';

class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(_error: Error, _info: ErrorInfo): void { /* Safe recovery intentionally excludes raw exception data. */ }
  override render(): ReactNode { return this.state.failed ? <main className="centered"><section className="state" role="alert"><h1>页面暂时无法打开</h1><p>请刷新后重试。</p></section></main> : this.props.children; }
}

const container = document.getElementById('root');
if (!container) throw new Error('root_element_missing');
runtimeConfig();
createRoot(container).render(<StrictMode><RootErrorBoundary><App /></RootErrorBoundary></StrictMode>);
