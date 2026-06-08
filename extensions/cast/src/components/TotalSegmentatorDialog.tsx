import React, { useEffect, useMemo, useState } from 'react';
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
  ProgressLoadingBar,
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
};

function TotalSegmentatorDialog({
  open,
  onOpenChange,
  castService,
  wsConnected,
}: TotalSegmentatorDialogProps) {
  const taskItems = useMemo(() => taskSelectItems(), []);
  const [form, setForm] = useState<TotalSegmentatorOptions>({
    ...DEFAULT_TOTAL_SEGMENTATOR_OPTIONS,
  });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

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
  }, [open]);

  useEffect(() => {
    if (supportedQualityModes.includes(form.quality)) {
      return;
    }
    setForm(prev => ({ ...prev, quality: supportedQualityModes[0] }));
  }, [form.quality, supportedQualityModes]);

  const canSend = wsConnected && !sending;

  const sendTooltip = sending
    ? 'Sending…'
    : wsConnected
      ? 'Send original files to Total Segmentator (URL-only, no binary attach)'
      : 'Connect to the Cast hub';

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
      onOpenChange(false);
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
      <DialogContent className="max-w-md">
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
            {sending ? 'Sending…' : 'Send'}
          </Button>

          {sending ? <ProgressLoadingBar /> : null}

          {sendError ? (
            <p className="text-destructive text-sm" role="alert">
              {sendError}
            </p>
          ) : null}

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
