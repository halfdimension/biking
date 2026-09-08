/**
 * Reusable, dependency-free collapsible JSON tree viewer (Task 24.1, Req 11.2).
 *
 * Recurses generically over ANY JSON value — it never uses a field allowlist,
 * so every key present in the input is rendered, including custom/unknown
 * engine fields (Req 11.5, 11.6). Objects and arrays render as collapsible
 * nodes; primitives (string / number / boolean / null) render inline.
 *
 * Large-response usability: nodes default to EXPANDED, but any array/object
 * with more than {@link LARGE_THRESHOLD} entries defaults to COLLAPSED with a
 * "{n} items"/"{n} keys" summary the user can expand. This keeps the DOM
 * bounded for huge responses (e.g. OSRM `annotation` arrays) without
 * virtualization, while still preserving every field once expanded.
 */
import { useState } from "react";

/** Arrays/objects larger than this default to collapsed. */
export const LARGE_THRESHOLD = 100;

interface JsonViewerProps {
  value: unknown;
}

type Container = "object" | "array";

function containerKind(value: unknown): Container | null {
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object") return "object";
  return null;
}

/** Entries of an object/array as [key, value] pairs, preserving all keys. */
function entriesOf(value: unknown, kind: Container): [string, unknown][] {
  if (kind === "array") {
    return (value as unknown[]).map((v, i) => [String(i), v]);
  }
  return Object.entries(value as Record<string, unknown>);
}

function summaryLabel(kind: Container, count: number): string {
  if (kind === "array") {
    return count === 1 ? "1 item" : `${count} items`;
  }
  return count === 1 ? "1 key" : `${count} keys`;
}

/** Render a JSON primitive inline with a type-specific class for coloring. */
function Primitive({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="json-viewer__null">null</span>;
  }
  switch (typeof value) {
    case "string":
      return (
        <span className="json-viewer__string">{JSON.stringify(value)}</span>
      );
    case "number":
      return <span className="json-viewer__number">{String(value)}</span>;
    case "boolean":
      return <span className="json-viewer__boolean">{String(value)}</span>;
    default:
      // Fallbacks for values JSON.stringify would normally drop/transform
      // (undefined, bigint, function, symbol). Kept so nothing is silently lost.
      return (
        <span className="json-viewer__unknown">{String(value)}</span>
      );
  }
}

/** A single object/array node with a collapse toggle. */
function Node({
  keyName,
  value,
  isArrayIndex,
  depth,
}: {
  keyName: string | null;
  value: unknown;
  isArrayIndex: boolean;
  depth: number;
}) {
  const kind = containerKind(value);

  // Leaf: render key (if any) + inline primitive.
  if (!kind) {
    return (
      <div className="json-viewer__row" style={{ paddingLeft: depth * 14 }}>
        {keyName !== null && (
          <span
            className={
              "json-viewer__key" +
              (isArrayIndex ? " json-viewer__key--index" : "")
            }
          >
            {keyName}
            <span className="json-viewer__colon">: </span>
          </span>
        )}
        <Primitive value={value} />
      </div>
    );
  }

  const entries = entriesOf(value, kind);
  const count = entries.length;
  // Default collapsed only for large containers (Req 11.2 usability note).
  const [open, setOpen] = useState(count <= LARGE_THRESHOLD);

  const openBrace = kind === "array" ? "[" : "{";
  const closeBrace = kind === "array" ? "]" : "}";

  return (
    <div className="json-viewer__node">
      <div
        className="json-viewer__row json-viewer__row--toggle"
        style={{ paddingLeft: depth * 14 }}
      >
        <button
          type="button"
          className="json-viewer__caret"
          aria-expanded={open}
          aria-label={open ? "Collapse" : "Expand"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "▾" : "▸"}
        </button>
        {keyName !== null && (
          <span
            className={
              "json-viewer__key" +
              (isArrayIndex ? " json-viewer__key--index" : "")
            }
          >
            {keyName}
            <span className="json-viewer__colon">: </span>
          </span>
        )}
        <span className="json-viewer__brace">{openBrace}</span>
        {!open && (
          <>
            <button
              type="button"
              className="json-viewer__summary"
              onClick={() => setOpen(true)}
            >
              {summaryLabel(kind, count)}
            </button>
            <span className="json-viewer__brace">{closeBrace}</span>
          </>
        )}
      </div>

      {open && (
        <>
          <div className="json-viewer__children">
            {entries.map(([k, v]) => (
              <Node
                key={k}
                keyName={k}
                value={v}
                isArrayIndex={kind === "array"}
                depth={depth + 1}
              />
            ))}
          </div>
          <div
            className="json-viewer__row json-viewer__brace"
            style={{ paddingLeft: depth * 14 }}
          >
            {closeBrace}
          </div>
        </>
      )}
    </div>
  );
}

export default function JsonViewer({ value }: JsonViewerProps) {
  return (
    <div className="json-viewer" data-testid="json-viewer">
      <Node keyName={null} value={value} isArrayIndex={false} depth={0} />
    </div>
  );
}
