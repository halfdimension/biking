import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

export const STRUCTURAL_MAP_MIN_HEIGHT = 48;
export const VERTICAL_PANEL_KEYBOARD_STEP = 24;

export interface VerticalPanelBounds {
  minimum: number;
  maximum: number;
}

/**
 * Derive the only permitted upper bound: the measured workspace minus the
 * small strip needed to keep the map container structurally valid. In an
 * exceptionally small workspace, the effective panel minimum yields to the
 * available geometry so the returned range is always valid and non-negative.
 */
export function verticalPanelBounds(
  workspaceHeight: number,
  panelMinimum: number,
  structuralMapMinimum = STRUCTURAL_MAP_MIN_HEIGHT,
): VerticalPanelBounds {
  const safeWorkspaceHeight = Number.isFinite(workspaceHeight)
    ? Math.max(0, workspaceHeight)
    : 0;
  const safeMapMinimum = Number.isFinite(structuralMapMinimum)
    ? Math.max(0, structuralMapMinimum)
    : 0;
  const maximum = Math.max(0, Math.floor(safeWorkspaceHeight - safeMapMinimum));
  const requestedMinimum = Number.isFinite(panelMinimum)
    ? Math.max(0, panelMinimum)
    : 0;
  return {
    minimum: Math.min(requestedMinimum, maximum),
    maximum,
  };
}

export function renderableVerticalPanelHeight(
  preferredHeight: number,
  workspaceHeight: number,
  panelMinimum: number,
  structuralMapMinimum = STRUCTURAL_MAP_MIN_HEIGHT,
): number {
  const bounds = verticalPanelBounds(
    workspaceHeight,
    panelMinimum,
    structuralMapMinimum,
  );
  const safePreferred = Number.isFinite(preferredHeight)
    ? preferredHeight
    : bounds.minimum;
  return Math.max(bounds.minimum, Math.min(bounds.maximum, safePreferred));
}

interface UseVerticalPanelResizeOptions {
  workspaceRef: RefObject<HTMLElement | null>;
  panelRef?: RefObject<HTMLElement | null>;
  preferredHeight: number;
  panelMinimum: number;
  onPreferredHeightChange: (height: number) => void;
  disabled?: boolean;
  bodyClassName?: string;
  keyboardStep?: number;
}

/** Shared pointer, keyboard, measurement, and preferred-vs-live mechanics. */
export function useVerticalPanelResize({
  workspaceRef,
  panelRef,
  preferredHeight,
  panelMinimum,
  onPreferredHeightChange,
  disabled = false,
  bodyClassName = "is-resizing-vertical-panel",
  keyboardStep = VERTICAL_PANEL_KEYBOARD_STEP,
}: UseVerticalPanelResizeOptions) {
  const preferredHeightRef = useRef(preferredHeight);
  const liveHeightRef = useRef(preferredHeight);
  const boundsRef = useRef<VerticalPanelBounds>({
    minimum: panelMinimum,
    maximum: Math.max(panelMinimum, preferredHeight),
  });
  const dragStartRef = useRef<{
    pointerId: number;
    clientY: number;
    height: number;
  } | null>(null);
  const [liveHeight, setLiveHeight] = useState(preferredHeight);
  const [bounds, setBounds] = useState(boundsRef.current);
  const [resizing, setResizing] = useState(false);
  const [layoutRevision, setLayoutRevision] = useState(0);

  const applyMeasuredHeight = useCallback((requestedHeight: number) => {
    const workspaceHeight =
      workspaceRef.current?.getBoundingClientRect().height ?? 0;
    if (workspaceHeight <= 0) {
      const fallbackBounds = {
        minimum: panelMinimum,
        maximum: Math.max(panelMinimum, requestedHeight),
      };
      boundsRef.current = fallbackBounds;
      setBounds(fallbackBounds);
      const fallbackHeight = Math.max(panelMinimum, requestedHeight);
      liveHeightRef.current = fallbackHeight;
      setLiveHeight(fallbackHeight);
      return fallbackHeight;
    }

    const nextBounds = verticalPanelBounds(workspaceHeight, panelMinimum);
    const nextHeight = renderableVerticalPanelHeight(
      requestedHeight,
      workspaceHeight,
      panelMinimum,
    );
    boundsRef.current = nextBounds;
    setBounds(nextBounds);
    liveHeightRef.current = nextHeight;
    setLiveHeight(nextHeight);
    return nextHeight;
  }, [panelMinimum, workspaceRef]);

  useEffect(() => {
    preferredHeightRef.current = preferredHeight;
    if (!dragStartRef.current) applyMeasuredHeight(preferredHeight);
  }, [applyMeasuredHeight, preferredHeight]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const updateForWorkspace = () => {
      if (dragStartRef.current) return;
      applyMeasuredHeight(preferredHeightRef.current);
    };
    const observer = new ResizeObserver(updateForWorkspace);
    observer.observe(workspace);
    window.addEventListener("resize", updateForWorkspace);
    updateForWorkspace();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateForWorkspace);
      document.body.classList.remove(bodyClassName);
    };
  }, [applyMeasuredHeight, bodyClassName, workspaceRef]);

  const commitHeight = useCallback((requestedHeight: number) => {
    const nextHeight = applyMeasuredHeight(requestedHeight);
    preferredHeightRef.current = nextHeight;
    onPreferredHeightChange(nextHeight);
    setLayoutRevision((revision) => revision + 1);
  }, [applyMeasuredHeight, onPreferredHeightChange]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled) return;
      const renderedHeight =
        panelRef?.current?.getBoundingClientRect().height || liveHeightRef.current;
      applyMeasuredHeight(renderedHeight);
      dragStartRef.current = {
        pointerId: event.pointerId,
        clientY: event.clientY,
        height: renderedHeight,
      };
      setResizing(true);
      document.body.classList.add(bodyClassName);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    },
    [applyMeasuredHeight, bodyClassName, disabled, panelRef],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = dragStartRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      applyMeasuredHeight(start.height + start.clientY - event.clientY);
      event.preventDefault();
    },
    [applyMeasuredHeight],
  );

  const finishPointerResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = dragStartRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      dragStartRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setResizing(false);
      document.body.classList.remove(bodyClassName);
      commitHeight(liveHeightRef.current);
    },
    [bodyClassName, commitHeight],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (disabled || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
        return;
      }
      event.preventDefault();
      commitHeight(
        liveHeightRef.current +
          (event.key === "ArrowUp" ? keyboardStep : -keyboardStep),
      );
    },
    [commitHeight, disabled, keyboardStep],
  );

  return {
    liveHeight,
    minimumHeight: bounds.minimum,
    maximumHeight: bounds.maximum,
    resizing,
    layoutRevision,
    resizeHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishPointerResize,
      onPointerCancel: finishPointerResize,
      onKeyDown,
    },
  };
}
