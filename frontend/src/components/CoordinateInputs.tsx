/**
 * Manual coordinate inputs with validation (Task 14.1, Req 1.1, 17.4).
 *
 * Renders latitude/longitude entry fields for Start and Destination, bound to
 * the store's `start`/`dest`. As the user types, each field is parsed as a
 * float and validated (lat ∈ [-90, 90], lon ∈ [-180, 180], finite). Invalid
 * fields show an inline error and NEVER write an out-of-range/non-numeric
 * coordinate to the store, so invalid coordinates never reach an engine request
 * (Req 17.4). When both the lat and lon of a point are valid, the store
 * coordinate is updated via `setStart`/`setDest`.
 *
 * Store changes (map clicks, right-click context menu, future test-case loads)
 * are reflected back into the fields via an effect, while the user is still
 * free to type: the local input strings are the source of truth for the text,
 * and are re-synced from the store when the store coordinate actually changes.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { isValidLat, isValidLon } from "../requests";
import type { Coordinate } from "../types";

type Point = "start" | "dest";

/** Format a store coordinate value into an input string ("" when null). */
function fmt(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

interface AxisFieldProps {
  id: string;
  label: string;
  value: string;
  error: string | null;
  onChange: (raw: string) => void;
}

function AxisField({ id, label, value, error, onChange }: AxisFieldProps) {
  return (
    <div className="coord-field">
      <label htmlFor={id} className="coord-field__label">
        {label}
      </label>
      <input
        id={id}
        className={"coord-field__input" + (error ? " coord-field__input--error" : "")}
        type="text"
        inputMode="decimal"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <span id={`${id}-error`} className="coord-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface PointInputsProps {
  point: Point;
  label: string;
  coord: Coordinate | null;
  setCoord: (c: Coordinate | null) => void;
}

/**
 * Lat/lon field pair for a single point. Keeps local text state, validates on
 * each edit, and pushes a valid (lat, lon) pair to the store — or clears the
 * store coordinate when a field is emptied. Invalid input is shown inline and
 * not written to the store.
 */
function PointInputs({ point, label, coord, setCoord }: PointInputsProps) {
  const [latText, setLatText] = useState(() => fmt(coord?.lat));
  const [lonText, setLonText] = useState(() => fmt(coord?.lon));

  // Track the last coord we synced from the store so we only overwrite the
  // user's text when the store value genuinely changes (e.g. a map click),
  // not on every render.
  const lastSynced = useRef<Coordinate | null>(coord);

  useEffect(() => {
    const prev = lastSynced.current;
    const changed =
      (prev?.lat ?? null) !== (coord?.lat ?? null) ||
      (prev?.lon ?? null) !== (coord?.lon ?? null);
    if (changed) {
      setLatText(fmt(coord?.lat));
      setLonText(fmt(coord?.lon));
      lastSynced.current = coord;
    }
  }, [coord]);

  // Compute validation errors from the current text (empty is not an error,
  // it just means "not set yet").
  const latError =
    latText.trim() !== "" && !isValidLat(Number(latText))
      ? "Latitude must be a number between -90 and 90."
      : null;
  const lonError =
    lonText.trim() !== "" && !isValidLon(Number(lonText))
      ? "Longitude must be a number between -180 and 180."
      : null;

  /** Recompute the store coordinate from the two given text values (Req 17.4). */
  function commit(nextLat: string, nextLon: string) {
    const latTrim = nextLat.trim();
    const lonTrim = nextLon.trim();
    const latNum = Number(latTrim);
    const lonNum = Number(lonTrim);
    const bothValid =
      latTrim !== "" &&
      lonTrim !== "" &&
      isValidLat(latNum) &&
      isValidLon(lonNum);

    if (bothValid) {
      const next: Coordinate = { lat: latNum, lon: lonNum };
      // Avoid redundant store writes (and effect churn).
      if (coord?.lat !== next.lat || coord?.lon !== next.lon) {
        lastSynced.current = next;
        setCoord(next);
      }
    } else if (coord !== null) {
      // A field became empty/invalid: clear the (previously valid) store coord
      // so a partial/invalid point never survives as a real coordinate.
      lastSynced.current = null;
      setCoord(null);
    }
  }

  return (
    <fieldset className="coord-point">
      <legend className="coord-point__legend">{label}</legend>
      <AxisField
        id={`${point}-lat`}
        label="Lat"
        value={latText}
        error={latError}
        onChange={(raw) => {
          setLatText(raw);
          commit(raw, lonText);
        }}
      />
      <AxisField
        id={`${point}-lon`}
        label="Lon"
        value={lonText}
        error={lonError}
        onChange={(raw) => {
          setLonText(raw);
          commit(latText, raw);
        }}
      />
    </fieldset>
  );
}

export default function CoordinateInputs() {
  const start = useStore((s) => s.start);
  const dest = useStore((s) => s.dest);
  const setStart = useStore((s) => s.setStart);
  const setDest = useStore((s) => s.setDest);

  return (
    <div className="coordinate-inputs">
      <PointInputs point="start" label="Start" coord={start} setCoord={setStart} />
      <PointInputs
        point="dest"
        label="Destination"
        coord={dest}
        setCoord={setDest}
      />
    </div>
  );
}
