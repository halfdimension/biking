/**
 * Live, read-only Normal-mode request preview (Task 14.1, Req 1.8, 9.2).
 *
 * When BOTH start and dest are set and valid, shows the canonical OSRM URL and
 * the canonical Valhalla JSON body that Compare will send — regenerated
 * whenever the coordinates change (derived from the store, not stored). When
 * only one/none is set, shows a hint that both are required and builds no
 * partial preview.
 *
 * These previews are DISPLAY-ONLY and read-only here. Editable Advanced editors
 * are Task 23. The backend always builds the canonical Compare request from
 * start/dest, so these previews never drive an actual request.
 */
import { useStore } from "../store";
import { isValidLat, isValidLon, buildOsrmPreviewUrl, buildValhallaPreviewJson } from "../requests";
import type { Coordinate } from "../types";

function isValidCoord(c: Coordinate | null): c is Coordinate {
  return c !== null && isValidLat(c.lat) && isValidLon(c.lon);
}

export default function RequestPreview() {
  const start = useStore((s) => s.start);
  const dest = useStore((s) => s.dest);

  if (!isValidCoord(start) || !isValidCoord(dest)) {
    return (
      <p className="request-preview__hint">
        Set a valid start and destination to preview the OSRM and Valhalla
        requests.
      </p>
    );
  }

  const osrmUrl = buildOsrmPreviewUrl(start, dest);
  const valhallaJson = buildValhallaPreviewJson(start, dest);

  return (
    <div className="request-preview">
      <div className="request-preview__block">
        <h4 className="request-preview__title">OSRM request</h4>
        <pre className="request-preview__pre">
          <code className="request-preview__code">{osrmUrl}</code>
        </pre>
      </div>
      <div className="request-preview__block">
        <h4 className="request-preview__title">Valhalla request body</h4>
        <pre className="request-preview__pre">
          <code className="request-preview__code">{valhallaJson}</code>
        </pre>
      </div>
    </div>
  );
}
