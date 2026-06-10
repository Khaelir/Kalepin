import React from 'react';
import type { UpdatesResponse, CompletedTour } from '../../api';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { Breadcrumb } from './Breadcrumb';
import { InlineTags } from './InlineTags';
import { PresenceStack } from './PresenceStack';
import { ActionCluster } from './ActionCluster';

interface PresenceUser {
  userId: string;
  email: string;
  color: string;
}

interface Props {
  activeFile: string | null;
  docContent: string | null | undefined;
  presenceUsers: PresenceUser[];
  onUserClick?: (userId: string) => void;
  updates: UpdatesResponse | null;
  changesActive: boolean;
  onOpenChanges: () => void;
  onOpenSearch: () => void;
  canShare: boolean;
  onShare: () => void;
  completedTours: CompletedTour[];
  onStartTour: (tourId: string) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  tweaksActive: boolean;
  onOpenTweaks: () => void;
  settingsActive: boolean;
  onOpenSettings: () => void;
  onDownloadVault: () => void;
}

export function TopBar(props: Props) {
  return (
    <header className="kp-topbar workspace-topbar">
      <WorkspaceSwitcher />

      {props.activeFile && (
        <>
          <Breadcrumb path={props.activeFile} />
          <InlineTags content={props.docContent} />
        </>
      )}

      <div className="kp-topbar-spacer" />

      <PresenceStack users={props.presenceUsers} onUserClick={props.onUserClick} />

      <ActionCluster
        updates={props.updates}
        changesActive={props.changesActive}
        onOpenChanges={props.onOpenChanges}
        onOpenSearch={props.onOpenSearch}
        canShare={props.canShare}
        onShare={props.onShare}
        completedTours={props.completedTours}
        onStartTour={props.onStartTour}
        theme={props.theme}
        onToggleTheme={props.onToggleTheme}
        tweaksActive={props.tweaksActive}
        onOpenTweaks={props.onOpenTweaks}
        settingsActive={props.settingsActive}
        onOpenSettings={props.onOpenSettings}
        onDownloadVault={props.onDownloadVault}
      />
    </header>
  );
}
