import React, { ReactNode } from 'react';
import ViewportRenderModeMenu from './ViewportRenderModeMenu';

export function ViewportRenderModeMenuWrapper(
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
  return <ViewportRenderModeMenu {...props} />;
}
