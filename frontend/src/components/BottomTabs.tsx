/**
 * Collapsible bottom analysis workspace. The Edge Details tab is activated
 * automatically when a map segment is pinned and the top drag handle resizes
 * the workspace without changing map state.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { useStore } from "../store";
import { useVerticalPanelResize } from "../layout/useVerticalPanelResize";
import ComparisonTable from "./ComparisonTable";
import OsrmRawRequest from "./OsrmRawRequest";
import ValhallaRawRequest from "./ValhallaRawRequest";
import RawResponseInspector from "./RawResponseInspector";
import Assessment from "./Assessment";
import EdgeDetailsPanel from "./EdgeDetailsPanel";
import RouteAnalysis from "./RouteAnalysis";

const TABS = [
  "Comparison",
  "Edge Details",
  "Route Analysis",
  "OSRM Raw Request",
  "OSRM Response",
  "Valhalla Raw Request",
  "Valhalla Response",
  "Assessment",
] as const;

type Tab = (typeof TABS)[number];

const MIN_PANEL_HEIGHT = 180;

export default function BottomTabs({
  workspaceRef,
}: {
  workspaceRef?: RefObject<HTMLDivElement | null>;
}) {
  const [active, setActive] = useState<Tab>("Comparison");
  const collapsed = useStore((s) => s.bottomCollapsed);
  const toggle = useStore((s) => s.toggleBottomCollapsed);
  const preferredPanelHeight = useStore(
    (s) => s.routeComparisonPanelHeight,
  );
  const setPreferredPanelHeight = useStore(
    (s) => s.setRouteComparisonPanelHeight,
  );
  const detailsPinned = useStore((s) => s.debugInspectorPinned);
  const edgeDetailsOpenRequestId = useStore((s) => s.edgeDetailsOpenRequestId);
  const wasPinned = useRef(false);
  const previousOpenRequestId = useRef(edgeDetailsOpenRequestId);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const {
    liveHeight,
    minimumHeight,
    maximumHeight,
    resizing,
    resizeHandleProps,
  } = useVerticalPanelResize({
    workspaceRef: workspaceRef ?? panelRef,
    panelRef,
    preferredHeight: preferredPanelHeight,
    panelMinimum: MIN_PANEL_HEIGHT,
    onPreferredHeightChange: setPreferredPanelHeight,
    bodyClassName: "is-resizing-bottom-panel",
  });

  useEffect(() => {
    const explicitlyRequested =
      edgeDetailsOpenRequestId !== previousOpenRequestId.current;
    if (explicitlyRequested || (detailsPinned && !wasPinned.current)) {
      setActive("Edge Details");
      if (collapsed) toggle();
    }
    wasPinned.current = detailsPinned;
    previousOpenRequestId.current = edgeDetailsOpenRequestId;
  }, [collapsed, detailsPinned, edgeDetailsOpenRequestId, toggle]);

  const selectTab = (tab: Tab) => {
    setActive(tab);
    if (collapsed) toggle();
  };

  return (
    <div
      ref={panelRef}
      className={
        "bottom-tabs" +
        (collapsed ? " bottom-tabs--collapsed" : "") +
        (resizing ? " bottom-tabs--resizing" : "")
      }
      style={collapsed ? undefined : { height: liveHeight }}
    >
      {!collapsed ? (
        <div
          className="bottom-tabs__resize-handle"
          role="separator"
          aria-label="Resize bottom panel"
          aria-orientation="horizontal"
          aria-valuemin={Math.round(minimumHeight)}
          aria-valuemax={Math.round(maximumHeight)}
          aria-valuenow={Math.round(liveHeight)}
          aria-valuetext={`${Math.round(liveHeight)} pixels`}
          tabIndex={0}
          {...resizeHandleProps}
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
        ) : active === "Route Analysis" ? (
          <RouteAnalysis />
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
