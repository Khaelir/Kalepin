import React from 'react';

interface Props {
  tag: string;
  /** When set, the pill is a button that opens the tag search. */
  onClick?: (tag: string) => void;
}

/** `#tag` pill shown in the top bar and the doc header. */
export function TagPill({ tag, onClick }: Props) {
  const label = (
    <>
      <span className="kp-tag-hash">#</span>
      {tag}
    </>
  );
  if (!onClick) return <span className="kp-tag">{label}</span>;
  return (
    <button
      type="button"
      className="kp-tag kp-tag-link"
      onClick={() => onClick(tag)}
      title={`Show notes tagged #${tag}`}
    >
      {label}
    </button>
  );
}
