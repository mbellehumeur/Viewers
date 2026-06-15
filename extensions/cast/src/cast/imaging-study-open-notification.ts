import {
  extractVolviewSampleId,
  normalizeImagingStudyContext,
  resolveImagingStudyOpenPlan,
  type CastMessage,
} from '@kitware/vtk.js/Sources/IO/Core/CastClient';
import type { CastEvent, ServicesManagerLike } from './types';

function publisherLabel(message: CastMessage): string {
  const subscriberName = message['subscriber.name'];
  if (typeof subscriberName === 'string' && subscriberName.trim()) {
    return subscriberName.trim();
  }
  const productName = message['subscriber.product.name'];
  if (typeof productName === 'string' && productName.trim()) {
    return productName.trim();
  }
  return '';
}

export function buildImagingStudyOpenNotificationMessage(
  event: CastEvent,
  message: CastMessage
): string {
  const normalized = normalizeImagingStudyContext(event.context);
  const plan = resolveImagingStudyOpenPlan(normalized);
  const from = publisherLabel(message);
  const parts: string[] = [];

  if (plan?.mode === 'dicomweb' || plan?.mode === 'idc') {
    parts.push(`Study ${plan.studyInstanceUID}`);
    if (plan.seriesInstanceUID) {
      parts.push(`series ${plan.seriesInstanceUID}`);
    }
  } else if (plan?.mode === 'files') {
    parts.push(plan.studyId || `${plan.files.length} file(s)`);
  } else {
    const sampleId = extractVolviewSampleId(normalized);
    if (sampleId) {
      parts.push(sampleId);
    } else {
      parts.push('Opening imaging study…');
    }
  }

  if (from) {
    parts.push(`from ${from}`);
  }

  return parts.join(' · ');
}

export type ImagingStudyOpenResult = {
  event: CastEvent;
  message: CastMessage;
};

export function showImagingStudyOpenLoadingNotification(
  servicesManager: ServicesManagerLike,
  promise: Promise<ImagingStudyOpenResult | null>
): void {
  const uiNotificationService = servicesManager.services.uiNotificationService;
  if (!uiNotificationService?.show) {
    return;
  }

  uiNotificationService.show({
    title: 'Imaging study open',
    message: 'Downloading and opening imaging study…',
    promise,
    promiseMessages: {
      loading: 'Downloading and opening imaging study…',
      success: data => {
        if (!data?.event) {
          return 'Imaging study open completed';
        }
        return buildImagingStudyOpenNotificationMessage(data.event, data.message);
      },
      error: error => {
        const detail =
          error instanceof Error ? error.message : String(error ?? '').trim();
        return detail || 'Failed to open imaging study';
      },
    },
    id: 'cast-imagingstudy-open',
    allowDuplicates: false,
    duration: 4000,
  });
}
