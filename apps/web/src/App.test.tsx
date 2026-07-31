import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('Web foundation', () => {
  it('renders the Phase 1A boundary and no production claim', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('月光白 V2 基础工程');
    expect(html).toContain('Phase 1A');
    expect(html).toContain('不连接真实 D1、R2、飞书或客户数据');
    expect(html).not.toContain('生产环境已连接');
  });
});
