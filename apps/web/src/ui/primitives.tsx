import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type PropsWithChildren } from 'react';
import { X } from 'lucide-react';

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className={`button ${props.className ?? ''}`.trim()} />; }
export function IconButton(props: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className={`icon-button ${props.className ?? ''}`.trim()} />; }
export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`text-input ${props.className ?? ''}`.trim()} />; }
export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) { return <section className={`card ${className}`}>{children}</section>; }
export function PageHeader({ title, children }: PropsWithChildren<{ title: string }>) { return <header className="page-header"><h1>{title}</h1>{children}</header>; }
export function LoadingState({ label = '正在加载' }: { label?: string }) { return <p className="state" role="status">{label}</p>; }
export function RequestIdDisplay({ requestId }: { requestId: string | null }) { return requestId ? <p className="request-id">请求编号：{requestId}</p> : null; }
export function ErrorState({ title = '暂时无法完成请求', requestId = null }: { title?: string; requestId?: string | null }) { return <section className="state" role="alert"><h2>{title}</h2><p>请稍后重试。不会显示内部错误详情。</p><RequestIdDisplay requestId={requestId} /></section>; }
export function PermissionDenied() { return <section className="state" role="alert"><h2>无权访问</h2><p>此内容不可访问。</p></section>; }
export function NotFound() { return <section className="state"><h2>页面未找到</h2><p>请从可用导航继续。</p></section>; }
export function DependencyUnavailable() { return <ErrorState title="服务暂时不可用" />; }

export function Drawer({ open, title, onClose, children }: PropsWithChildren<{ open: boolean; title: string; onClose: () => void }>) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="overlay" role="presentation"><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}><header><h2 id={titleId}>{title}</h2><button ref={closeRef} className="icon-button" aria-label="关闭详情" onClick={onClose}><X aria-hidden="true" /></button></header>{children}</aside></div>;
}

export function Dialog({ open, title, description, busy = false, onClose, children }: PropsWithChildren<{ open: boolean; title: string; description: string; busy?: boolean; onClose: () => void }>) {
  const dialog = useRef<HTMLDivElement>(null); const opener = useRef<HTMLElement | null>(null); const titleId = useId(); const descriptionId = useId();
  useEffect(() => { if (!open) return; opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; const first = dialog.current?.querySelector<HTMLElement>('button:not([disabled])'); first?.focus(); const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); if (event.key === 'Tab' && dialog.current) { const nodes = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled])')); const firstNode = nodes[0]; const lastNode = nodes[nodes.length - 1]; if (firstNode && lastNode && ((event.shiftKey && document.activeElement === firstNode) || (!event.shiftKey && document.activeElement === lastNode))) { event.preventDefault(); (event.shiftKey ? lastNode : firstNode).focus(); } } }; window.addEventListener('keydown', key); return () => { window.removeEventListener('keydown', key); opener.current?.focus(); }; }, [open, busy, onClose]);
  if (!open) return null;
  return <div className="overlay" role="presentation"><div className="drawer" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p>{children}</div></div>;
}
