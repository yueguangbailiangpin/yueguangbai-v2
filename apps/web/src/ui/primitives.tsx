import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Search,
  X,
} from 'lucide-react';
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { NavLink } from 'react-router';

function classes(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

export function AppShell({
  children,
  className = '',
}: PropsWithChildren<{ className?: string }>): React.JSX.Element {
  return <div className={classes('app-shell', className)}>{children}</div>;
}

export function IdentityShell({
  identity,
  children,
  className = '',
}: PropsWithChildren<{
  identity: 'buyer' | 'seller' | 'staff';
  className?: string;
}>): React.JSX.Element {
  return <div
    className={classes('identity-shell', `identity-${identity}`, className)}
    data-identity={identity}
  >{children}</div>;
}

export function Button({
  loading = false,
  loadingLabel = '正在处理',
  disabled,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingLabel?: string;
}): React.JSX.Element {
  return <button
    {...props}
    className={classes('button', className)}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
  >{loading ? loadingLabel : children}</button>;
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  label: string;
}): React.JSX.Element {
  return <button
    {...props}
    type={props.type ?? 'button'}
    aria-label={label}
    className={classes('icon-button', className)}
  >{children}</button>;
}

export function TextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return <input {...props} className={classes('text-input', className)} />;
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return <select {...props} className={classes('select-input', className)}>
    {children}
  </select>;
}

export function SearchInput({
  label = '搜索',
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
}): React.JSX.Element {
  return <span className={classes('search-input', className)}>
    <Search aria-hidden="true" size={18} />
    <input {...props} type="search" aria-label={props['aria-label'] ?? label} />
  </span>;
}

export function Checkbox({
  label,
  stateLabel,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
  stateLabel?: string;
}): React.JSX.Element {
  return <label className={classes('checkbox', className)}>
    <input {...props} type="checkbox" />
    <span>{label}</span>
    {stateLabel ? <small>{stateLabel}</small> : null}
  </label>;
}

export function FormField({
  label,
  htmlFor,
  description,
  error,
  required = false,
  children,
}: PropsWithChildren<{
  label: string;
  htmlFor: string;
  description?: string;
  error?: string;
  required?: boolean;
}>): React.JSX.Element {
  const generated = useId();
  const descriptionId = description ? `${generated}-description` : undefined;
  const errorId = error ? `${generated}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ')
    || undefined;
  const control = Children.only(children);
  const prepared = isValidElement<Record<string, unknown>>(control)
    ? cloneElement(control, {
      id: htmlFor,
      'aria-describedby': describedBy,
      'aria-invalid': error ? true : undefined,
      'aria-errormessage': errorId,
      'aria-required': required || undefined,
    })
    : control;
  return <div className="form-field">
    <label htmlFor={htmlFor} data-required={required || undefined}>{label}</label>
    {description ? <p id={descriptionId} className="field-description">{description}</p> : null}
    {prepared}
    {error ? <p id={errorId} className="field-error">{error}</p> : null}
  </div>;
}

export function Card({
  children,
  className = '',
  as = 'section',
}: PropsWithChildren<{
  className?: string;
  as?: 'article' | 'section' | 'div';
}>): React.JSX.Element {
  const Element = as;
  return <Element className={classes('card', className)}>{children}</Element>;
}

export function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}): React.JSX.Element {
  return <Card className="metric-card">
    <p>{label}</p>
    <strong>{value}</strong>
    {detail ? <small>{detail}</small> : null}
  </Card>;
}

export function PageHeader({
  title,
  eyebrow,
  description,
  children,
}: PropsWithChildren<{
  title: string;
  eyebrow?: string;
  description?: string;
}>): React.JSX.Element {
  return <header className="page-header">
    <div>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </div>
    {children ? <div className="page-header-actions">{children}</div> : null}
  </header>;
}

export type SidebarItem = Readonly<{
  id: string;
  label: string;
  href: string;
  end?: boolean;
}>;

export function Sidebar({
  label,
  brand = '月光白',
  items,
  collapsed = false,
  onCollapsedChange,
}: {
  label: string;
  brand?: string;
  items: readonly SidebarItem[];
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}): React.JSX.Element {
  return <aside className={classes('sidebar', collapsed && 'is-collapsed')}>
    <div className="sidebar-brand"><strong>{brand}</strong>
      {onCollapsedChange ? <IconButton
        label={collapsed ? '展开侧边导航' : '收起侧边导航'}
        aria-expanded={!collapsed}
        onClick={() => onCollapsedChange(!collapsed)}
      >{collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}</IconButton> : null}
    </div>
    <nav aria-label={label}>{items.map((item) => <NavLink
      key={item.id}
      to={item.href}
      {...(item.end === undefined ? {} : { end: item.end })}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
    ><span aria-hidden={collapsed || undefined}>{
        collapsed ? item.label.slice(0, 1) : item.label
      }</span></NavLink>)}</nav>
  </aside>;
}

export function BottomNavigation({
  label,
  children,
}: PropsWithChildren<{ label: string }>): React.JSX.Element {
  return <nav className="bottom-nav" aria-label={label}>{children}</nav>;
}

export function StatusBadge({
  tone,
  children,
}: PropsWithChildren<{
  tone: 'neutral' | 'processing' | 'success' | 'warning' | 'danger' | 'expired' | 'conflict';
}>): React.JSX.Element {
  return <span className={classes('status-badge', `status-${tone}`)}>
    <span aria-hidden="true" className="status-dot" />{children}
  </span>;
}

export function DataTable({
  caption,
  children,
  className,
}: PropsWithChildren<{
  caption: string;
  className?: string;
}>): React.JSX.Element {
  return <div className={classes('data-table', className)} tabIndex={0}>
    <table><caption>{caption}</caption>{children}</table>
  </div>;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function useModalFocus(
  open: boolean,
  container: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  closeAllowed: () => boolean,
): void {
  const closeRef = useRef(onClose);
  const allowedRef = useRef(closeAllowed);
  closeRef.current = onClose;
  allowedRef.current = closeAllowed;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const target = container.current;
    const focusable = (): HTMLElement[] => target
      ? Array.from(target.querySelectorAll<HTMLElement>(FOCUSABLE))
      : [];
    (focusable()[0] ?? target)?.focus();
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && allowedRef.current()) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !target) return;
      const nodes = focusable();
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) {
        event.preventDefault();
        target.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('keydown', keydown);
      if (opener?.isConnected) opener.focus();
    };
  }, [container, open]);
}

export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
}: PropsWithChildren<{
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
}>): React.JSX.Element | null {
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModalFocus(open, panel, onClose, () => true);
  if (!open) return null;
  return <div className="overlay" role="presentation">
    <aside
      className="drawer"
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <header><div><h2 id={titleId}>{title}</h2>
        {description ? <p id={descriptionId}>{description}</p> : null}</div>
        <IconButton label="关闭详情" onClick={onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </header>
      <div className="overlay-content">{children}</div>
    </aside>
  </div>;
}

export function Dialog({
  open,
  title,
  description,
  busy = false,
  onClose,
  children,
}: PropsWithChildren<{
  open: boolean;
  title: string;
  description: string;
  busy?: boolean;
  onClose: () => void;
}>): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModalFocus(open, panel, onClose, () => !busy);
  if (!open) return null;
  return <div className="overlay dialog-overlay" role="presentation">
    <div
      className="dialog"
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-busy={busy || undefined}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      <div className="overlay-content">{children}</div>
    </div>
  </div>;
}

export type TabItem = Readonly<{
  id: string;
  label: string;
  panelId: string;
}>;

export function Tabs({
  label,
  items,
  activeId,
  onChange,
}: {
  label: string;
  items: readonly TabItem[];
  activeId: string;
  onChange: (id: string) => void;
}): React.JSX.Element {
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const move = (current: string, direction: number): void => {
    const index = items.findIndex((item) => item.id === current);
    const next = items[(index + direction + items.length) % items.length];
    if (next) {
      onChange(next.id);
      tabs.current.get(next.id)?.focus();
    }
  };
  return <div className="tabs" role="tablist" aria-label={label}>
    {items.map((item) => <button
      key={item.id}
      ref={(node) => {
        if (node) tabs.current.set(item.id, node);
        else tabs.current.delete(item.id);
      }}
      type="button"
      role="tab"
      id={`tab-${item.id}`}
      aria-selected={activeId === item.id}
      aria-controls={item.panelId}
      tabIndex={activeId === item.id ? 0 : -1}
      onClick={() => onChange(item.id)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault(); move(item.id, 1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault(); move(item.id, -1);
        } else if (event.key === 'Home') {
          event.preventDefault(); const first = items[0];
          if (first) { onChange(first.id); tabs.current.get(first.id)?.focus(); }
        } else if (event.key === 'End') {
          event.preventDefault(); const last = items.at(-1);
          if (last) { onChange(last.id); tabs.current.get(last.id)?.focus(); }
        }
      }}
    >{item.label}</button>)}
  </div>;
}

export function Pagination({
  currentPage,
  totalPages,
  onChange,
}: {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
}): React.JSX.Element {
  const pages = Array.from({ length: Math.max(0, totalPages) }, (_, index) => index + 1);
  return <nav className="pagination" aria-label="分页">
    <IconButton label="上一页" disabled={currentPage <= 1} onClick={() => onChange(currentPage - 1)}>
      <ChevronLeft aria-hidden="true" />
    </IconButton>
    {pages.map((page) => <button
      type="button"
      key={page}
      aria-label={`第 ${page} 页`}
      aria-current={page === currentPage ? 'page' : undefined}
      onClick={() => onChange(page)}
    >{page}</button>)}
    <IconButton label="下一页" disabled={currentPage >= totalPages} onClick={() => onChange(currentPage + 1)}>
      <ChevronRight aria-hidden="true" />
    </IconButton>
  </nav>;
}

export function Breadcrumb({
  items,
}: {
  items: readonly Readonly<{ label: string; href?: string }>[];
}): React.JSX.Element {
  return <nav className="breadcrumb" aria-label="面包屑">
    <ol>{items.map((item, index) => <li key={`${item.label}-${index}`}>
      {item.href && index < items.length - 1
        ? <a href={item.href}>{item.label}</a>
        : <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item.label}</span>}
    </li>)}</ol>
  </nav>;
}

export function Timeline({
  items,
}: {
  items: readonly Readonly<{
    title: string;
    detail?: string;
    status?: string;
  }>[];
}): React.JSX.Element {
  return <ol className="timeline">{items.map((item, index) => <li key={`${item.title}-${index}`}>
    <span aria-hidden="true" className="timeline-marker" />
    <div><strong>{item.title}</strong>{item.detail ? <p>{item.detail}</p> : null}
      {item.status ? <small>{item.status}</small> : null}</div>
  </li>)}</ol>;
}

export function Progress({
  label,
  value,
  max = 100,
}: {
  label: string;
  value?: number;
  max?: number;
}): React.JSX.Element {
  const bounded = value === undefined
    ? undefined
    : Math.min(max, Math.max(0, value));
  return <div className="progress-block">
    <div className="progress-label"><span>{label}</span>
      <span>{bounded === undefined ? '处理中' : `${Math.round((bounded / max) * 100)}%`}</span></div>
    <progress
      className={classes('progress', bounded === undefined && 'is-indeterminate')}
      aria-label={label}
      aria-valuemin={bounded === undefined ? undefined : 0}
      aria-valuemax={bounded === undefined ? undefined : max}
      aria-valuenow={bounded}
      max={max}
      value={bounded}
    />
  </div>;
}

export function Alert({
  tone = 'info',
  title,
  children,
}: PropsWithChildren<{
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
}>): React.JSX.Element {
  return <section
    className={classes('alert', `alert-${tone}`)}
    role={tone === 'danger' ? 'alert' : 'status'}
  >{title ? <strong>{title}</strong> : null}{children ? <div>{children}</div> : null}</section>;
}

export function Toast({
  message,
  tone = 'info',
  onClose,
}: {
  message: string;
  tone?: 'info' | 'success' | 'danger';
  onClose?: () => void;
}): React.JSX.Element {
  return <div
    className={classes('toast', `toast-${tone}`)}
    role={tone === 'danger' ? 'alert' : 'status'}
    aria-live={tone === 'danger' ? 'assertive' : 'polite'}
  ><span>{message}</span>{onClose ? <IconButton label="关闭通知" onClick={onClose}>
    <X aria-hidden="true" />
  </IconButton> : null}</div>;
}

function StateFrame({
  icon,
  title,
  children,
  role,
}: PropsWithChildren<{
  icon: ReactNode;
  title: string;
  role?: 'alert' | 'status';
}>): React.JSX.Element {
  return <section className="state" role={role}>
    <span className="state-icon" aria-hidden="true">{icon}</span>
    <h2>{title}</h2>{children}
  </section>;
}

export function EmptyState({
  title = '暂无内容',
  description = '当前没有可显示的内容。',
  children,
}: PropsWithChildren<{
  title?: string;
  description?: string;
}>): React.JSX.Element {
  return <StateFrame icon="—" title={title}>
    <p>{description}</p>{children}
  </StateFrame>;
}

export function LoadingState({
  label = '正在加载',
}: { label?: string }): React.JSX.Element {
  return <StateFrame icon="…" title={label} role="status">
    <Skeleton lines={3} announce={false} />
  </StateFrame>;
}

export function RequestIdDisplay({
  requestId,
  copyable = true,
}: {
  requestId: string | null;
  copyable?: boolean;
}): React.JSX.Element | null {
  if (!requestId) return null;
  return <p className="request-id"><span>请求编号：{requestId}</span>
    {copyable && typeof navigator.clipboard?.writeText === 'function'
      ? <IconButton label="复制请求编号" onClick={() => {
        void navigator.clipboard.writeText(requestId);
      }}><Copy aria-hidden="true" /></IconButton>
      : null}</p>;
}

export function ErrorState({
  title = '暂时无法完成请求',
  description = '请稍后重试。不会显示内部错误详情。',
  requestId = null,
  children,
}: PropsWithChildren<{
  title?: string;
  description?: string;
  requestId?: string | null;
}>): React.JSX.Element {
  return <StateFrame icon="!" title={title} role="alert">
    <p>{description}</p><RequestIdDisplay requestId={requestId} />{children}
  </StateFrame>;
}

export function PermissionDenied({
  requestId = null,
}: { requestId?: string | null }): React.JSX.Element {
  return <StateFrame icon="!" title="无权访问" role="alert">
    <p>您没有执行此操作所需的权限。会话仍然有效。</p>
    <RequestIdDisplay requestId={requestId} />
  </StateFrame>;
}

export function NotFound({
  requestId = null,
}: { requestId?: string | null }): React.JSX.Element {
  return <StateFrame icon="?" title="页面未找到">
    <p>此内容不存在，或当前身份无权了解它是否存在。</p>
    <RequestIdDisplay requestId={requestId} />
  </StateFrame>;
}

export function DependencyUnavailable({
  requestId = null,
}: { requestId?: string | null }): React.JSX.Element {
  return <ErrorState
    title="服务暂时不可用"
    description="依赖服务暂时没有响应，请稍后重试。"
    requestId={requestId}
  />;
}

export function Skeleton({
  lines = 1,
  label = '内容加载中',
  announce = true,
}: {
  lines?: number;
  label?: string;
  announce?: boolean;
}): React.JSX.Element {
  return <div
    className="skeleton"
    role={announce ? 'status' : undefined}
    aria-label={announce ? label : undefined}
    aria-hidden={announce ? undefined : true}
  >
    {Array.from({ length: Math.max(1, lines) }, (_, index) => <span
      key={index}
      aria-hidden="true"
    />)}
  </div>;
}
