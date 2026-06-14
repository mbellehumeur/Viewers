import React, { useEffect, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icons,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import CastService from '../services/CastService';
import TotalSegmentatorDialog from './TotalSegmentatorDialog';
import {
  castHeaderStatusEqual,
  type CastHeaderStatusState,
} from '../cast/cast-header-status';
import {
  CAST_CONFERENCE_POPUP_SIZE,
  openCastHubPopup,
  resolveCastConferenceClientUrl,
  resolveCastHubAdminUrl,
} from '../cast/cast-hub-links';

function castConnectionIconStyle(
  wsState: string,
  conferenceActive: boolean
): {
  colorClass: string;
  iconClass: string;
  showDisconnectedMark: boolean;
  pulse: boolean;
  conferencePulse: boolean;
} {
  if (wsState === 'connected') {
    return {
      colorClass: 'text-green-400',
      iconClass: 'h-5 w-5',
      showDisconnectedMark: false,
      pulse: false,
      conferencePulse: conferenceActive,
    };
  }
  if (wsState === 'connecting') {
    return {
      colorClass: 'text-yellow-400',
      iconClass: 'h-5 w-5',
      showDisconnectedMark: false,
      pulse: true,
      conferencePulse: false,
    };
  }
  if (wsState === 'error' || wsState === 'disconnected') {
    return {
      colorClass: 'text-red-400',
      iconClass: 'h-5 w-5 opacity-70',
      showDisconnectedMark: true,
      pulse: false,
      conferencePulse: false,
    };
  }
  return {
    colorClass: 'text-muted-foreground',
    iconClass: 'h-5 w-5 opacity-50',
    showDisconnectedMark: true,
    pulse: false,
    conferencePulse: false,
  };
}

function CastHeaderStatus() {
  const { servicesManager } = useSystem();
  const castService = servicesManager.services.castService as CastService | undefined;
  const [status, setStatus] = useState<CastHeaderStatusState | null>(() =>
    castService ? castService.getCastHeaderStatus() : null
  );
  const [totalSegmentatorDialogOpen, setTotalSegmentatorDialogOpen] = useState(false);

  const activeDisplaySets =
    servicesManager.services.displaySetService?.activeDisplaySets ?? [];
  const hasOpenStudy = activeDisplaySets.some(
    (displaySet: { StudyInstanceUID?: string }) => !!displaySet.StudyInstanceUID?.trim()
  );

  useEffect(() => {
    if (!castService) {
      return;
    }
    const sync = (next?: CastHeaderStatusState) => {
      const resolved = next ?? castService.getCastHeaderStatus();
      setStatus(prev => (prev && castHeaderStatusEqual(prev, resolved) ? prev : resolved));
    };
    sync();
    const { unsubscribe } = castService.subscribe(CastService.EVENTS.STATUS_CHANGED, sync);
    return unsubscribe;
  }, [castService]);

  if (!status || !castService) {
    return null;
  }

  const wsConnected = status.wsState === 'connected';
  const canSendToTotalSegmentator =
    hasOpenStudy && wsConnected && status.totalSegmentatorAvailable;

  const totalSegmentatorMenuSubtitle = (() => {
    if (!wsConnected) {
      return undefined;
    }
    if (!status.totalSegmentatorAvailable) {
      return 'Total Segmentator not available';
    }
    if (!hasOpenStudy) {
      return 'Open a study first';
    }
    return undefined;
  })();

  const { colorClass, iconClass, showDisconnectedMark, pulse, conferencePulse } =
    castConnectionIconStyle(status.wsState, status.conferenceActive);

  const openHubAdminPortal = () => {
    const hubEndpoint = castService.getHub().hub_endpoint ?? '';
    openCastHubPopup(resolveCastHubAdminUrl(hubEndpoint), 'castAdminPortalWindow');
  };

  const openConferenceClient = () => {
    const hubEndpoint = castService.getHub().hub_endpoint ?? '';
    const session = castService.getSessionConfig();
    openCastHubPopup(
      resolveCastConferenceClientUrl(hubEndpoint, {
        topic: session.topic,
        subscriberName: session.subscriberName,
        theme: 'volview',
      }),
      'castConferenceClientWindow',
      CAST_CONFERENCE_POPUP_SIZE
    );
  };

  const openTotalSegmentatorDialog = () => {
    if (!canSendToTotalSegmentator) {
      return;
    }
    setTotalSegmentatorDialogOpen(true);
  };

  return (
    <>
      <style>{`
        @keyframes cast-conference-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .cast-conference-pulse {
          animation: cast-conference-pulse 1.2s ease-in-out infinite;
        }
      `}</style>
      <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mr-1 inline-flex items-center border-0 bg-transparent p-0"
              aria-label="Cast hub"
              aria-haspopup="menu"
            >
              <span
                className={`relative inline-flex items-center ${colorClass} ${pulse ? 'animate-pulse' : ''} ${conferencePulse ? 'cast-conference-pulse' : ''}`}
              >
                <Icons.Radio className={iconClass} />
                {showDisconnectedMark ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 top-1/2 h-[130%] w-[2px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-current opacity-90"
                  />
                ) : null}
              </span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="flex flex-col gap-0.5 text-xs">
            {status.topic ? <div>Topic: {status.topic}</div> : null}
            <div>{status.hubLabel}</div>
            <div>{status.statusText}</div>
            {status.conferenceActive ? (
              <div>
                {status.conferenceTitle
                  ? `Conference: ${status.conferenceTitle}`
                  : 'Conference active'}
              </div>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={!canSendToTotalSegmentator}
          onSelect={openTotalSegmentatorDialog}
          className="flex flex-col items-start gap-0.5"
        >
          <span>Total Segmentator</span>
          {totalSegmentatorMenuSubtitle ? (
            <span className="text-muted-foreground text-xs">{totalSegmentatorMenuSubtitle}</span>
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={openConferenceClient}>Conferencing</DropdownMenuItem>
        <DropdownMenuItem onSelect={openHubAdminPortal}>Hub</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <TotalSegmentatorDialog
      open={totalSegmentatorDialogOpen}
      onOpenChange={setTotalSegmentatorDialogOpen}
      castService={castService}
      wsConnected={wsConnected}
      totalSegmentatorAvailable={status.totalSegmentatorAvailable}
    />
    </>
  );
}

export default CastHeaderStatus;
