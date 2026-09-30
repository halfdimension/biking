/**
 * Bottom tab strip (Req 15.5).
 *
 * Tabs labeled exactly: Comparison, OSRM Raw Request, OSRM Response, Valhalla
 * Raw Request, Valhalla Response, Assessment. Tab switching is local component
 * state. The Comparison tab renders the live comparison table (Task 22.2);
 * the remaining tabs still show a placeholder panel until later tasks.
 */
import { useState } from "react";
import { useStore } from "../store";
import ComparisonTable from "./ComparisonTable";
import OsrmRawRequest from "./OsrmRawRequest";
import ValhallaRawRequest from "./ValhallaRawRequest";
import RawResponseInspector from "./RawResponseInspector";
import Assessment from "./Assessment";

const TABS = [
  "Comparison",
  "OSRM Raw Request",
  "OSRM Response",
  "Valhalla Raw Request",
  "Valhalla Response",
  "Assessment",
] as const;

type Tab = (typeof TABS)[number];

export default function BottomTabs() {
  // `active` is intentionally LOCAL state. The collapse control below hides only
  // the panel BODY via CSS and never unmounts this component, so switching a tab
  // while collapsed and then expanding shows the last-selected tab (Req 4).
  const [active, setActive] = useState<Tab>("Comparison");
  const collapsed = useStore((s) => s.bottomCollapsed);
  const toggle = useStore((s) => s.toggleBottomCollapsed);

  return (
    <div className={"bottom-tabs" + (collapsed ? " bottom-tabs--collapsed" : "")}>
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
            onClick={() => setActive(tab)}
          >
            {tab}
          </button>
        ))}
        {/* Collapse/expand control at the right end of the tab strip. Only the
            panel body is hidden when collapsed; the strip (and this control)
            always stay visible so the panel is re-expandable. */}
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
      <div className="bottom-tabs__panel" role="tabpanel" data-testid="bottom-tab-panel">
        {active === "Comparison" ? (
          <ComparisonTable />
        ) : active === "OSRM Raw Request" ? (
          <OsrmRawRequest />
        ) : active === "OSRM Response" ? (
          <RawResponseInspector engine="osrm" />
        ) : active === "Valhalla Raw Request" ? (
          <ValhallaRawRequest />
        ) : active === "Valhalla Response" ? (
          <RawResponseInspector engine="valhalla" />
        ) : active === "Assessment" ? (
          <Assessment />
        ) : (
          <span>{active} — coming soon</span>
        )}
      </div>
    </div>
  );
}
