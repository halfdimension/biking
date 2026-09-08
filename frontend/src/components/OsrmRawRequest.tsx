/**
 * OSRM Advanced/raw request editor (Task 23.1, Req 9.4, 9.5, 17.6).
 *
 * The user edits a full OSRM request URL and sends it verbatim through the
 * backend raw path (`api.osrmRaw` → `POST /api/osrm/raw`). The dashboard NEVER
 * regenerates or overwrites any query parameters on send (Req 9.5) — exactly
 * what is in the draft is sent.
 *
 * Draft handling:
 *   - On mount, if the draft is empty and start+dest are valid coordinates, the
 *     draft is prefilled from the canonical Normal preview (`buildOsrmPreviewUrl`).
 *   - "Reset to canonical" always regenerates the draft from the current coords
 *     (disabled with a hint when coordinates are missing/invalid).
 *   - A user-edited draft is never auto-overwritten on coordinate change.
 *
 * Client-side validation (Req 17.6): an empty or obviously non-URL draft
 * (does not start with "http://") is blocked before send with a clear message.
 * The host allowlist is NOT enforced here — the backend allowlist is
 * authoritative.
 *
 * Errors, loading, and the success summary are read from the store's isolated
 * `osrmRawState` slice, so nothing here can affect a Normal-mode Compare.
 */
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { buildOsrmPreviewUrl, isValidLat, isValidLon } from "../requests";

function coordsValid(
  start: { lat: number; lon: number } | null,
  dest: { lat: number; lon: number } | null,
): boolean {
  return (
    !!start &&
    !!dest &&
    isValidLat(start.lat) &&
    isValidLon(start.lon) &&
    isValidLat(dest.lat) &&
    isValidLon(dest.lon)
  );
}

export default function OsrmRawRequest() {
  const start = useStore((s) => s.start);
  const dest = useStore((s) => s.dest);
  const draft = useStore((s) => s.osrmUrlDraft);
  const setDraft = useStore((s) => s.setOsrmUrlDraft);
  const sendOsrmRaw = useStore((s) => s.sendOsrmRaw);
  const rawState = useStore((s) => s.osrmRawState);

  const [validationError, setValidationError] = useState<string | null>(null);

  const canReset = coordsValid(start, dest);

  // Prefill on mount only when the draft is empty and coordinates are valid.
  useEffect(() => {
    if (draft.trim() === "" && canReset && start && dest) {
      setDraft(buildOsrmPreviewUrl(start, dest));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loading = rawState.status === "loading";
  const trimmed = draft.trim();
  const sendDisabled = loading || trimmed === "";

  const handleReset = () => {
    if (canReset && start && dest) {
      setDraft(buildOsrmPreviewUrl(start, dest));
      setValidationError(null);
    }
  };

  const handleSend = () => {
    if (trimmed === "") {
      setValidationError("Enter an OSRM request URL before sending.");
      return;
    }
    if (!trimmed.startsWith("http://")) {
      setValidationError(
        'Invalid raw request: the URL must start with "http://".',
      );
      return;
    }
    setValidationError(null);
    // Send EXACTLY the edited URL — no client-side regeneration (Req 9.5).
    void sendOsrmRaw(trimmed);
  };

  const result = rawState.result;

  return (
    <div className="raw-editor">
      <label className="raw-editor__label" htmlFor="osrm-raw-url">
        OSRM request URL
      </label>
      <textarea
        id="osrm-raw-url"
        className="raw-editor__textarea"
        rows={4}
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="http://localhost:5000/route/v1/biking/lon,lat;lon,lat?overview=full&..."
      />

      <div className="raw-editor__actions">
        <button
          type="button"
          className="raw-editor__send"
          onClick={handleSend}
          disabled={sendDisabled}
        >
          {loading ? "Sending…" : "Send OSRM Request"}
        </button>
        <button
          type="button"
          className="raw-editor__reset"
          onClick={handleReset}
          disabled={!canReset}
          title={
            canReset
              ? "Reset the draft to the canonical Normal-mode request"
              : "Set valid start and destination coordinates first"
          }
        >
          Reset to canonical
        </button>
      </div>

      {validationError && (
        <p className="raw-editor__error" role="alert">
          {validationError}
        </p>
      )}

      {loading && <p className="raw-editor__status">Sending OSRM request…</p>}

      {rawState.status === "error" && rawState.error && (
        <p className="raw-editor__error" role="alert">
          {rawState.error}
        </p>
      )}

      {rawState.status === "done" && result && (
        <p className="raw-editor__status raw-editor__status--ok" role="status">
          {result.normalizedRoutes.length} route
          {result.normalizedRoutes.length === 1 ? "" : "s"}
          {result.httpStatus != null ? `, HTTP ${result.httpStatus}` : ""},{" "}
          {Math.round(result.durationMs)} ms
        </p>
      )}
    </div>
  );
}
