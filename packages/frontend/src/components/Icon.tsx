import React from 'react';

interface IconProps {
  name: string;
  size?: number;
  fill?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

export function Icon({ name, size = 18, fill = false, className, style, title }: IconProps) {
  const cls = className ? `material-symbols-rounded ${className}` : 'material-symbols-rounded';
  return (
    <span
      className={cls}
      title={title}
      aria-hidden={title ? undefined : true}
      style={{
        fontSize: size,
        lineHeight: 1,
        flexShrink: 0,
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`,
        ...style,
      }}
    >
      {name}
    </span>
  );
}
