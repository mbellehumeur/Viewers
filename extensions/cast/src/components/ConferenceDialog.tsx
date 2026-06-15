import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ohif/ui-next';
import CastService from '../services/CastService';
import {
  CAST_CONFERENCE_EXIT_ACK_MS,
  CAST_CONFERENCE_POLL_MS,
  CAST_CONFERENCE_TITLE_PRESETS,
  conferenceHostTopic,
  createCastConference,
  deleteCastConference,
  fetchCastConferences,
  fetchCastConferenceTopics,
  findActiveCastConference,
  isCastConferenceHost,
  normalizeConferenceParticipants,
  resolveCastConferenceState,
  type CastConferenceRecord,
} from '@kitware/vtk.js/Sources/IO/Core/CastClient';

type ConferenceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  castService: CastService;
  wsConnected: boolean;
};

function ConferenceDialog({
  open,
  onOpenChange,
  castService,
  wsConnected,
}: ConferenceDialogProps) {
  const session = castService.getSessionConfig();
  const hubEndpoint = castService.getHub().hub_endpoint ?? '';
  const sessionTopic = session.topic?.trim() ?? '';
  const subscriberName =
    castService.getCastHeaderStatus().subscriberName.trim();

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusKind, setStatusKind] = useState<'success' | 'error' | ''>('');
  const [availableTopics, setAvailableTopics] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [conferences, setConferences] = useState<CastConferenceRecord[]>([]);
  const [titlePreset, setTitlePreset] = useState('US annotations');
  const [customTitle, setCustomTitle] = useState('');

  const currentConference = useMemo(
    () =>
      findActiveCastConference(sessionTopic, subscriberName, conferences),
    [sessionTopic, subscriberName, conferences]
  );

  const isHost = useMemo(
    () =>
      currentConference
        ? isCastConferenceHost(sessionTopic, currentConference)
        : false,
    [currentConference, sessionTopic]
  );

  const showCustomTitle = titlePreset === 'other';
  const resolvedTitle =
    titlePreset === 'other' ? customTitle.trim() : titlePreset.trim();

  const refreshConferenceState = useCallback(async () => {
    const endpoint = hubEndpoint.trim();
    if (!endpoint) {
      setConferences([]);
      setAvailableTopics([]);
      return;
    }
    setLoading(true);
    try {
      const [topics, list] = await Promise.all([
        fetchCastConferenceTopics(endpoint),
        wsConnected ? fetchCastConferences(endpoint) : Promise.resolve([]),
      ]);
      setAvailableTopics(topics);
      setConferences(list);
      const match = findActiveCastConference(
        sessionTopic,
        subscriberName,
        list
      );
      if (!match) {
        setSelectedTopics(
          sessionTopic
            ? topics.filter(
                (entry) =>
                  entry === sessionTopic ||
                  entry.toLowerCase() === sessionTopic.toLowerCase()
              )
            : []
        );
      }
      if (wsConnected) {
        const { active, title, participants } = await resolveCastConferenceState(
          endpoint,
          sessionTopic,
          subscriberName
        );
        castService.setConferenceActive(active, title, participants);
      }
    } finally {
      setLoading(false);
    }
  }, [
    castService,
    hubEndpoint,
    sessionTopic,
    subscriberName,
    wsConnected,
  ]);

  useEffect(() => {
    if (!open) {
      setStatusMessage('');
      setStatusKind('');
      return;
    }
    void refreshConferenceState();
  }, [open, refreshConferenceState]);

  const handleCreate = async () => {
    const endpoint = hubEndpoint.trim();
    if (!wsConnected) {
      setStatusKind('error');
      setStatusMessage('Connect to the Cast hub first.');
      return;
    }
    if (!sessionTopic) {
      setStatusKind('error');
      setStatusMessage('Cast topic is required to host a conference.');
      return;
    }
    if (!resolvedTitle) {
      setStatusKind('error');
      setStatusMessage('Conference title is required.');
      return;
    }
    if (selectedTopics.length === 0) {
      setStatusKind('error');
      setStatusMessage('Select at least one attendee topic.');
      return;
    }

    setBusy(true);
    setStatusMessage('');
    setStatusKind('');
    try {
      await createCastConference(
        endpoint,
        sessionTopic,
        resolvedTitle,
        selectedTopics
      );
      setStatusKind('success');
      setStatusMessage('Conference created.');
      await refreshConferenceState();
    } catch (error) {
      setStatusKind('error');
      setStatusMessage(
        error instanceof Error ? error.message : 'Failed to create conference.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleExit = async () => {
    if (!currentConference) {
      return;
    }
    const hostTopic = conferenceHostTopic(currentConference);
    if (!hostTopic) {
      return;
    }
    const hostAction = isCastConferenceHost(sessionTopic, currentConference);

    setBusy(true);
    setStatusMessage('');
    setStatusKind('');
    try {
      await deleteCastConference(
        hubEndpoint.trim(),
        hostTopic,
        hostAction ? undefined : sessionTopic
      );
      await refreshConferenceState();
      setStatusKind('success');
      setStatusMessage(hostAction ? 'Conference ended.' : 'Left conference.');
      await new Promise((resolve) => {
        setTimeout(resolve, CAST_CONFERENCE_EXIT_ACK_MS);
      });
      onOpenChange(false);
    } catch (error) {
      setStatusKind('error');
      setStatusMessage(
        error instanceof Error ? error.message : 'Failed to update conference.'
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleTopic = (value: string, checked: boolean) => {
    setSelectedTopics((current) => {
      if (checked) {
        return current.includes(value) ? current : [...current, value];
      }
      return current.filter((entry) => entry !== value);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="text-foreground max-h-[min(90vh,22rem)] max-w-[336px] gap-2 overflow-y-auto p-[18px]">
        <DialogHeader className="space-y-0">
          <DialogTitle className="text-highlight text-xl font-bold leading-tight">
            Conferencing
          </DialogTitle>
        </DialogHeader>

        {statusMessage ? (
          <p
            className={
              statusKind === 'error'
                ? 'text-destructive mb-2 text-xs leading-snug'
                : 'mb-2 text-xs leading-snug text-green-400'
            }
            role="alert"
          >
            {statusMessage}
          </p>
        ) : null}

        {currentConference ? (
          <div className="text-foreground space-y-2">
            <div className="text-xs font-semibold">Manage conference</div>
            <div className="text-foreground space-y-1 text-xs leading-snug">
              <div>
                <strong>Title:</strong> {currentConference.title || 'N/A'}
              </div>
              <div>
                <strong>Host topic:</strong>{' '}
                {conferenceHostTopic(currentConference) || 'N/A'}
              </div>
              <div>
                <strong>Users:</strong>{' '}
                {(() => {
                  const attendees = Array.isArray(currentConference.topics)
                    ? currentConference.topics
                        .map((value) => String(value).trim())
                        .filter(Boolean)
                    : [];
                  const host = conferenceHostTopic(currentConference);
                  const users = host
                    ? [host, ...attendees.filter((entry) => entry !== host)]
                    : attendees;
                  return users.length ? users.join(', ') : 'None';
                })()}
              </div>
            </div>
            <Button
              className="mb-2 w-full"
              disabled={!wsConnected || busy}
              onClick={() => void handleExit()}
            >
              {busy
                ? isHost
                  ? 'Ending…'
                  : 'Leaving…'
                : isHost
                  ? 'End conference'
                  : 'Leave conference'}
            </Button>
          </div>
        ) : (
          <div className="text-foreground space-y-2">
            <div className="space-y-1">
              <Label
                htmlFor="conference-title"
                className="text-foreground text-xs font-semibold"
              >
                Conference title
              </Label>
              <Select value={titlePreset} onValueChange={setTitlePreset}>
                <SelectTrigger id="conference-title" className="h-9 text-sm">
                  <SelectValue placeholder="Select a conference title" />
                </SelectTrigger>
                <SelectContent>
                  {CAST_CONFERENCE_TITLE_PRESETS.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {preset}
                    </SelectItem>
                  ))}
                  <SelectItem value="other">Other…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {showCustomTitle ? (
              <div className="space-y-1">
                <Label
                  htmlFor="conference-custom-title"
                  className="text-foreground text-xs font-semibold"
                >
                  Custom title
                </Label>
                <Input
                  id="conference-custom-title"
                  className="h-9 text-sm"
                  placeholder="Enter conference title"
                  value={customTitle}
                  onChange={(event) => setCustomTitle(event.target.value)}
                />
              </div>
            ) : null}
            <div className="space-y-1">
              <div className="text-foreground text-xs font-semibold">Users</div>
              {loading ? (
                <div className="text-muted-foreground text-xs italic">
                  Loading users…
                </div>
              ) : availableTopics.length === 0 ? (
                <div className="text-muted-foreground text-xs italic">
                  No users available
                </div>
              ) : (
                <div className="border-input bg-background max-h-[132px] space-y-1 overflow-y-auto rounded-md border p-2">
                  {availableTopics.map((entry) => {
                    const topicId = `cast-conference-topic-${entry.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                    return (
                      <div
                        key={entry}
                        className="flex items-center gap-2"
                      >
                        <Checkbox
                          id={topicId}
                          checked={selectedTopics.includes(entry)}
                          onCheckedChange={(checked) =>
                            toggleTopic(entry, checked === true)
                          }
                        />
                        <Label
                          htmlFor={topicId}
                          className="text-foreground cursor-pointer text-xs font-normal leading-snug"
                        >
                          {entry}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <Button
              className="mb-2 w-full"
              disabled={!wsConnected || busy || loading}
              onClick={() => void handleCreate()}
            >
              {busy ? 'Creating…' : 'Create conference'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ConferenceDialog;
