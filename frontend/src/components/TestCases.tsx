/**
 * Saved Test Cases panel (Task 26.1, Req 13).
 *
 * Provides "Save Current Test", "Load", "Rename", and "Delete" controls for
 * managing coordinate pairs saved to localStorage (Req 13.2). Persistence and
 * hydration live in the store / `persistence.ts`; this component is presentation
 * + wiring only.
 *
 * Key behaviours:
 *   - Save is DISABLED (with a hint) until both start and destination are valid
 *     (Req 13.3). Clicking it saves the current coordinates, optionally under a
 *     typed name.
 *   - Load restores the coordinates and fits the map, but NEVER triggers a
 *     Compare — the user must click Compare themselves (Req 13.4, 13.5). Request
 *     previews regenerate automatically from the restored coordinates.
 *   - Rename edits inline; Delete confirms via window.confirm before removing.
 *   - Each row can carry optional free-text notes.
 *   - The currently loaded testcase is visually indicated.
 */
import { useState } from "react";
import { useStore } from "../store";
import { isValidLat, isValidLon } from "../requests";
import type { Coordinate, TestCase } from "../types";

/** Compact "lat, lon → lat, lon" summary for a saved testcase. */
function coordSummary(start: Coordinate, dest: Coordinate): string {
  const f = (n: number) => n.toFixed(4);
  return `${f(start.lat)}, ${f(start.lon)} → ${f(dest.lat)}, ${f(dest.lon)}`;
}

interface RowProps {
  testCase: TestCase;
  isCurrent: boolean;
}

function TestCaseRow({ testCase, isCurrent }: RowProps) {
  const loadTestCase = useStore((s) => s.loadTestCase);
  const renameTestCase = useStore((s) => s.renameTestCase);
  const deleteTestCase = useStore((s) => s.deleteTestCase);
  const setTestCaseNotes = useStore((s) => s.setTestCaseNotes);

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(testCase.name);

  const commitRename = () => {
    const trimmed = nameDraft.trim();
    if (trimmed !== "" && trimmed !== testCase.name) {
      renameTestCase(testCase.id, trimmed);
    }
    setRenaming(false);
  };

  const handleDelete = () => {
    if (
      window.confirm(
        `Delete test case "${testCase.name}"? This also removes its saved assessments.`,
      )
    ) {
      deleteTestCase(testCase.id);
    }
  };

  return (
    <li
      className={"testcases__row" + (isCurrent ? " testcases__row--current" : "")}
    >
      <div className="testcases__row-head">
        {renaming ? (
          <input
            className="testcases__rename-input"
            value={nameDraft}
            autoFocus
            aria-label={`Rename ${testCase.name}`}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setNameDraft(testCase.name);
                setRenaming(false);
              }
            }}
            onBlur={commitRename}
          />
        ) : (
          <span className="testcases__name" title={testCase.name}>
            {testCase.name}
            {isCurrent ? (
              <span className="testcases__current-badge"> (loaded)</span>
            ) : null}
          </span>
        )}
      </div>

      <div className="testcases__coords">
        {coordSummary(testCase.start, testCase.dest)}
      </div>

      <div className="testcases__actions">
        <button
          type="button"
          className="testcases__btn"
          onClick={() => loadTestCase(testCase.id)}
        >
          Load
        </button>
        <button
          type="button"
          className="testcases__btn"
          onClick={() => {
            setNameDraft(testCase.name);
            setRenaming(true);
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className="testcases__btn testcases__btn--danger"
          onClick={handleDelete}
        >
          Delete
        </button>
      </div>

      <input
        className="testcases__notes"
        type="text"
        placeholder="Notes (optional)"
        aria-label={`Notes for ${testCase.name}`}
        value={testCase.notes ?? ""}
        onChange={(e) => setTestCaseNotes(testCase.id, e.target.value)}
      />
    </li>
  );
}

export default function TestCases() {
  const start = useStore((s) => s.start);
  const dest = useStore((s) => s.dest);
  const testCases = useStore((s) => s.testCases);
  const currentTestCaseId = useStore((s) => s.currentTestCaseId);
  const saveTestCase = useStore((s) => s.saveTestCase);

  const [nameDraft, setNameDraft] = useState("");

  // Save requires both start and destination present and valid (Req 13.3).
  const canSave =
    !!start &&
    !!dest &&
    isValidLat(start.lat) &&
    isValidLon(start.lon) &&
    isValidLat(dest.lat) &&
    isValidLon(dest.lon);

  const handleSave = () => {
    if (!canSave) return;
    if (saveTestCase(nameDraft)) {
      setNameDraft("");
    }
  };

  return (
    <div className="testcases">
      <div className="testcases__save">
        <input
          className="testcases__save-name"
          type="text"
          placeholder="Name (optional)"
          aria-label="New test case name"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
        />
        <button
          type="button"
          className="testcases__save-btn"
          onClick={handleSave}
          disabled={!canSave}
          title={
            canSave
              ? "Save the current start and destination as a test case."
              : "Set a valid start and destination first."
          }
        >
          Save Current Test
        </button>
      </div>
      {!canSave ? (
        <p className="testcases__hint">
          Set a valid start and destination to save a test case.
        </p>
      ) : null}

      {testCases.length === 0 ? (
        <p className="testcases__empty">No saved test cases yet.</p>
      ) : (
        <ul className="testcases__list">
          {testCases.map((tc) => (
            <TestCaseRow
              key={tc.id}
              testCase={tc}
              isCurrent={tc.id === currentTestCaseId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
