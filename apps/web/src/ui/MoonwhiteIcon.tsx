import type { CSSProperties } from 'react';

/**
 * Shared semantic adapter for the locally bundled Material Symbols Rounded
 * SVG subset. Consumers choose a stable semantic name; geometry and the
 * outline/filled pair remain an implementation detail of this component.
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

const localSvgSources = import.meta.glob('../assets/material-symbols-rounded/*.svg', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

const pathCache = new Map<string, readonly string[]>();

function iconSourceKey(name: MoonwhiteIconName, filled: boolean): string {
  return `../assets/material-symbols-rounded/${name}-${filled ? 'filled' : 'outline'}.svg`;
}

function iconPaths(name: MoonwhiteIconName, filled: boolean): readonly string[] {
  const sourceKey = iconSourceKey(name, filled);
  const cached = pathCache.get(sourceKey);
  if (cached) return cached;
  const source = localSvgSources[sourceKey];
  if (!source) {
    throw new Error(`Missing local Material Symbols Rounded asset: ${sourceKey}`);
  }
  const paths: string[] = [];
  for (const match of source.matchAll(/<path\b[^>]*\bd="([^"]+)"/gu)) {
    const path = match[1];
    if (path) paths.push(path);
  }
  if (paths.length === 0) {
    throw new Error(`Material Symbols Rounded asset has no path data: ${sourceKey}`);
  }
  pathCache.set(sourceKey, paths);
  return paths;
}

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
  const paths = iconPaths(name, filled);
  return (
    <span
      className={classes}
      data-icon={name}
      data-fill={filled ? '1' : '0'}
      style={style}
      aria-hidden="true"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        {paths.map((path) => (
          <path
            key={path}
            d={path}
            transform="matrix(0.025 0 0 0.025 0 24)"
            fill="currentColor"
          />
        ))}
      </svg>
    </span>
  );
}
