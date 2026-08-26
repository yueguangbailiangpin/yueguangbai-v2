// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Button,
  DropdownMenu,
  Radio,
  SectionHeader,
  Textarea,
  TextInput,
  Tooltip,
} from './primitives';

afterEach(cleanup);

describe('new base components (stage 7a-1)', () => {
  describe('Textarea', () => {
    it('renders with value and handles change', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Textarea value="hello" onChange={onChange} aria-label="备注" />);
      const el = screen.getByLabelText('备注');
      expect(el).toHaveValue('hello');
      await user.type(el, ' world');
      expect(onChange).toHaveBeenCalled();
    });

    it('supports disabled state', () => {
      render(<Textarea disabled aria-label="禁用备注" />);
      expect(screen.getByLabelText('禁用备注')).toBeDisabled();
    });
  });

  describe('Radio', () => {
    it('renders radio with label and state label', () => {
      const { container } = render(
        <Radio label="标准配送" stateLabel="3-5天" name="shipping" value="standard" />,
      );
      const radio = container.querySelector('input[type="radio"]');
      expect(radio).toBeInTheDocument();
      expect(radio).toHaveAttribute('value', 'standard');
      expect(screen.getByText('标准配送')).toBeInTheDocument();
      expect(screen.getByText('3-5天')).toBeInTheDocument();
    });

    it('can be checked', async () => {
      const user = userEvent.setup();
      const { container } = render(<Radio label="加急" name="shipping" value="express" />);
      const radio = container.querySelector('input[type="radio"]')!;
      await user.click(radio);
      expect(radio).toBeChecked();
    });
  });

  describe('SectionHeader', () => {
    it('renders title and description', () => {
      render(<SectionHeader title="订单信息" description="当前订单的基本事实" />);
      expect(screen.getByText('订单信息')).toBeInTheDocument();
      expect(screen.getByText('当前订单的基本事实')).toBeInTheDocument();
    });

    it('renders action children', () => {
      render(
        <SectionHeader title="列表">
          <Button>新建</Button>
        </SectionHeader>,
      );
      expect(screen.getByRole('button', { name: '新建' })).toBeInTheDocument();
    });
  });

  describe('DropdownMenu', () => {
    it('opens and closes on trigger click', () => {
      const onEdit = vi.fn();
      render(
        <DropdownMenu
          label="操作"
          items={[
            { id: 'edit', label: '编辑', onSelect: onEdit },
            { id: 'delete', label: '删除', danger: true, onSelect: vi.fn() },
          ]}
        />,
      );
      const trigger = screen.getByRole('button', { name: '操作' });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('calls onSelect and closes when item clicked', () => {
      const onEdit = vi.fn();
      render(
        <DropdownMenu label="操作" items={[{ id: 'edit', label: '编辑', onSelect: onEdit }]} />,
      );
      fireEvent.click(screen.getByRole('button', { name: '操作' }));
      fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }));
      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes on Escape', () => {
      render(
        <DropdownMenu label="操作" items={[{ id: 'edit', label: '编辑', onSelect: vi.fn() }]} />,
      );
      fireEvent.click(screen.getByRole('button', { name: '操作' }));
      expect(screen.getByRole('menu')).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('disables disabled items', () => {
      render(
        <DropdownMenu
          label="操作"
          items={[{ id: 'x', label: '不可用', disabled: true, onSelect: vi.fn() }]}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: '操作' }));
      expect(screen.getByRole('menuitem', { name: '不可用' })).toBeDisabled();
    });
  });

  describe('Tooltip', () => {
    it('shows tooltip on hover', () => {
      render(
        <Tooltip label="这是提示">
          <button>悬停</button>
        </Tooltip>,
      );
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      fireEvent.mouseEnter(screen.getByText('悬停'));
      expect(screen.getByRole('tooltip')).toHaveTextContent('这是提示');
    });

    it('hides tooltip on mouse leave', () => {
      render(
        <Tooltip label="提示">
          <button>按钮</button>
        </Tooltip>,
      );
      fireEvent.mouseEnter(screen.getByText('按钮'));
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      fireEvent.mouseLeave(screen.getByText('按钮'));
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });
});

describe('base component disabled/loading/error states', () => {
  it('Button disables when loading', () => {
    render(<Button loading>提交</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('Button disables when disabled prop set', () => {
    render(<Button disabled>不可用</Button>);
    expect(screen.getByRole('button', { name: '不可用' })).toBeDisabled();
  });

  it('TextInput supports disabled', () => {
    render(<TextInput disabled aria-label="输入" />);
    expect(screen.getByLabelText('输入')).toBeDisabled();
  });

  it('TextInput supports aria-invalid via FormField error', () => {
    render(
      <div>
        <label htmlFor="f1">字段</label>
        <TextInput id="f1" aria-invalid="true" aria-errormessage="err1" />
        <span id="err1">必填</span>
      </div>,
    );
    const input = screen.getByLabelText('字段');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
