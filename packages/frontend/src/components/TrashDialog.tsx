import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type { TrashItem } from '../api';
import { ConfirmModal } from './ConfirmModal';
import { Icon } from './Icon';
import {
  displayName,
  trashLocationLabel,
  formatDeletedAgo,
  daysUntilPurge,
} from '../utils/trash';

interface TrashDialogProps {
  onClose: () => void;
  /** An item came back; `path` is where it landed. */
  onRestored: (item: TrashItem, result: { path: string; kind: 'file' | 'folder' }) => void;
  onToast: (text: string, type?: 'info' | 'error' | 'success') => void;
}

type Confirm = { kind: 'purge'; item: TrashItem } | { kind: 'empty' };

/**
 * Lists the trash the user can see (shared vault + their own personal folder)
 * with Restore / Delete forever per item and Empty trash.
 */
export function TrashDialog({ onClose, onRestored, onToast }: TrashDialogProps) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [retentionDays, setRetentionDays] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const listing = await api.listTrash();
      setItems(listing.items);
      setRetentionDays(listing.retentionDays);
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message || 'Failed to load the trash');
      setItems([]);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // Escape closes the dialog, unless a confirmation is open on top of it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirm) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirm]);

  const restore = async (item: TrashItem) => {
    setBusyId(item.id);
    try {
      const result = await api.restoreTrashItem(item.id);
      setItems((prev) => prev?.filter((i) => i.id !== item.id) ?? null);
      onRestored(item, result);
    } catch (err) {
      onToast((err as Error).message || 'Failed to restore', 'error');
      void reload();
    } finally {
      setBusyId(null);
    }
  };

  const purge = async (item: TrashItem) => {
    setBusyId(item.id);
    try {
      await api.purgeTrashItem(item.id);
      setItems((prev) => prev?.filter((i) => i.id !== item.id) ?? null);
      onToast(`Deleted “${displayName(item.name)}” permanently`, 'info');
    } catch (err) {
      onToast((err as Error).message || 'Failed to delete permanently', 'error');
      void reload();
    } finally {
      setBusyId(null);
    }
  };

  const empty = async () => {
    try {
      const purged = await api.emptyTrash();
      onToast(purged === 1 ? 'Deleted 1 item permanently' : `Deleted ${purged} items permanently`, 'info');
    } catch (err) {
      onToast((err as Error).message || 'Failed to empty the trash', 'error');
    }
    void reload();
  };

  const purgeable = items?.filter((i) => i.canPurge).length ?? 0;
  const othersLeft = (items?.length ?? 0) - purgeable;

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div
          className="modal-card trash-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="trash-dialog-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="trash-dialog-header">
            <h3 id="trash-dialog-title" className="modal-title">Trash</h3>
            <button type="button" className="trash-dialog-close" aria-label="Close" onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
          </div>

          {items === null ? (
            <div className="trash-dialog-empty">Loading…</div>
          ) : loadError ? (
            <div className="trash-dialog-empty">{loadError}</div>
          ) : items.length === 0 ? (
            <div className="trash-dialog-empty">
              <Icon name="delete" size={28} />
              <span>The trash is empty.</span>
            </div>
          ) : (
            <ul className="trash-list">
              {items.map((item) => {
                const busy = busyId === item.id;
                return (
                  <li key={item.id} className="trash-item" data-trash-id={item.id}>
                    <Icon
                      name={item.kind === 'folder' ? 'folder' : 'description'}
                      size={18}
                      className="trash-item-icon"
                    />
                    <div className="trash-item-main">
                      <div className="trash-item-name" title={item.originalPath}>
                        {displayName(item.name)}
                        {item.kind === 'folder' && (
                          <span className="trash-item-count">
                            {item.itemCount === 1 ? '1 file' : `${item.itemCount} files`}
                          </span>
                        )}
                      </div>
                      <div className="trash-item-meta">
                        <span>{trashLocationLabel(item.originalFolder)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.deletedByEmail}</span>
                        <span aria-hidden="true">·</span>
                        <span title={new Date(item.deletedAt).toLocaleString()}>{formatDeletedAgo(item.deletedAt)}</span>
                      </div>
                    </div>
                    <div className="trash-item-actions">
                      <button
                        type="button"
                        className="modal-btn modal-btn-cancel trash-item-restore"
                        disabled={busy}
                        onClick={() => void restore(item)}
                      >
                        Restore
                      </button>
                      {item.canPurge && (
                        <button
                          type="button"
                          className="trash-item-purge"
                          disabled={busy}
                          title="Delete forever"
                          aria-label={`Delete ${displayName(item.name)} forever`}
                          onClick={() => setConfirm({ kind: 'purge', item })}
                        >
                          <Icon name="delete_forever" size={18} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="trash-dialog-footer">
            <span className="trash-dialog-hint">
              {retentionDays > 0
                ? `Items are deleted forever ${retentionDays} ${retentionDays === 1 ? 'day' : 'days'} after they were moved here.`
                : 'Items stay here until someone deletes them forever.'}
            </span>
            <button
              type="button"
              className="modal-btn modal-btn-danger"
              disabled={purgeable === 0}
              onClick={() => setConfirm({ kind: 'empty' })}
            >
              Empty trash
            </button>
          </div>
        </div>
      </div>

      {confirm?.kind === 'purge' && (
        <ConfirmModal
          title="Delete forever?"
          message={(() => {
            const days = daysUntilPurge(confirm.item.deletedAt, retentionDays);
            const name = displayName(confirm.item.name);
            return days === null
              ? `“${name}” will be deleted permanently. This can't be undone.`
              : `“${name}” will be deleted permanently now instead of in ${days} ${days === 1 ? 'day' : 'days'}. This can't be undone.`;
          })()}
          confirmLabel="Delete forever"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const item = confirm.item;
            setConfirm(null);
            void purge(item);
          }}
        />
      )}
      {confirm?.kind === 'empty' && (
        <ConfirmModal
          title="Empty trash?"
          message={
            othersLeft > 0
              ? `${purgeable} ${purgeable === 1 ? 'item' : 'items'} will be deleted permanently. ${othersLeft} deleted by others will stay. This can't be undone.`
              : `${purgeable} ${purgeable === 1 ? 'item' : 'items'} will be deleted permanently. This can't be undone.`
          }
          confirmLabel="Empty trash"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void empty();
          }}
        />
      )}
    </>
  );
}
