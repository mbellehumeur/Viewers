import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from '@ohif/ui-next';
import CastService from '../services/CastService';
import {
  castHeaderStatusEqual,
  type CastHeaderStatusState,
} from '../cast/cast-header-status';
import {
  DEFAULT_TOTAL_SEGMENTATOR_OPTIONS,
  normalizeTotalSegmentatorOptions,
  type TotalSegmentatorOptions,
} from '../cast/total-segmentator-options';
import {
  getSupportedQualityModesForTask,
  taskSelectItems,
  type TotalSegmentatorQuality,
} from '../cast/total-segmentator-tasks';

type TotalSegmentatorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  castService: CastService;
  wsConnected: boolean;
  totalSegmentatorAvailable: boolean;
};

function TotalSegmentatorDialog({
  open,
  onOpenChange,
  castService,
  wsConnected,
  totalSegmentatorAvailable,
}: TotalSegmentatorDialogProps) {
  const taskItems = useMemo(() => taskSelectItems(), []);
  const [form, setForm] = useState<TotalSegmentatorOptions>({
    ...DEFAULT_TOTAL_SEGMENTATOR_OPTIONS,
  });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [headerStatus, setHeaderStatus] = useState<CastHeaderStatusState>(() =>
    castService.getCastHeaderStatus()
  );
  const jobStatusRef = useRef<HTMLTextAreaElement>(null);

  const supportedQualityModes = useMemo(
    () => getSupportedQualityModesForTask(form.task),
    [form.task]
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm({ ...DEFAULT_TOTAL_SEGMENTATOR_OPTIONS });
    setSending(false);
    setSendError('');
    setHeaderStatus(castService.getCastHeaderStatus());
  }, [open, castService]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const sync = (next?: CastHeaderStatusState) => {
      const resolved = next ?? castService.getCastHeaderStatus();
      setHeaderStatus(prev =>
        castHeaderStatusEqual(prev, resolved) ? prev : resolved
      );
    };
    sync();
    const { unsubscribe } = castService.subscribe(CastService.EVENTS.STATUS_CHANGED, sync);
    return unsubscribe;
  }, [open, castService]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const textarea = jobStatusRef.current;
    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  }, [headerStatus.totalSegmentatorJobStatus, open, sending]);

  useEffect(() => {
    if (supportedQualityModes.includes(form.quality)) {
      return;
    }
    setForm(prev => ({ ...prev, quality: supportedQualityModes[0] }));
  }, [form.quality, supportedQualityModes]);

  const canSend = wsConnected && totalSegmentatorAvailable && !sending;

  const sendTooltip = sending
    ? 'Sending study URLs to Total Segmentator…'
    : !wsConnected
      ? 'Connect to the Cast hub'
      : !totalSegmentatorAvailable
        ? 'Total Segmentator is not available on this topic'
        : 'Send study URLs to Total Segmentator (no binary upload from OHIF)';

  const jobStatusText = useMemo(() => {
    const log = headerStatus.totalSegmentatorJobStatus;
    if (sending) {
      return log ? `${log}\nSending study URLs…` : 'Sending study URLs…';
    }
    return log;
  }, [headerStatus.totalSegmentatorJobStatus, sending]);

  const updateForm = <K extends keyof TotalSegmentatorOptions>(
    key: K,
    value: TotalSegmentatorOptions[K]
  ) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  async function onSend() {
    if (!canSend) {
      return;
    }
    setSending(true);
    setSendError('');
    castService.clearTotalSegmentatorJobStatus();

    try {
      const response = await castService.publishTotalSegmentatorSend(
        normalizeTotalSegmentatorOptions(form)
      );
      if (!response) {
        setSendError('Failed to send to Total Segmentator');
        return;
      }
      if (!response.ok) {
        setSendError(`Publish failed (HTTP ${response.status})`);
        return;
      }
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : 'Failed to send to Total Segmentator'
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        onPointerDownOutside={event => {
          if (sending || headerStatus.totalSegmentatorJobStatus) {
            event.preventDefault();
          }
        }}
        onEscapeKeyDown={event => {
          if (sending) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Total Segmentator</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Button
            type="button"
            disabled={!canSend}
            onClick={() => void onSend()}
            title={sendTooltip}
          >
            {sending ? 'Sending study URLs…' : 'Send'}
          </Button>

          {sendError ? (
            <p className="text-destructive text-sm" role="alert">
              {sendError}
            </p>
          ) : null}

          <div className="flex flex-col gap-1">
            <Label htmlFor="ts-job-status">Job Status</Label>
            <textarea
              id="ts-job-status"
              ref={jobStatusRef}
              readOnly
              rows={8}
              value={jobStatusText}
              className="border-input bg-muted text-foreground min-h-[10rem] w-full resize-y rounded-md border px-3 py-2 font-mono text-xs leading-relaxed"
              placeholder="Progress lines from Total Segmentator appear here after send."
            />
          </div>

          <Accordion type="single" collapsible>
            <AccordionItem value="advanced">
              <AccordionTrigger className="py-2 text-sm font-medium">
                Advanced
              </AccordionTrigger>
              <AccordionContent className="flex flex-col gap-3 pt-1">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="ts-task">Segmentation task</Label>
                  <Select
                    value={form.task}
                    onValueChange={value => updateForm('task', value)}
                  >
                    <SelectTrigger id="ts-task">
                      <SelectValue placeholder="Select task" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {taskItems.map(item => (
                        <SelectItem key={item.value} value={item.value}>
                          <span>{item.title}</span>
                          {item.description ? (
                            <span className="text-muted-foreground block text-xs">
                              {item.description}
                            </span>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <Label>Speed</Label>
                  <ToggleGroup
                    type="single"
                    value={form.quality}
                    onValueChange={value => {
                      if (value) {
                        updateForm('quality', value as TotalSegmentatorQuality);
                      }
                    }}
                    className="justify-start"
                  >
                    <ToggleGroupItem value="normal" aria-label="Normal quality">
                      Normal
                    </ToggleGroupItem>
                    {supportedQualityModes.includes('fast') ? (
                      <ToggleGroupItem value="fast" aria-label="Fast quality">
                        Fast
                      </ToggleGroupItem>
                    ) : null}
                    {supportedQualityModes.includes('faster') ? (
                      <ToggleGroupItem value="faster" aria-label="Faster quality">
                        Faster
                      </ToggleGroupItem>
                    ) : null}
                  </ToggleGroup>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.useStandardSegmentNames}
                    onCheckedChange={checked =>
                      updateForm('useStandardSegmentNames', checked === true)
                    }
                  />
                  Use standard segment names
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.cpu}
                    onCheckedChange={checked => updateForm('cpu', checked === true)}
                  />
                  Force to use CPU
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.robustCrop}
                    onCheckedChange={checked =>
                      updateForm('robustCrop', checked === true)
                    }
                  />
                  Robust cropping
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.removeSmallBlobs}
                    onCheckedChange={checked =>
                      updateForm('removeSmallBlobs', checked === true)
                    }
                  />
                  Remove small blobs
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.higherOrderResampling}
                    onCheckedChange={checked =>
                      updateForm('higherOrderResampling', checked === true)
                    }
                  />
                  Higher-order resampling
                </label>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <p className="text-muted-foreground text-xs leading-snug">
            Wasserthal J., Meyer M., , Hanns-Christian Breit H.C., Cyriac J., Shan Y.,
            Segeroth, M.: TotalSegmentator: robust segmentation of 104 anatomical
            structures in CT images.{' '}
            <a
              href="https://arxiv.org/abs/2208.05868"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              https://arxiv.org/abs/2208.05868
            </a>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default TotalSegmentatorDialog;
