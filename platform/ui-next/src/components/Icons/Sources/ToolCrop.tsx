import React from 'react';
import type { IconProps } from '../types';

/** Crop / clip box with corner handles (volume ROI crop). */
export const ToolCrop = (props: IconProps) => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 28 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <rect
      x="5.5"
      y="5.5"
      width="17"
      height="17"
      rx="1"
      stroke="currentColor"
      strokeWidth="1.25"
      opacity="0.35"
    />
    <rect
      x="8.5"
      y="8.5"
      width="11"
      height="11"
      rx="0.5"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinejoin="round"
    />
    <rect x="7.25" y="7.25" width="2.5" height="2.5" rx="0.4" fill="currentColor" />
    <rect x="18.25" y="7.25" width="2.5" height="2.5" rx="0.4" fill="currentColor" />
    <rect x="7.25" y="18.25" width="2.5" height="2.5" rx="0.4" fill="currentColor" />
    <rect x="18.25" y="18.25" width="2.5" height="2.5" rx="0.4" fill="currentColor" />
  </svg>
);

export default ToolCrop;
