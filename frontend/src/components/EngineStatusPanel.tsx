/**
 * Per-engine status / error / warning panel (Task 28.1, Req 17.1, 17.2, 17.3,
 * 17.8, 17.9, 17.12, 17.13).
 *
 * Reads a SINGLE engine's envelope from `results[engine]` and renders that
 * engine's cross-engine state in isolation. It never reads or depends on the
 * OTHER engine's envelope, so one engine's error can never gate or hide the
 * other engine's status/routes (Req 17.13 error isolation). This mirrors the
 * backend's independent per-engine `EngineResult` envelopes.
 *
 * States rendered, per engine:
 *   - `results` is null (no compare yet): a muted idle hint.
 *   - `status === "error"`: the actionable message from {@link engineResultMessage}
 *     in a `role="alert"` block, clearly labeled with the engine. This is the
 *     per-engine error state (Req 17.1, 17.2, 17.3, 17.12) — no stack traces,
 *     no "Failed to fetch".
 *   - `status === "ok"`: a brief OK line (route count + request time). When the
 *     engine returned exactly ONE route (the primary, zero alternates) a
 *     "No alternatives returned." NOTE is shown (Req 17.9) — styled as a note,
 *     NOT an error, and NOT confused with no_route.
 *
 * Independently of the ok/error state, every per-route Route_Warning for this
 * engine (`results[engine].warnings`) is surfaced with engine + affected route
 * index + kind + message (Req 17.8, 17.11), visually distinct from the error
 * state. Warnings never remove the panel or the engine's valid sibling routes.
 *
 * Stable data-testids let tests and headless CDP target each region:
 *   engine-status-<engine>, engine-error-<engine>, engine-ok-<engine>,
 *   engine-no-alternates-<engine>, engine-warning-<engine>-<routeIndex>.
 */
import { useStore } from "../store";
import { engineDisplayName, engineResultMessage } from "../engineError";
import { formatDurationMs } from "../format";
import type { Engine } from "../types";

export default function EngineStatusPanel({ engine }: { engine: Engine }) {
  // Subscribe ONLY to this engine's envelope. Reading `results` (the whole
  // object) is fine — we index a single engine and never branch on the sibling.
  const results = useStore((s) => s.results);
  const name = engineDisplayName(engine);

  // No compare run yet: minimal muted idle hint.
  if (results == null) {
    return (
      <div
        className="engine-status engine-status--idle"
        data-testid={`engine-status-${engine}`}
      >
        <span className="engine-status__name">{name}</span>
        <span className="engine-status__idle">No results yet.</span>
      </div>
    );
  }

  const envelope = results[engine];
  const warnings = envelope.warnings;

  return (
    <div
      className="engine-status"
      data-testid={`engine-status-${engine}`}
    >
      {envelope.status === "error" ? (
        <div
          className="engine-status__error"
          role="alert"
          data-testid={`engine-error-${engine}`}
        >
          <span className="engine-status__error-label">{name} error</span>
          <span className="engine-status__error-message">
            {engineResultMessage(envelope) ?? `${name} returned an error.`}
          </span>
        </div>
      ) : (
        <div
          className="engine-status__ok"
          data-testid={`engine-ok-${engine}`}
        >
          <span className="engine-status__ok-badge">{name} OK</span>
          <span className="engine-status__ok-detail">
            {envelope.normalizedRoutes.length}{" "}
            {envelope.normalizedRoutes.length === 1 ? "route" : "routes"}
            {" · "}
            {formatDurationMs(envelope.durationMs)}
          </span>
          {/* Zero alternates: exactly one (primary) route. NOT an error and NOT
              no_route — a plain informational note (Req 17.9). */}
          {envelope.normalizedRoutes.length === 1 && (
            <span
              className="engine-status__note"
              data-testid={`engine-no-alternates-${engine}`}
            >
              No alternatives returned.
            </span>
          )}
        </div>
      )}

      {/* Per-route warnings for THIS engine, independent of ok/error state
          (Req 17.8, 17.11). Valid sibling routes remain usable. */}
      {warnings.length > 0 && (
        <ul
          className="engine-status__warnings"
          data-testid={`engine-warnings-${engine}`}
        >
          {warnings.map((w, i) => (
            <li
              key={`${w.routeIndex}-${i}`}
              className="engine-warning"
              data-testid={`engine-warning-${engine}-${w.routeIndex}`}
            >
              <span className="engine-warning__badge">Warning</span>
              <span className="engine-warning__route">
                {name} #{w.routeIndex}
              </span>
              <span className="engine-warning__kind">{w.kind}</span>
              <span className="engine-warning__message">{w.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
