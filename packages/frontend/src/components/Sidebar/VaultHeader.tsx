import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { ENCRYPTED_FOLDER_LABEL } from '../../crypto/path-predicates';

interface Props {
  /** Default folder where ⌘N or the main face will create. Empty string = vault root. */
  defaultFolder: string;
  /** Click on the main "New note" face — creates immediately at defaultFolder. */
  onCreateAtDefault: () => void;
  /** Click on the chevron — opens the picker in note-mode. */
  onOpenNotePicker: (anchorEl: HTMLElement) => void;
  /** Click on the right-side folder-icon button — opens the picker in folder-mode. */
  onOpenFolderPicker: (anchorEl: HTMLElement) => void;
}

const FIRST_TIME_KEY = 'kalepin-create-tip-seen';

export function VaultHeader({
  defaultFolder,
  onCreateAtDefault,
  onOpenNotePicker,
  onOpenFolderPicker,
}: Props) {
  const chevronRef = useRef<HTMLButtonElement>(null);
  const folderBtnRef = useRef<HTMLButtonElement>(null);
  const [showTip, setShowTip] = useState(false);

  useEffect(() => {
    try {
      if (!sessionStorage.getItem(FIRST_TIME_KEY)) {
        setShowTip(true);
      }
    } catch { /* private mode */ }
  }, []);

  const dismissTip = () => {
    setShowTip(false);
    try { sessionStorage.setItem(FIRST_TIME_KEY, '1'); } catch { /* ignore */ }
  };

  // Hide the on-disk segment names (`_secure`, `_users`) from the user-facing
  // hint. The split button shows where ⌘N will create, so the label has to
  // match what the user sees in the file tree.
  const rawLeaf = defaultFolder ? defaultFolder.split('/').pop()! : '';
  const leaf = !rawLeaf
    ? 'Vault root'
    : rawLeaf === '_secure'
      ? ENCRYPTED_FOLDER_LABEL
      : rawLeaf;
  const subtitle = `in ${leaf}`;
  const prettifyDefault = (raw: string): string => {
    if (!raw) return 'Vault root';
    if (!raw.startsWith('_users/')) return raw;
    const rest = raw.slice('_users/'.length);
    return '/' + rest
      .replace(/\/_secure$/, `/${ENCRYPTED_FOLDER_LABEL}`)
      .replace(/\/_secure\//g, `/${ENCRYPTED_FOLDER_LABEL}/`);
  };
  const fullPath = prettifyDefault(defaultFolder);

  return (
    <div className="kp-sidebar-head">
      <div className="kp-newbtn-split" title={`New note will be created in ${fullPath}`}>
        <button
          type="button"
          className="kp-newbtn-split__main"
          onClick={() => { dismissTip(); onCreateAtDefault(); }}
        >
          <Icon name="add" size={16} />
          <span className="kp-newbtn-split__labels">
            <span className="kp-newbtn-split__title">New note</span>
            <span className="kp-newbtn-split__subtitle" title={fullPath}>{subtitle}</span>
          </span>
        </button>
        <button
          ref={chevronRef}
          type="button"
          className="kp-newbtn-split__chevron"
          aria-label="Choose folder"
          title="Choose where to create"
          onClick={() => {
            dismissTip();
            if (chevronRef.current) onOpenNotePicker(chevronRef.current);
          }}
        >
          <Icon name="keyboard_arrow_down" size={14} />
        </button>
        {showTip && (
          <div className="kp-newbtn-split__tip">
            <span>Choose where to create — or hover any folder in the tree.</span>
            <button type="button" className="kp-newbtn-split__tip-close" onClick={dismissTip} aria-label="Dismiss">
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
      </div>
      <button
        ref={folderBtnRef}
        type="button"
        className="kp-newbtn-secondary"
        title="New folder"
        aria-label="New folder"
        onClick={() => {
          if (folderBtnRef.current) onOpenFolderPicker(folderBtnRef.current);
        }}
      >
        <Icon name="create_new_folder" size={16} />
      </button>
    </div>
  );
}
