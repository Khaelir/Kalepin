import React from 'react';
import { ENCRYPTED_FOLDER_LABEL } from '../../crypto/path-predicates';

interface Props {
  path: string;
}

/**
 * Hide the internal `_users/{email}` and `_secure/` segments behind their
 * user-facing labels. The on-disk path is unchanged; only the UI rewrites it.
 *   - `_users` is dropped entirely (the segment immediately after is always
 *     the owner's email, which is the natural root of "your space").
 *   - `_secure` is rendered as "Encrypted Folder".
 */
function rewriteSegments(segments: string[]): string[] {
  if (segments[0] !== '_users') return segments;
  const [, ...rest] = segments;
  return rest.map((seg) => (seg === '_secure' ? ENCRYPTED_FOLDER_LABEL : seg));
}

export function Breadcrumb({ path }: Props) {
  const rawSegments = path.split('/').filter(Boolean);
  if (rawSegments.length === 0) return null;
  const segments = rewriteSegments(rawSegments);
  return (
    <nav className="kp-breadcrumb" aria-label="Document path">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <React.Fragment key={i}>
            {i > 0 && <span className="kp-bc-sep" aria-hidden="true">·</span>}
            <span className={`kp-bc-chip${isLast ? ' kp-bc-current' : ''}`}>{seg.replace(/\.md$/, '')}</span>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
