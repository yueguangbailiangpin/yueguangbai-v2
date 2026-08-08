import { Component, lazy, Suspense, useMemo, type ComponentType, type ReactNode } from 'react';

type RouteModule = { default: ComponentType };
type RouteLoader = () => Promise<RouteModule>;

class RouteChunkErrorBoundary extends Component<{
  children: ReactNode;
}, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <main className="centered">
        <section className="state" role="alert" aria-live="assertive">
          <h1>页面内容暂时无法加载</h1>
          <p>请检查网络后重试，当前不会显示受保护内容；仅在您点击后才会整页重试。</p>
          <button type="button" onClick={() => window.location.reload()}>重新加载整页</button>
        </section>
      </main>;
    }
    return this.props.children;
  }
}

export function RouteChunkBoundary({ load }: { load: RouteLoader }): React.JSX.Element {
  const RouteComponent = useMemo(() => lazy(load), [load]);
  return <RouteChunkErrorBoundary>
    <Suspense fallback={<main className="centered"><section className="state" role="status" aria-live="polite"><p>正在加载页面内容…</p></section></main>}>
      <RouteComponent />
    </Suspense>
  </RouteChunkErrorBoundary>;
}
