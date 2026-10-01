/**
 * Collapsible bottom analysis workspace. The Edge Details tab is activated
 * automatically when a map segment is pinned and the top drag handle resizes
 * the workspace without changing map state.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import ComparisonTable from "./ComparisonTable";
import OsrmRawRequest from "./OsrmRawRequest";
import ValhallaRawRequest from "./ValhallaRawRequest";
import RawResponseInspector from "./RawResponseInspector";
import Assessment from "./Assessment";
import EdgeDetailsPanel from "./EdgeDetailsPanel";

const TABS = [
  "Comparison",
  "Edge Details",
  "OSRM Raw Request",
  "OSRM Response",
  "Valhalla Raw Request",
  "Valhalla Response",
  "Assessment",
] as const;

type Tab = (typeof TABS)[number];

const MIN_PANEL_HEIGHT = 180;
const MAX_PANEL_HEIGHT = 520;

function clampedHeight(height: number): number {
  const viewportMax =
    typeof window === "undefined"
      ? MAX_PANEL_HEIGHT
      : Math.min(MAX_PANEL_HEIGHT, Math.round(window.innerHeight * 0.58));
  return Math.max(MIN_PANEL_HEIGHT, Math.min(viewportMax, height));
}

export default function BottomTabs() {
  const [active, setActive] = useState<Tab>("Comparison");
  const [panelHeight, setPanelHeight] = useState(280);
  const collapsed = useStore((s) => s.bottomCollapsed);
  const toggle = useStore((s) => s.toggleBottomCollapsed);
  const detailsPinned = useStore((s) => s.debugInspectorPinned);
  const wasPinned = useRef(false);
  const dragStart = useRef<{ y: number; height: number } | null>(null);

  useEffect(() => {
    if (detailsPinned && !wasPinned.current) {
      setActive("Edge Details");
      if (collapsed) toggle();
    }
    wasPinned.current = detailsPinned;
  }, [collapsed, detailsPinned, toggle]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!dragStart.current) return;
      const delta = dragStart.current.y - event.clientY;
      setPanelHeight(clampedHeight(dragStart.current.height + delta));
    };
    const onUp = () => {
      dragStart.current = null;
      document.body.classList.remove("is-resizing-bottom-panel");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-resizing-bottom-panel");
    };
  }, []);

  const selectTab = (tab: Tab) => {
    setActive(tab);
    if (collapsed) toggle();
  };

  const adjustHeight = (delta: number) => {
    setPanelHeight((height) => clampedHeight(height + delta));
  };

  return (
    <div
      className={"bottom-tabs" + (collapsed ? " bottom-tabs--collapsed" : "")}
      style={collapsed ? undefined : { height: panelHeight }}
    >
      {!collapsed ? (
        <div
          className="bottom-tabs__resize-handle"
          role="separator"
          aria-label="Resize bottom panel"
          aria-orientation="horizontal"
          aria-valuemin={MIN_PANEL_HEIGHT}
          aria-valuemax={MAX_PANEL_HEIGHT}
          aria-valuenow={panelHeight}
          tabIndex={0}
          onPointerDown={(event) => {
            dragStart.current = { y: event.clientY, height: panelHeight };
            document.body.classList.add("is-resizing-bottom-panel");
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") adjustHeight(24);
            if (event.key === "ArrowDown") adjustHeight(-24);
          }}
        >
          <span />
        </div>
      ) : null}
      <div className="bottom-tabs__strip" role="tablist" aria-label="Analysis panels">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active === tab}
            className={
              "bottom-tabs__tab" +
              (active === tab ? " bottom-tabs__tab--active" : "")
            }
            onClick={() => selectTab(tab)}
          >
            {tab}
            {tab === "Edge Details" && detailsPinned ? (
              <span className="bottom-tabs__pin-dot" aria-label="Pinned details" />
            ) : null}
          </button>
        ))}
        <button
          type="button"
          className="bottom-tabs__collapse"
          data-testid="collapse-bottom"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand bottom panel" : "Collapse bottom panel"}
          title={collapsed ? "Expand bottom panel" : "Collapse bottom panel"}
          onClick={toggle}
        >
          {collapsed ? "∧" : "∨"}
        </button>
      </div>
      <div
        className="bottom-tabs__panel"
        role="tabpanel"
        data-testid="bottom-tab-panel"
      >
        {active === "Comparison" ? (
          <ComparisonTable />
        ) : active === "Edge Details" ? (
          <EdgeDetailsPanel />
        ) : active === "OSRM Raw Request" ? (
          <OsrmRawRequest />
        ) : active === "OSRM Response" ? (
          <RawResponseInspector engine="osrm" />
        ) : active === "Valhalla Raw Request" ? (
          <ValhallaRawRequest />
        ) : active === "Valhalla Response" ? (
          <RawResponseInspector engine="valhalla" />
        ) : (
          <Assessment />
        )}
      </div>
    </div>
  );
}
