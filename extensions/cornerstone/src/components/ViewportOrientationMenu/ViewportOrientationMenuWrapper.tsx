import React, { ReactNode } from 'react';
import { useSystem } from '@ohif/core';
import ViewportOrientationMenu from './ViewportOrientationMenu';
import Viewport3DCompassMenu from './Viewport3DCompassMenu';
import { useViewportDisplaySets } from '../../hooks/useViewportDisplaySets';
import { isVolume3DViewportType } from '../../utils/getLegacyViewportType';

export function ViewportOrientationMenuWrapper(
  props: withAppTypes<{
    viewportId: string;
    location: string;
    isOpen?: boolean;
    onOpen?: () => void;
    onClose?: () => void;
    iconSize?: number;
    disabled?: boolean;
  }>
): ReactNode {
  const { viewportId } = props;
  const { viewportDisplaySets } = useViewportDisplaySets(viewportId);
  const { servicesManager } = useSystem();
  const viewport =
    servicesManager.services.cornerstoneViewportService.getCornerstoneViewport(viewportId);
  const isVolume3D = isVolume3DViewportType(viewport);

  if (!viewportDisplaySets.length) {
    return null;
  }

  if (isVolume3D) {
    return <Viewport3DCompassMenu {...props} />;
  }

  return <ViewportOrientationMenu {...props} displaySets={viewportDisplaySets} />;
}
