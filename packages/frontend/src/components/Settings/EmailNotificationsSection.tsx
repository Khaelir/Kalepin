import React, { useEffect, useState } from 'react';
import * as api from '../../api';
import type { EmailNotificationPreference } from '../../api';

const OPTIONS: { value: EmailNotificationPreference; label: string; desc: string }[] = [
  { value: 'all', label: 'All activity', desc: 'Mentions, replies in your threads, and notes shared with you.' },
  { value: 'mentions', label: 'Mentions and shares', desc: 'Skip emails about replies in threads.' },
  { value: 'none', label: 'None', desc: 'No notification emails.' },
];

export function EmailNotificationsSection() {
  const [pref, setPref] = useState<EmailNotificationPreference | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getEmailNotificationPreference()
      .then(setPref)
      .catch(() => setError('Failed to load your email preference'));
  }, []);

  const handleChange = async (next: EmailNotificationPreference) => {
    const previous = pref;
    setPref(next);
    setSaving(true);
    setError(null);
    try {
      await api.setEmailNotificationPreference(next);
    } catch {
      setPref(previous);
      setError('Failed to save your email preference');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Email notifications</h2>
      <p className="settings-section-desc">
        Choose which notifications are also sent by email. Everything still shows up under the bell in the app.
      </p>
      {error && <div className="settings-error">{error}</div>}
      {pref === null && !error ? (
        <div className="connection-list-empty">Loading…</div>
      ) : (
        <div className="kp-email-prefs" role="radiogroup" aria-label="Email notifications">
          {OPTIONS.map((opt) => (
            <label key={opt.value} className={`kp-email-pref${pref === opt.value ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="email-notifications"
                value={opt.value}
                checked={pref === opt.value}
                disabled={saving}
                onChange={() => handleChange(opt.value)}
              />
              <span className="kp-email-pref-text">
                <span className="kp-email-pref-label">{opt.label}</span>
                <span className="kp-email-pref-desc">{opt.desc}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
