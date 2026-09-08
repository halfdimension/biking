/**
 * Bulk visibility controls (Task 20.1, Req 5.3–5.8).
 *
 * Six buttons, each wired to the matching pure store transform which rewrites
 * the whole `visibility` map over the currently returned routes:
 *
 *   Show All          → every route visible                       (Req 5.3)
 *   Hide All          → every route hidden                        (Req 5.4)
 *   OSRM Only         → OSRM visible, Valhalla hidden             (Req 5.5)
 *   Valhalla Only     → Valhalla visible, OSRM hidden             (Req 5.6)
 *   Primary Only      → primaries visible, alternates hidden      (Req 5.7)
 *   Alternatives Only → alternates visible, primaries hidden      (Req 5.8)
 *
 * As with the per-route list, nothing here talks to MapLibre — `MapView`
 * reacts to the store's `visibility` and updates `feature-state`.
 *
 * With no routes loaded there is nothing to partition, so the buttons are
 * disabled and a short hint explains why.
 */
import { useStore } from "../store";

export default function BulkVisibilityControls() {
  const routeCount = useStore((s) => s.routes.length);
  const showAll = useStore((s) => s.showAll);
  const hideAll = useStore((s) => s.hideAll);
  const osrmOnly = useStore((s) => s.osrmOnly);
  const valhallaOnly = useStore((s) => s.valhallaOnly);
  const primaryOnly = useStore((s) => s.primaryOnly);
  const alternativesOnly = useStore((s) => s.alternativesOnly);

  const disabled = routeCount === 0;

  const controls: { label: string; onClick: () => void }[] = [
    { label: "Show All", onClick: showAll },
    { label: "Hide All", onClick: hideAll },
    { label: "OSRM Only", onClick: osrmOnly },
    { label: "Valhalla Only", onClick: valhallaOnly },
    { label: "Primary Only", onClick: primaryOnly },
    { label: "Alternatives Only", onClick: alternativesOnly },
  ];

  return (
    <div className="bulk-visibility">
      <div className="bulk-visibility__group">
        {controls.map(({ label, onClick }) => (
          <button
            key={label}
            type="button"
            className="bulk-visibility__btn"
            disabled={disabled}
            onClick={onClick}
          >
            {label}
          </button>
        ))}
      </div>
      {disabled ? (
        <p className="bulk-visibility__hint">
          No routes yet — press Compare Routes.
        </p>
      ) : null}
    </div>
  );
}
