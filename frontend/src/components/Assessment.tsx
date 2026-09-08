/**
 * Assessment tab (Task 27.1, Req 14.1–14.4, Req 17.11).
 *
 * For each currently returned route (OSRM first, then Valhalla) this renders an
 * assessment card showing the route identity plus:
 *   - a Good / Bad / Neutral / Unrated rating control (Req 14.1), where Unrated
 *     is the ABSENCE of a stored entry (clicking Unrated clears the rating),
 *   - a free-text notes field (Req 14.2),
 *   - any per-route normalization Route_Warnings for that route (Req 17.11),
 *     kept visually SEPARATE from the rating (warnings are not ratings).
 *
 * Assessments are namespaced by the current testcase in the store. When no
 * testcase is current a banner makes clear the ratings are session-only and
 * must be saved to persist (Req 14 — temporary assessment is allowed but the
 * need to save is indicated).
 *
 * Warnings whose route is NOT present in `routes` (e.g. an alternate dropped
 * due to a geometry_error) can't be attached to a card, so they are surfaced in
 * a "Dropped routes" list at the top so geometry errors stay visible (Req
 * 17.11). The component reads `results.osrm.warnings` + `results.valhalla.warnings`.
 *
 * All engine-specific parsing lives in the backend; this component only reads
 * the normalized model and the store (Req 12.4).
 */
import { useStore } from "../store";
import { routeColor } from "../map/color";
import { routeAssessmentKey } from "../assessmentKey";
import { formatDistanceKm, formatDuration, formatCost } from "../format";
import type { NormalizedRoute, RouteQuality, RouteWarning } from "../types";

type Rating = RouteQuality["rating"];

const RATINGS: { value: Rating; label: string }[] = [
  { value: "good", label: "Good" },
  { value: "bad", label: "Bad" },
  { value: "neutral", label: "Neutral" },
];

/** Collect all engine-level warnings from the compare results, in order. */
function allWarnings(
  results: ReturnType<typeof useStore.getState>["results"],
): RouteWarning[] {
  if (!results) return [];
  return [...results.osrm.warnings, ...results.valhalla.warnings];
}

function RatingControl({
  assessmentKey,
  current,
}: {
  /** Deterministic geometry persistence key (`routeAssessmentKey(route)`). */
  assessmentKey: string;
  current: Rating | undefined;
}) {
  const setRating = useStore((s) => s.setRating);
  return (
    <div
      className="assessment-card__ratings"
      role="group"
      aria-label="Route quality rating"
    >
      {RATINGS.map(({ value, label }) => {
        const active = current === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            className={
              "assessment-rating" +
              (active ? " assessment-rating--active" : "") +
              ` assessment-rating--${value}`
            }
            onClick={() => setRating(assessmentKey, value)}
          >
            {label}
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={current == null}
        className={
          "assessment-rating assessment-rating--unrated" +
          (current == null ? " assessment-rating--active" : "")
        }
        onClick={() => setRating(assessmentKey, null)}
      >
        Unrated
      </button>
    </div>
  );
}

function AssessmentCard({ route }: { route: NormalizedRoute }) {
  // Subscribe to the active assessment map so the card re-renders on change.
  const assessments = useStore((s) => s.assessments);
  const sessionAssessments = useStore((s) => s.sessionAssessments);
  const currentTestCaseId = useStore((s) => s.currentTestCaseId);
  const results = useStore((s) => s.results);
  const setAssessmentNotes = useStore((s) => s.setAssessmentNotes);

  // PERSISTENCE identity: a deterministic geometry-based key so a saved rating
  // follows the route's geometry across reruns, independent of its alternate
  // index (Req 14). The VISIBLE identity below (testid, label, swatch) still
  // comes from the index-based `route.id`/route fields — the two are separate.
  const key = routeAssessmentKey(route);
  const namespace = currentTestCaseId
    ? assessments[currentTestCaseId]
    : sessionAssessments;
  const entry = namespace ? namespace[key] : undefined;
  const rating = entry?.rating;
  const notes = entry?.notes ?? "";

  const engineName = route.engine === "osrm" ? "OSRM" : "Valhalla";
  const kind = route.isPrimary ? "Primary" : "Alternate";

  // Warnings for THIS route (match engine + routeIndex) (Req 17.11).
  const warnings = allWarnings(results).filter(
    (w) => w.engine === route.engine && w.routeIndex === route.index,
  );

  return (
    <div className="assessment-card" data-testid={`assessment-card-${route.id}`}>
      <div className="assessment-card__header">
        <span
          className="assessment-card__swatch"
          aria-hidden="true"
          style={{ background: routeColor(route.engine, route.index) }}
        />
        <span className="assessment-card__title">{route.label}</span>
        <span className="assessment-card__kind">{kind}</span>
      </div>

      <dl className="assessment-card__fields">
        <dt>Engine</dt>
        <dd>{engineName}</dd>
        <dt>Distance</dt>
        <dd>{formatDistanceKm(route.distanceMeters)}</dd>
        <dt>Duration</dt>
        <dd>{formatDuration(route.durationSeconds)}</dd>
        <dt>Cost/Weight</dt>
        <dd>{formatCost(route.cost)}</dd>
      </dl>

      <RatingControl assessmentKey={key} current={rating} />

      <label className="assessment-card__notes-label">
        <span>Notes</span>
        <textarea
          className="assessment-card__notes"
          value={notes}
          placeholder="Optional quality notes for this route…"
          onChange={(e) => setAssessmentNotes(key, e.target.value)}
        />
      </label>

      {warnings.length > 0 && (
        <ul className="assessment-card__warnings" data-testid="route-warnings">
          {warnings.map((w, i) => (
            <li key={i} className="assessment-warning">
              <span className="assessment-warning__badge">Warning</span>
              <span className="assessment-warning__kind">{w.kind}</span>
              <span className="assessment-warning__message">{w.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Assessment() {
  const routes = useStore((s) => s.routes);
  const results = useStore((s) => s.results);
  const currentTestCaseId = useStore((s) => s.currentTestCaseId);

  // Warnings that don't correspond to any currently rendered route — e.g. an
  // alternate dropped by the backend due to a geometry_error. Surface these so
  // the error stays visible even though the route isn't in `routes` (Req 17.11).
  const droppedWarnings = allWarnings(results).filter(
    (w) =>
      !routes.some((r) => r.engine === w.engine && r.index === w.routeIndex),
  );

  if (routes.length === 0) {
    return (
      <div className="assessment">
        <p className="assessment__empty">
          No routes yet — run Compare to assess routes.
        </p>
        {droppedWarnings.length > 0 && (
          <DroppedRoutes warnings={droppedWarnings} />
        )}
      </div>
    );
  }

  return (
    <div className="assessment">
      {currentTestCaseId == null && (
        <p className="assessment__banner" role="status" data-testid="assessment-session-banner">
          These assessments are not saved. Save this test case to persist them.
        </p>
      )}

      {droppedWarnings.length > 0 && <DroppedRoutes warnings={droppedWarnings} />}

      <div className="assessment__cards">
        {routes.map((route) => (
          <AssessmentCard key={route.id} route={route} />
        ))}
      </div>
    </div>
  );
}

function DroppedRoutes({ warnings }: { warnings: RouteWarning[] }) {
  return (
    <div className="assessment__dropped" data-testid="dropped-routes">
      <h3 className="assessment__dropped-title">Dropped routes</h3>
      <ul className="assessment__dropped-list">
        {warnings.map((w, i) => (
          <li key={i} className="assessment-warning">
            <span className="assessment-warning__badge">Warning</span>
            <span className="assessment-warning__route">
              {w.engine === "osrm" ? "OSRM" : "Valhalla"} #{w.routeIndex}
            </span>
            <span className="assessment-warning__kind">{w.kind}</span>
            <span className="assessment-warning__message">{w.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
