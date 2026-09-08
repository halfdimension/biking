/**
 * Right sidebar (Req 15.4).
 *
 * Hosts the per-engine cross-engine status/error/warning panels (Task 28.1,
 * Req 17.1–17.3, 17.8, 17.9, 17.12, 17.13), the per-engine route visibility
 * lists and the bulk visibility controls (Task 20.1, Req 5.1–5.8) plus the
 * selected-route details panel (Task 21.1, Req 6.6).
 *
 * The two `EngineStatusPanel`s read their own engine's envelope only, so when
 * one engine errors the other engine's status, routes, list, table, and details
 * stay fully usable (Req 17.13 isolation).
 */
import Section from "./Section";
import EngineStatusPanel from "./EngineStatusPanel";
import RouteVisibilityList from "./RouteVisibilityList";
import BulkVisibilityControls from "./BulkVisibilityControls";
import SelectedRouteInfo from "./SelectedRouteInfo";

export default function RightSidebar() {
  return (
    <aside className="right-sidebar" aria-label="Routes">
      <Section title="Engine Status">
        <div className="engine-status-list">
          <EngineStatusPanel engine="osrm" />
          <EngineStatusPanel engine="valhalla" />
        </div>
      </Section>
      <Section title="OSRM Routes">
        <RouteVisibilityList engine="osrm" />
      </Section>
      <Section title="Valhalla Routes">
        <RouteVisibilityList engine="valhalla" />
      </Section>
      <Section title="Visibility Controls">
        <BulkVisibilityControls />
      </Section>
      <Section title="Selected Route">
        <SelectedRouteInfo />
      </Section>
    </aside>
  );
}
