import type { CSSProperties } from 'react';

/**
 * Staff-only Material Symbols Rounded vocabulary.
 *
 * Keeping the semantic name here means page components never depend on an
 * icon library component or its geometry. The glyph itself is served by the
 * locally bundled subset font in staff-icons.css, with currentColor inherited
 * from the surrounding control.
 */
export type MoonwhiteIconName =
  | 'dashboard'
  | 'groups'
  | 'storefront'
  | 'event_available'
  | 'receipt_long'
  | 'currency_exchange'
  | 'account_balance'
  | 'manage_accounts'
  | 'monitoring'
  | 'support_agent'
  | 'menu'
  | 'more_horiz'
  | 'add'
  | 'close'
  | 'settings'
  | 'search'
  | 'filter_alt'
  | 'person'
  | 'chevron_left'
  | 'chevron_right'
  | 'person_add'
  | 'task_alt'
  | 'warning'
  | 'inventory_2';

export type MoonwhiteIconProps = Readonly<{
  name: MoonwhiteIconName;
  size?: number;
  filled?: boolean;
  className?: string;
}>;

export function MoonwhiteIcon({
  name,
  size = 24,
  filled = false,
  className,
}: MoonwhiteIconProps): React.JSX.Element {
  const style: CSSProperties = { '--moonwhite-icon-size': `${size}px` } as CSSProperties;
  const classes = ['moonwhite-icon', filled ? 'is-filled' : 'is-outline', className]
    .filter(Boolean)
    .join(' ');
  return (
    <span
      className={classes}
      data-icon={name}
      data-fill={filled ? '1' : '0'}
      style={style}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
