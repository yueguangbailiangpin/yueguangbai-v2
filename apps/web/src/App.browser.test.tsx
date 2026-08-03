// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { RootEntry } from './testable';
import { Drawer } from './ui/primitives';

describe('foundation accessibility components', () => {
  it('shows only the dedicated-link notice at root', () => { render(<BrowserRouter><RootEntry /></BrowserRouter>); expect(screen.getByRole('heading', { name: '月光白' })).toBeVisible(); expect(screen.queryByRole('link')).toBeNull(); expect(screen.getByText('请使用工作人员发送的专属链接登录。')).toBeVisible(); });
  it('names and closes a drawer with Escape', () => { const close = vi.fn(); render(<Drawer open title="详情结构" onClose={close}>内容</Drawer>); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(close).toHaveBeenCalledOnce(); });
});
