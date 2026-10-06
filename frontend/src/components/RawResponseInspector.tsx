/**
 * Raw_Response_Inspector for one engine (Task 24.1, Req 11.1–11.6).
 *
 * Shows the MOST RECENT relevant raw response for `engine`, resolved by
 * {@link selectEngineResponse} (Advanced raw when the user has sent one, else
 * the Normal Compare envelope). The complete, unmodified `raw` body is rendered
 * as pretty-printed, collapsible JSON via {@link JsonViewer} — no field is ever
 * dropped, so custom/unknown engine fields are preserved (Req 11.5, 11.6).
 *
 * States (Req 11.4):
 *   - No response yet → muted hint.
 *   - Loading         → "Loading…".
 *   - Error           → a clear error block (kind + message); the raw body is
 *                       STILL shown below when one exists (e.g. an http_error
 *                       whose body is JSON).
 *   - Success         → header + JsonViewer over the full raw body.
 *
 * A "Copy JSON" control copies `JSON.stringify(raw, null, 2)` via
 * `navigator.clipboard.writeText` (guarded for environments without it) and
 * shows a transient "Copied" confirmation (Req 11.3).
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { Engine } from "../types";
import JsonViewer from "./JsonViewer";
import {
  selectEngineResponse,
  type ResponseSource,
} from "./selectEngineResponse";

const ENGINE_NAME: Record<Engine, string> = {
  osrm: "OSRM",
  valhalla: "Valhalla",
};

function sourceLabel(
  source: ResponseSource,
  rawSource: "engine-json" | "protobuf-derived" | undefined,
  routingTarget: "local" | "prod",
): string | null {
  if (source === "raw") return "Advanced raw";
  if (source === "compare") {
    const target = routingTarget === "prod" ? "Prod" : "Local";
    return rawSource === "protobuf-derived"
      ? `Compare · ${target} · Protobuf-derived`
      : `Compare · ${target}`;
  }
  return null;
}

export default function RawResponseInspector({ engine }: { engine: Engine }) {
  const results = useStore((s) => s.results);
  const osrmRawState = useStore((s) => s.osrmRawState);
  const valhallaRawState = useStore((s) => s.valhallaRawState);
  const compareStatus = useStore((s) => s.compareStatus);
  const latestResponseSource = useStore((s) => s.latestResponseSource);
  const resultTarget = results?.routingTarget ?? "local";

  const resp = selectEngineResponse(
    {
      results,
      osrmRawState,
      valhallaRawState,
      compareStatus,
      latestResponseSource,
    },
    engine,
  );

  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const engineName = ENGINE_NAME[engine];
  const hasRaw = resp.raw !== undefined && resp.raw !== null;

  async function handleCopy() {
    const text = JSON.stringify(resp.raw, null, 2);
    // Guard: clipboard is unavailable in jsdom / non-secure contexts.
    const clip =
      typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (clip && typeof clip.writeText === "function") {
      try {
        await clip.writeText(text);
      } catch {
        // Swallow: copy failure should not break the panel.
      }
    }
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  }

  // --- No response yet -------------------------------------------------------
  if (resp.source === null) {
    return (
      <div className="raw-inspector" data-testid={`raw-inspector-${engine}`}>
        <p className="raw-inspector__empty">
          No response yet — run Compare or send an Advanced request.
        </p>
      </div>
    );
  }

  // --- Loading ---------------------------------------------------------------
  if (resp.status === "loading") {
    return (
      <div className="raw-inspector" data-testid={`raw-inspector-${engine}`}>
        <p className="raw-inspector__loading">Loading…</p>
      </div>
    );
  }

  const src = sourceLabel(resp.source, resp.result?.rawSource, resultTarget);
  const isError = resp.status === "error";

  return (
    <div className="raw-inspector" data-testid={`raw-inspector-${engine}`}>
      <div className="raw-inspector__header">
        <span className="raw-inspector__engine">{engineName} Response</span>
        {src && (
          <span
            className="raw-inspector__source"
            data-testid={`raw-inspector-source-${engine}`}
          >
            source: {src}
          </span>
        )}
        {resp.httpStatus != null && (
          <span className="raw-inspector__http">HTTP {resp.httpStatus}</span>
        )}
        {resp.warnings.length > 0 && (
          <span className="raw-inspector__warncount">
            {resp.warnings.length} warning
            {resp.warnings.length === 1 ? "" : "s"}
          </span>
        )}
        <button
          type="button"
          className="raw-inspector__copy"
          onClick={handleCopy}
          disabled={!hasRaw}
        >
          Copy JSON
        </button>
        {copied && (
          <span className="raw-inspector__copied" role="status">
            Copied
          </span>
        )}
      </div>

      {/* Error block (Req 11.4) — shown when the engine/raw state errored. */}
      {isError && (
        <div className="raw-inspector__error" role="alert">
          {resp.error ? (
            <>
              <span className="raw-inspector__error-kind">
                {resp.error.kind}
              </span>
              <span className="raw-inspector__error-message">
                {resp.error.message}
              </span>
            </>
          ) : (
            <span className="raw-inspector__error-message">
              {resp.rawStateError ?? "Request failed."}
            </span>
          )}
        </div>
      )}

      {/* Per-route normalization warnings (Req 17.11). */}
      {resp.warnings.length > 0 && (
        <ul className="raw-inspector__warnings">
          {resp.warnings.map((w, i) => (
            <li key={`${w.engine}:${w.routeIndex}:${i}`}>
              <span className="raw-inspector__warn-kind">{w.kind}</span>{" "}
              {w.message}
            </li>
          ))}
        </ul>
      )}

      {/* The FULL raw body — pretty-printed, collapsible, never sliced. Shown
          on success AND on error when a body exists (Req 11.4). */}
      {hasRaw ? (
        <JsonViewer value={resp.raw} />
      ) : (
        !isError && (
          <p className="raw-inspector__empty">
            No response body was returned.
          </p>
        )
      )}
    </div>
  );
}
