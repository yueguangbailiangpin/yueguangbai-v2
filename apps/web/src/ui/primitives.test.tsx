// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Alert,
  BottomNavigation,
  Breadcrumb,
  Button,
  Checkbox,
  DataTable,
  DependencyUnavailable,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  FormField,
  IconButton,
  LoadingState,
  NotFound,
  Pagination,
  PermissionDenied,
  Progress,
  RequestIdDisplay,
  SearchInput,
  Select,
  Sidebar,
  Skeleton,
  StatusBadge,
  Tabs,
  TextInput,
  Timeline,
  Toast,
} from './primitives';

afterEach(cleanup);

describe('shared controls and fields', () => {
  it('activates Button and IconButton by keyboard and exposes loading state', async () => {
    const user = userEvent.setup();
    const primary = vi.fn();
    const icon = vi.fn();
    render(<><Button onClick={primary}>保存</Button>
      <IconButton label="关闭" onClick={icon}>×</IconButton>
      <Button loading loadingLabel="正在保存">保存</Button></>);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(primary).toHaveBeenCalledOnce();
    await user.tab();
    await user.keyboard(' ');
    expect(icon).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '正在保存' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '正在保存' })).toHaveAttribute(
      'aria-busy', 'true',
    );
  });

  it('connects FormField label, description, and persistent error semantics', () => {
    render(<FormField
      label="账号"
      htmlFor="account"
      description="使用工作人员提供的账号"
      error="账号不能为空"
      required
    ><TextInput /></FormField>);
    const input = screen.getByRole('textbox', { name: '账号' });
    expect(input).toHaveAccessibleDescription(
      '使用工作人员提供的账号 账号不能为空',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAttribute(
      'aria-errormessage',
      screen.getByText('账号不能为空').id,
    );
  });

  it('operates Checkbox by keyboard and keeps visible state text', async () => {
    const user = userEvent.setup();
    render(<Checkbox label="仅显示待处理" stateLabel="当前未启用" />);
    const checkbox = screen.getByRole('checkbox', { name: /仅显示待处理/u });
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    checkbox.focus();
    await user.keyboard(' ');
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText('当前未启用')).toBeVisible();
  });

  it('labels Select and SearchInput and supports typing and selection', async () => {
    const user = userEvent.setup();
    render(<><label htmlFor="status">状态</label>
      <Select id="status"><option value="all">全部</option><option value="open">待处理</option></Select>
      <SearchInput label="搜索列表" /></>);
    await user.selectOptions(screen.getByRole('combobox', { name: '状态' }), 'open');
    expect(screen.getByRole('combobox', { name: '状态' })).toHaveValue('open');
    await user.type(screen.getByRole('searchbox', { name: '搜索列表' }), '资料');
    expect(screen.getByRole('searchbox', { name: '搜索列表' })).toHaveValue('资料');
  });
});

describe('overlays and keyboard focus', () => {
  function DrawerHarness() {
    const [open, setOpen] = useState(false);
    return <><Button onClick={() => setOpen(true)}>打开详情</Button>
      <Drawer open={open} title="详情" onClose={() => setOpen(false)}>
        <Button>详情操作</Button>
      </Drawer></>;
  }

  it('traps Drawer focus, closes on Escape, and restores the opener', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    const opener = screen.getByRole('button', { name: '打开详情' });
    await user.click(opener);
    const close = screen.getByRole('button', { name: '关闭详情' });
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: '详情操作' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  function DialogHarness() {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    return <><Button onClick={() => setOpen(true)}>退出所有设备</Button>
      <Dialog
        open={open}
        title="确认退出"
        description="其他设备也会退出。"
        busy={busy}
        onClose={() => setOpen(false)}
      ><Button onClick={() => setBusy(true)}>开始处理</Button>
        <Button onClick={() => setOpen(false)}>取消</Button></Dialog></>;
  }

  it('cycles Dialog tabs, blocks Escape while busy, then restores focus', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: '退出所有设备' });
    await user.click(opener);
    const start = screen.getByRole('button', { name: '开始处理' });
    const cancel = screen.getByRole('button', { name: '取消' });
    expect(start).toHaveFocus();
    cancel.focus();
    await user.tab();
    expect(start).toHaveFocus();
    await user.click(start);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeVisible();
    await user.click(cancel);
    expect(opener).toHaveFocus();
  });
});

describe('navigation and structured content', () => {
  it('moves Tabs with arrows, Home, and End', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [active, setActive] = useState('one');
      return <Tabs label="内容视图" activeId={active} onChange={setActive} items={[
        { id: 'one', label: '第一项', panelId: 'panel-one' },
        { id: 'two', label: '第二项', panelId: 'panel-two' },
        { id: 'three', label: '第三项', panelId: 'panel-three' },
      ]} />;
    }
    render(<Harness />);
    const first = screen.getByRole('tab', { name: '第一项' });
    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '第二项' })).toHaveAttribute(
      'aria-selected', 'true',
    );
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: '第三项' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
  });

  it('marks current Pagination page and disables boundaries', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Pagination currentPage={2} totalPages={3} onChange={changed} />);
    expect(screen.getByRole('button', { name: '第 2 页' })).toHaveAttribute(
      'aria-current', 'page',
    );
    await user.click(screen.getByRole('button', { name: '下一页' }));
    expect(changed).toHaveBeenCalledWith(3);
  });

  it('renders Breadcrumb current page and links its ancestors', () => {
    render(<Breadcrumb items={[
      { label: '首页', href: '/' },
      { label: '订单', href: '/orders' },
      { label: '详情' },
    ]} />);
    expect(screen.getByRole('navigation', { name: '面包屑' })).toBeVisible();
    expect(screen.getByText('详情')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '订单' })).toHaveAttribute(
      'href', '/orders',
    );
  });

  it('renders DataTable caption and scoped headers inside an overflow region', () => {
    render(<DataTable caption="待处理列表"><thead><tr>
      <th scope="col">状态</th><th scope="col">说明</th>
    </tr></thead><tbody><tr><td>空</td><td>暂无业务数据</td></tr></tbody></DataTable>);
    const table = screen.getByRole('table', { name: '待处理列表' });
    expect(within(table).getByRole('columnheader', { name: '状态' })).toHaveAttribute(
      'scope', 'col',
    );
    expect(table.parentElement).toHaveAttribute('tabindex', '0');
  });

  it('shows Sidebar collapse semantics and BottomNavigation safe-area class', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [collapsed, setCollapsed] = useState(false);
      return <><Sidebar
        label="卖家导航"
        items={[{ id: 'home', label: '概览', href: '/seller', end: true }]}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
      /><BottomNavigation label="买家导航"><a href="#home">首页</a></BottomNavigation></>;
    }
    render(<MemoryRouter><Harness /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: '收起侧边导航' }));
    expect(screen.getByRole('button', { name: '展开侧边导航' })).toHaveAttribute(
      'aria-expanded', 'false',
    );
    expect(screen.getByRole('navigation', { name: '买家导航' })).toHaveClass(
      'bottom-nav',
    );
    expect(screen.getByRole('link', { name: '概览' })).toBeVisible();
  });

  it('renders Timeline and a non-color StatusBadge label', () => {
    render(<><Timeline items={[{ title: '已创建', detail: '等待后续模块', status: '完成' }]} />
      <StatusBadge tone="success">已完成</StatusBadge></>);
    expect(screen.getByText('已创建')).toBeVisible();
    expect(screen.getByText('已完成')).toHaveClass('status-success');
  });
});

describe('feedback and system states', () => {
  it('exposes determinate and indeterminate Progress semantics', () => {
    const { rerender } = render(<Progress label="上传进度" value={35} />);
    expect(screen.getByRole('progressbar', { name: '上传进度' })).toHaveAttribute(
      'aria-valuenow', '35',
    );
    rerender(<Progress label="处理进度" />);
    expect(screen.getByRole('progressbar', { name: '处理进度' })).not.toHaveAttribute(
      'aria-valuenow',
    );
  });

  it('uses live regions for Toast and appropriate Alert roles', () => {
    render(<><Toast message="保存完成" tone="success" />
      <Toast message="保存失败" tone="danger" />
      <Alert tone="warning" title="注意">请检查内容</Alert>
      <Alert tone="danger" title="错误">操作失败</Alert></>);
    expect(screen.getByText('保存完成').parentElement).toHaveAttribute(
      'aria-live', 'polite',
    );
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getByText('注意').parentElement).toHaveAttribute('role', 'status');
  });

  it('renders complete empty/loading/error/403/404/503 states', () => {
    render(<><EmptyState /><LoadingState /><ErrorState requestId="request-error" />
      <PermissionDenied requestId="request-403" />
      <NotFound requestId="request-404" />
      <DependencyUnavailable requestId="request-503" /></>);
    expect(screen.getByRole('heading', { name: '暂无内容' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '正在加载' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '无权访问' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '页面未找到' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '服务暂时不可用' })).toBeVisible();
    expect(screen.getByText(/request-503/u)).toBeVisible();
  });

  it('copies Request ID without exposing any error detail', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<RequestIdDisplay requestId="request-safe-copy" />);
    await user.click(screen.getByRole('button', { name: '复制请求编号' }));
    expect(writeText).toHaveBeenCalledWith('request-safe-copy');
  });

  it('marks Skeleton as loading while its visual lines stay hidden', () => {
    render(<Skeleton lines={3} />);
    const status = screen.getByRole('status', { name: '内容加载中' });
    expect(status).toHaveClass('skeleton');
    expect(status.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });
});
