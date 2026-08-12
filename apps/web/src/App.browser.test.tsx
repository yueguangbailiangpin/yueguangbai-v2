// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter } from 'react-router';
import { RootEntry } from './testable';
import { Drawer } from './ui/primitives';

afterEach(cleanup);

describe('foundation accessibility components', () => {
  it('shows exactly the two approved visible strings at root', () => {
    render(<BrowserRouter><RootEntry /></BrowserRouter>);
    const heading = screen.getByRole('heading', { name: '月光白' });
    expect(heading).toBeVisible();
    expect(heading.closest('section')).toHaveTextContent(
      /^月光白请使用工作人员发给您的专属链接登录。$/u,
    );
    expect(screen.queryByText('专属访问')).toBeNull();
    expect(screen.queryByText('链接将自动确认您的访问身份')).toBeNull();
    expect(screen.queryByText('月', { exact: true })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names and closes a drawer with Escape', () => { const close = vi.fn(); render(<Drawer open title="详情结构" onClose={close}>内容</Drawer>); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(close).toHaveBeenCalledOnce(); });
});
