/**
 * Bottom tab strip (Req 15.5).
 *
 * Tabs labeled exactly: Comparison, OSRM Raw Request, OSRM Response, Valhalla
 * Raw Request, Valhalla Response, Assessment. Tab switching is local component
 * state. The Comparison tab renders the live comparison table (Task 22.2);
 * the remaining tabs still show a placeholder panel until later tasks.
 */
import { useState } from "react";
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
  const [active, setActive] = useState<Tab>("Comparison");

  return (
    <div className="bottom-tabs">
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
