/**
 * Valhalla Advanced/raw request editor (Task 23.1, Req 9.6, 9.7, 17.5).
 *
 * The user edits a Valhalla URL and a JSON body and sends them verbatim through
 * the backend raw path (`api.valhallaRaw` → `POST /api/valhalla/raw`). The exact
 * parsed body is sent — the dashboard never replaces `costing`, `alternates`,
 * `units`, `shape_format`, `locations`, or any other option with defaults
 * (Req 9.7).
 *
 * Draft handling:
 *   - On mount, if the body draft is empty and start+dest are valid, the body is
 *     prefilled from the canonical Normal preview (`buildValhallaPreviewJson`)
 *     and the URL draft defaults to the canonical route endpoint.
 *   - "Reset to canonical" always regenerates both drafts from the current
 *     coordinates (disabled/hinted when coordinates are missing/invalid).
 *
 * JSON validation (Req 17.5): the body is parsed with `JSON.parse` on every
 * change to drive a live valid/invalid indicator, but a parse failure only
 * BLOCKS on send — an invalid body shows a JSON validation error and is never
 * sent. Loading / error / success are read from the isolated
 * `valhallaRawState` slice, keeping a raw failure away from any Normal Compare.
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { buildValhallaPreviewJson, isValidLat, isValidLon } from "../requests";

const DEFAULT_VALHALLA_URL = "http://localhost:8002/route";

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

/** Parse a JSON string, returning either the value or the error message. */
function tryParse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (text.trim() === "") {
    return { ok: false, error: "The JSON body is empty." };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export default function ValhallaRawRequest() {
  const start = useStore((s) => s.start);
  const dest = useStore((s) => s.dest);
  const urlDraft = useStore((s) => s.valhallaUrlDraft);
  const bodyDraft = useStore((s) => s.valhallaBodyDraft);
  const setUrlDraft = useStore((s) => s.setValhallaUrlDraft);
  const setBodyDraft = useStore((s) => s.setValhallaBodyDraft);
  const sendValhallaRaw = useStore((s) => s.sendValhallaRaw);
  const rawState = useStore((s) => s.valhallaRawState);

  const [sendError, setSendError] = useState<string | null>(null);

  const canReset = coordsValid(start, dest);

  // Prefill on mount when drafts are empty. Body is prefilled only when valid
  // coords exist; the URL always gets the canonical default.
  useEffect(() => {
    if (urlDraft.trim() === "") {
      setUrlDraft(DEFAULT_VALHALLA_URL);
    }
    if (bodyDraft.trim() === "" && canReset && start && dest) {
      setBodyDraft(buildValhallaPreviewJson(start, dest));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live JSON validity (parse on every change; only blocks on send).
  const parsed = useMemo(() => tryParse(bodyDraft), [bodyDraft]);
  const loading = rawState.status === "loading";

  const handleReset = () => {
    if (canReset && start && dest) {
      setUrlDraft(DEFAULT_VALHALLA_URL);
      setBodyDraft(buildValhallaPreviewJson(start, dest));
      setSendError(null);
    }
  };

  const handleSend = () => {
    const url = urlDraft.trim();
    if (url === "") {
      setSendError("Enter a Valhalla URL before sending.");
      return;
    }
    if (!parsed.ok) {
      // Invalid JSON body → show error and DO NOT send (Req 17.5).
      setSendError(`Invalid JSON body: ${parsed.error}`);
      return;
    }
    setSendError(null);
    // Send the EXACT parsed object verbatim (Req 9.7).
    void sendValhallaRaw(url, parsed.value);
  };

  const result = rawState.result;

  return (
    <div className="raw-editor">
      <label className="raw-editor__label" htmlFor="valhalla-raw-url">
        Valhalla URL
      </label>
      <input
        id="valhalla-raw-url"
        className="raw-editor__input"
        type="text"
        spellCheck={false}
        value={urlDraft}
        onChange={(e) => setUrlDraft(e.target.value)}
        placeholder={DEFAULT_VALHALLA_URL}
      />

      <label className="raw-editor__label" htmlFor="valhalla-raw-body">
        Valhalla JSON body
      </label>
      <textarea
        id="valhalla-raw-body"
        className="raw-editor__textarea"
        rows={12}
        spellCheck={false}
        value={bodyDraft}
        onChange={(e) => setBodyDraft(e.target.value)}
        placeholder='{ "locations": [...], "costing": "motorcycle", ... }'
      />

      <p
        className={
          "raw-editor__json-indicator" +
          (parsed.ok
            ? " raw-editor__json-indicator--ok"
            : " raw-editor__json-indicator--bad")
        }
        role="status"
        data-testid="valhalla-json-indicator"
      >
        {parsed.ok ? "JSON valid" : `Invalid JSON: ${parsed.error}`}
      </p>

      <div className="raw-editor__actions">
        <button
          type="button"
          className="raw-editor__send"
          onClick={handleSend}
          disabled={loading}
        >
          {loading ? "Sending…" : "Send Valhalla Request"}
        </button>
        <button
          type="button"
          className="raw-editor__reset"
          onClick={handleReset}
          disabled={!canReset}
          title={
            canReset
              ? "Reset the drafts to the canonical Normal-mode request"
              : "Set valid start and destination coordinates first"
          }
        >
          Reset to canonical
        </button>
      </div>

      {sendError && (
        <p className="raw-editor__error" role="alert">
          {sendError}
        </p>
      )}

      {loading && <p className="raw-editor__status">Sending Valhalla request…</p>}

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
