import { eventTarget } from '@cornerstonejs/core';
import { Enums as csToolsEnums, UltrasoundPleuraBLineTool } from '@cornerstonejs/tools';
import { metaData } from '@cornerstonejs/core';

import FanShapeGeometryProvider from '../providers/FanShapeGeometryProvider';
import { getUSAnnotationStoreState } from '../stores/useUSAnnotationStore';
import { normalizeRaterName } from '../utils/usAnnotationJson';

export default function init({ servicesManager }) {
  const fanShapeGeometryProvider = new FanShapeGeometryProvider(servicesManager.services);
  metaData.addProvider(fanShapeGeometryProvider.get.bind(fanShapeGeometryProvider), 9999);

  eventTarget.addEventListener(csToolsEnums.Events.ANNOTATION_COMPLETED, (event: CustomEvent) => {
    const { annotation } = event.detail ?? {};
    if (annotation?.metadata?.toolName !== UltrasoundPleuraBLineTool.toolName) {
      return;
    }

    const selectedRater = getUSAnnotationStoreState().selectedRater;
    if (!selectedRater) {
      return;
    }

    annotation.metadata.rater = normalizeRaterName(selectedRater);
  });
}
