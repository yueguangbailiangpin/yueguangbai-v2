// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { RootEntry } from './testable';
import { Drawer } from './ui/primitives';

describe('foundation accessibility components', () => {
  it('shows only the two public identity entries', () => { render(<BrowserRouter><RootEntry /></BrowserRouter>); expect(screen.getByRole('link', { name: '买家入口' })).toBeVisible(); expect(screen.getByRole('link', { name: '卖家入口' })).toBeVisible(); expect(screen.queryByText('员工入口')).toBeNull(); });
  it('names and closes a drawer with Escape', () => { const close = vi.fn(); render(<Drawer open title="详情结构" onClose={close}>内容</Drawer>); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(close).toHaveBeenCalledOnce(); });
});
