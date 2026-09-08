/**
 * Curl Import panel (Task 25.1, Req 10.1, 10.2, 17.7).
 *
 * Two SEPARATE paste areas — one for an OSRM curl command and one for a
 * Valhalla curl command (Req 10.1) — each with its own Import button and its
 * own inline status/error line. Each textarea keeps independent LOCAL text
 * state.
 *
 * On Import the raw pasted string is sent verbatim to the backend
 * (`api.curlImport` → `POST /api/curl/import`). The frontend NEVER executes the
 * pasted text as shell locally — it only POSTs the string; the backend parses
 * it with shlex (never a shell) and enforces the host allowlist
 * (localhost:5000 / localhost:8002). The backend determines the engine from the
 * URL, so the success summary shows the RETURNED engine (which may differ from
 * the textarea's label — that is fine).
 *
 * The store exposes a single `curlImportState` for the LAST executed import, so
 * a local `lastSubmitted` flag routes that shared status/error to whichever
 * area's Import button was last clicked. Client-side validation is limited to
 * the empty/whitespace guard (Req 17.7): an empty area shows a local error and
 * does NOT call the backend. Everything else (non-curl, no URL, non-allowlisted
 * host, invalid JSON) is decided by the backend and surfaced as its message.
 */
import { useState } from "react";
import { useStore } from "../store";
import type { Engine } from "../types";

type Area = "osrm" | "valhalla";

const OSRM_PLACEHOLDER =
  "curl 'http://localhost:5000/route/v1/biking/76.87,28.78;77.45,28.20" +
  "?overview=full&geometries=polyline6&alternatives=true&steps=true'";

const VALHALLA_PLACEHOLDER =
  "curl -X POST http://localhost:8002/route \\\n" +
  "  -H 'Content-Type: application/json' \\\n" +
  '  -d \'{"locations":[{"lat":28.78,"lon":76.87,"type":"break"},' +
  '{"lat":28.20,"lon":77.45,"type":"break"}],"costing":"motorcycle",' +
  '"alternates":10,"shape_format":"polyline6"}\'';

interface PasteAreaProps {
  area: Area;
  label: string;
  engineLabel: string;
  placeholder: string;
}

function PasteArea({ area, label, engineLabel, placeholder }: PasteAreaProps) {
  const sendCurlImport = useStore((s) => s.sendCurlImport);
  const importState = useStore((s) => s.curlImportState);

  // Independent local text state per area.
  const [text, setText] = useState("");
  // Local validation error (empty guard) shown near THIS area only.
  const [localError, setLocalError] = useState<string | null>(null);
  // Whether this area triggered the last import (routes the shared store state).
  const [submitted, setSubmitted] = useState(false);

  const handleImport = () => {
    const trimmed = text.trim();
    if (trimmed === "") {
      // Client-side guard (Req 17.7): show error, import nothing.
      setSubmitted(false);
      setLocalError("Paste a curl command first.");
      return;
    }
    setLocalError(null);
    setSubmitted(true);
    // Send the EXACT pasted string; the backend parses & host-restricts it.
    void sendCurlImport(text);
  };

  // Only reflect the shared store state if THIS area launched the last import.
  const active = submitted;
  const loading = active && importState.status === "loading";
  const showError =
    active && importState.status === "error" && importState.error;
  const showDone =
    active && importState.status === "done" && importState.result;

  const inputId = `curl-import-${area}`;

  return (
    <div className="curl-import__area">
      <label className="curl-import__label" htmlFor={inputId}>
        {label}
      </label>
      <textarea
        id={inputId}
        className="curl-import__textarea"
        rows={4}
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={`${engineLabel} curl command`}
      />
      <div className="curl-import__actions">
        <button
          type="button"
          className="curl-import__import"
          onClick={handleImport}
          disabled={loading}
        >
          {loading ? "Importing…" : `Import ${engineLabel} curl`}
        </button>
      </div>

      {localError && (
        <p className="curl-import__error" role="alert">
          {localError}
        </p>
      )}

      {loading && (
        <p className="curl-import__status">Importing {engineLabel} curl…</p>
      )}

      {showError && (
        <p className="curl-import__error" role="alert">
          {importState.error}
        </p>
      )}

      {showDone && importState.result && (
        <p
          className="curl-import__status curl-import__status--ok"
          role="status"
        >
          {formatSummary(importState.engine, importState.result.normalizedRoutes.length, importState.result.httpStatus)}
        </p>
      )}
    </div>
  );
}

/** Build the success summary: resolved engine, route count, HTTP status. */
function formatSummary(
  engine: Engine | null,
  routeCount: number,
  httpStatus: number | null,
): string {
  const engineName =
    engine === "osrm" ? "OSRM" : engine === "valhalla" ? "Valhalla" : "engine";
  const routes = `${routeCount} route${routeCount === 1 ? "" : "s"}`;
  const http = httpStatus != null ? `, HTTP ${httpStatus}` : "";
  return `Imported ${engineName}: ${routes}${http}`;
}

export default function CurlImport() {
  return (
    <div className="curl-import">
      <p className="curl-import__hint">
        Paste a curl command below. It is sent to the backend, which parses it
        safely (no shell) and only allows the local OSRM and Valhalla hosts. The
        command is never run as shell in your browser.
      </p>
      <PasteArea
        area="osrm"
        label="OSRM curl"
        engineLabel="OSRM"
        placeholder={OSRM_PLACEHOLDER}
      />
      <PasteArea
        area="valhalla"
        label="Valhalla curl"
        engineLabel="Valhalla"
        placeholder={VALHALLA_PLACEHOLDER}
      />
    </div>
  );
}
