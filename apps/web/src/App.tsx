const foundationItems = [
  'Workers + Hono API 骨架',
  'React + Vite Web 骨架',
  '统一 API 响应与错误码',
  '固定点数字与身份规范化工具',
  '安全扫描、类型检查和自动测试',
] as const;

export function App() {
  return (
    <main className="page-shell">
      <section className="hero-card" aria-labelledby="page-title">
        <p className="eyebrow">YUEGUANGBAI V2</p>
        <h1 id="page-title">月光白 V2 基础工程</h1>
        <p className="summary">
          模块 0 已冻结。当前正在建立第一批可运行、可测试的真实源码。
        </p>

        <div className="status-row">
          <span className="status-dot" aria-hidden="true" />
          <strong>Phase 1A · Foundation</strong>
        </div>

        <ul className="foundation-list">
          {foundationItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <p className="boundary">
          当前页面不连接真实 D1、R2、飞书或客户数据。
        </p>
      </section>
    </main>
  );
}
