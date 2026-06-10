import React from 'react';

export function WorkspaceSwitcher() {
  return (
    <div className="kp-brand" title="Kalepin">
      <span className="kp-brand-mark">K</span>
      <span className="kp-brand-text">Kalepin</span>
      <span className="kp-brand-ver">v{__APP_VERSION__}</span>
    </div>
  );
}
