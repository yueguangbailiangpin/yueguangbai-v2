import { Link } from 'react-router';
import { Card } from '../ui/primitives';
import { reviewBuildSha } from './runtime';

export function ReviewHome(): React.JSX.Element {
  return (
    <main className="review-home">
      <section className="review-home-heading">
        <p className="eyebrow">Moonwhite Frontend Review Mode</p>
        <h1>
          <span>月光白</span>
          {' V2 · 前端评审环境'}
        </h1>
        <p>当前均为 Demo 数据，不会修改正式业务数据。</p>
      </section>
      <section className="review-entry-grid" aria-label="选择评审端">
        <Link to="/buyer">
          <Card>
            <span>Buyer</span>
            <h2>买家端</h2>
            <p>产品、任务、我的与完整买家生命周期。</p>
          </Card>
        </Link>
        <Link to="/seller">
          <Card>
            <span>Seller</span>
            <h2>卖家端</h2>
            <p>桌面后台、店铺、订单、评论、结算与团队。</p>
          </Card>
        </Link>
        <Link to="/staff">
          <Card>
            <span>Staff</span>
            <h2>员工端</h2>
            <p>四种岗位、工作台、订单、客户、产品、返款与财务。</p>
          </Card>
        </Link>
      </section>
      <p className="review-build">
        Review Build <code>{reviewBuildSha()}</code>
      </p>
    </main>
  );
}
