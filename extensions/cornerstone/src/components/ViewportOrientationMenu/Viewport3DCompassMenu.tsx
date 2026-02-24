import React from 'react';
import { cn, Icons, useIconPresentation } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { Popover, PopoverTrigger, PopoverContent, Button, useViewportGrid } from '@ohif/ui-next';

function Viewport3DCompassMenu({
  location,
  viewportId,
  isOpen = false,
  onOpen,
  onClose,
  disabled,
  ...props
}: withAppTypes<{
  location?: string;
  viewportId: string;
  isOpen?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  disabled?: boolean;
}>) {
  const { servicesManager, commandsManager } = useSystem();
  const { cornerstoneViewportService, toolbarService } = servicesManager.services;
  const [gridState] = useViewportGrid();
  const viewportIdToUse = viewportId || gridState.activeViewportId;
  const { IconContainer, className: iconClassName, containerProps } = useIconPresentation();

  const handleDirectionChange = (direction: 'S' | 'P' | 'R' | 'L' | 'A' | 'I') => {
    commandsManager.runCommand('setViewport3DViewDirection', {
      viewportId: viewportIdToUse,
      direction,
    });
  };

  const handleOpenChange = (openState: boolean) => {
    if (openState) {
      onOpen?.();
    } else {
      onClose?.();
    }
  };

  const { align, side } = toolbarService.getAlignAndSide(Number(location));

  const cx = 50;
  const cy = 50;
  const lineR = 30;
  const labelR = 42;
  const dirs: { dir: 'S' | 'P' | 'R' | 'L' | 'A' | 'I'; angle: number }[] = [
    { dir: 'S', angle: -90 },
    { dir: 'I', angle: 90 },
    { dir: 'R', angle: 180 },
    { dir: 'L', angle: 0 },
    { dir: 'P', angle: 225 },
    { dir: 'A', angle: 45 },
  ];
  const toXY = (angleDeg: number, radius: number) => {
    const a = (angleDeg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  };

  const Icon = <Icons.OrientationSwitch className={iconClassName} />;

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild className={cn('flex items-center justify-center')}>
        <div>
          {IconContainer ? (
            <IconContainer
              disabled={disabled}
              icon="OrientationSwitch"
              {...props}
              {...containerProps}
            >
              {Icon}
            </IconContainer>
          ) : (
            <Button variant="ghost" size="icon" disabled={disabled} onClick={() => {}}>
              {Icon}
            </Button>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto flex-shrink-0 rounded-lg bg-neutral-800 p-3"
        align={align}
        side={side}
        style={{ left: 0 }}
      >
        <svg
          viewBox="0 0 100 100"
          className="h-28 w-28"
          role="group"
          aria-label="View direction"
        >
          {/* Horizontal axis R-L (solid) */}
          <line
            x1={toXY(180, lineR).x}
            y1={toXY(180, lineR).y}
            x2={toXY(0, lineR).x}
            y2={toXY(0, lineR).y}
            stroke="white"
            strokeWidth="1.2"
          />
          {/* Vertical axis S-I (solid) */}
          <line
            x1={toXY(-90, lineR).x}
            y1={toXY(-90, lineR).y}
            x2={toXY(90, lineR).x}
            y2={toXY(90, lineR).y}
            stroke="white"
            strokeWidth="1.2"
          />
          {/* Diagonal axis P-A: P top-left, A bottom-right */}
          <line
            x1={toXY(225, lineR).x}
            y1={toXY(225, lineR).y}
            x2={toXY(45, lineR).x}
            y2={toXY(45, lineR).y}
            stroke="white"
            strokeWidth="1.2"
          />
          {/* Center sphere */}
          <circle
            cx={cx}
            cy={cy}
            r={5}
            fill="#7dd3fc"
            className="drop-shadow-[0_0_6px_rgba(125,211,252,0.8)]"
          />
          {/* Clickable labels */}
          {dirs.map(({ dir, angle }) => {
            const { x, y } = toXY(angle, labelR);
            return (
              <g
                key={dir}
                className="cursor-pointer select-none"
                onClick={() => handleDirectionChange(dir)}
                onKeyDown={e => e.key === 'Enter' && handleDirectionChange(dir)}
                role="button"
                tabIndex={-1}
                aria-label={dir}
              >
                <circle cx={x} cy={y} r={10} fill="transparent" />
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontSize="11"
                  fontWeight="600"
                  fontFamily="sans-serif"
                  className="pointer-events-none"
                >
                  {dir}
                </text>
              </g>
            );
          })}
        </svg>
      </PopoverContent>
    </Popover>
  );
}

export default Viewport3DCompassMenu;
