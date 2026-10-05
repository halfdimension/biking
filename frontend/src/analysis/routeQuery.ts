import type { DebugSegment, Engine } from "../types";
import {
  formatAnalysisNumber,
  type RouteProfile,
  type RouteProfileSegment,
} from "./routeProfile";

export type RouteQueryFieldId =
  | "speed"
  | "defaultSpeed"
  | "density"
  | "roadClass"
  | "surface"
  | "use"
  | "frc"
  | "spdLmt"
  | "spdLmtHgv"
  | "spdLmtBike"
  | "bikeSpeed"
  | "toll"
  | "unpaved"
  | "tunnel"
  | "bridge"
  | "roundabout"
  | "name"
  | "wayId"
  | "edgeId"
  | "distance"
  | "duration"
  | "weight"
  | "datasource"
  | "datasourceName"
  | "fromNodeId"
  | "toNodeId";

export type RouteQueryValueType = "number" | "string" | "boolean" | "enum" | "id";
export type RouteQueryOperator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains";
export type RouteQueryValue = number | string | boolean;

export interface RouteAttributeQuery {
  field: RouteQueryFieldId;
  operator: RouteQueryOperator;
  /** Kept as entered; parsing is registry-driven and IDs never become Numbers. */
  value: string;
}

export interface RouteQueryResult {
  matchingSegmentIds: string[];
  matchingSegments: RouteProfileSegment[];
  matchedDistanceMeters: number;
  matchedPercentage: number;
  totalSegmentCount: number;
  matchingSegmentCount: number;
  missingLengthSegmentCount: number;
  hasIncompleteDistanceCoverage: boolean;
}

export interface RouteQueryFieldDefinition {
  id: RouteQueryFieldId;
  label: string;
  engines: readonly Engine[];
  valueType: RouteQueryValueType;
  extractor: (segment: DebugSegment) => RouteQueryValue | null;
  operators: readonly RouteQueryOperator[];
  displayFormatter: (value: RouteQueryValue) => string;
  unit?: string;
  /** Absolute equality tolerance. Zero means exact numeric equality. */
  numericTolerance?: number;
  /** Derive a finite dropdown from the current route. */
  routeValueOptions?: boolean;
}

const NUMERIC_OPERATORS = ["=", "!=", ">", ">=", "<", "<="] as const;
const STRING_OPERATORS = ["=", "!=", "contains"] as const;
const CATEGORY_OPERATORS = ["=", "!="] as const;
const BOOLEAN_OPERATORS = ["="] as const;

const numberFormat = (value: RouteQueryValue) =>
  typeof value === "number" ? formatAnalysisNumber(value, 3) : String(value);
const textFormat = (value: RouteQueryValue) => String(value);

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function valhallaValue<K extends keyof Extract<DebugSegment, { engine: "valhalla" }>["properties"]>(
  key: K,
): (segment: DebugSegment) => RouteQueryValue | null {
  return (segment) => {
    if (segment.engine !== "valhalla") return null;
    const value = segment.properties[key];
    return typeof value === "number" || typeof value === "string" || typeof value === "boolean"
      ? value
      : null;
  };
}

function osrmValue<K extends keyof Extract<DebugSegment, { engine: "osrm" }>["properties"]>(
  key: K,
): (segment: DebugSegment) => RouteQueryValue | null {
  return (segment) => {
    if (segment.engine !== "osrm") return null;
    const value = segment.properties[key];
    return typeof value === "number" || typeof value === "string" || typeof value === "boolean"
      ? value
      : null;
  };
}

/**
 * Extensible registry for every searchable frontend DebugSegment field.
 * Continuous speed-like values use 0.01 in their displayed units; discrete
 * integer/category fields use exact equality (tolerance 0).
 */
export const ROUTE_QUERY_FIELDS: readonly RouteQueryFieldDefinition[] = [
  {
    id: "speed", label: "Speed (km/h)", engines: ["osrm", "valhalla"],
    valueType: "number", operators: NUMERIC_OPERATORS, unit: "km/h",
    numericTolerance: 0.01, displayFormatter: numberFormat,
    extractor: (segment) => {
      const speed = finite(segment.properties.speed);
      return speed === null ? null : segment.engine === "osrm" ? speed * 3.6 : speed;
    },
  },
  { id: "defaultSpeed", label: "Default Speed", engines: ["valhalla"], valueType: "number", operators: NUMERIC_OPERATORS, unit: "km/h", numericTolerance: 0.01, displayFormatter: numberFormat, extractor: valhallaValue("defaultSpeed") },
  { id: "density", label: "Density", engines: ["valhalla"], valueType: "number", operators: NUMERIC_OPERATORS, numericTolerance: 0, displayFormatter: numberFormat, extractor: valhallaValue("density") },
  { id: "roadClass", label: "Road Class", engines: ["valhalla"], valueType: "enum", operators: CATEGORY_OPERATORS, routeValueOptions: true, displayFormatter: textFormat, extractor: valhallaValue("roadClass") },
  { id: "surface", label: "Surface", engines: ["valhalla"], valueType: "enum", operators: CATEGORY_OPERATORS, routeValueOptions: true, displayFormatter: textFormat, extractor: valhallaValue("surface") },
  { id: "use", label: "Use", engines: ["valhalla"], valueType: "enum", operators: CATEGORY_OPERATORS, routeValueOptions: true, displayFormatter: textFormat, extractor: valhallaValue("use") },
  { id: "frc", label: "FRC", engines: ["valhalla"], valueType: "number", operators: NUMERIC_OPERATORS, numericTolerance: 0, displayFormatter: numberFormat, extractor: valhallaValue("frc") },
  { id: "spdLmt", label: "Speed Limit", engines: ["valhalla"], valueType: "number", operators: NUMERIC_OPERATORS, unit: "km/h", numericTolerance: 0, displayFormatter: numberFormat, extractor: valhallaValue("spdLmt") },
  { id: "spdLmtHgv", label: "HGV Speed Limit", engines: ["valhalla"], valueType: "number", operators: NUMERIC_OPERATORS, unit: "km/h", numericTolerance: 0, displayFormatter: numberFormat, extractor: valhallaValue("spdLmtHgv") },
  { id: "spdLmtBike", label: "Bike Speed Limit", engines: ["valhalla"], valueType: "number", operators: NUMERIC_OPERATORS, unit: "km/h", numericTolerance: 0, displayFormatter: numberFormat, extractor: valhallaValue("spdLmtBike") },
  { id: "bikeSpeed", label: "Bike Speed", engines: ["valhalla"], valueType: "number", operators: NUMERIC_OPERATORS, unit: "km/h", numericTolerance: 0.01, displayFormatter: numberFormat, extractor: valhallaValue("bikeSpeed") },
  ...(["toll", "unpaved", "tunnel", "bridge", "roundabout"] as const).map((id) => ({
    id, label: id[0].toUpperCase() + id.slice(1), engines: ["valhalla"] as const,
    valueType: "boolean" as const, operators: BOOLEAN_OPERATORS,
    displayFormatter: textFormat, extractor: valhallaValue(id),
  })),
  { id: "name", label: "Name", engines: ["valhalla"], valueType: "string", operators: STRING_OPERATORS, displayFormatter: textFormat, extractor: (segment) => segment.engine === "valhalla" && Array.isArray(segment.properties.name) ? segment.properties.name.join(" / ") : null },
  { id: "wayId", label: "Way ID", engines: ["valhalla"], valueType: "id", operators: STRING_OPERATORS, displayFormatter: textFormat, extractor: valhallaValue("wayId") },
  { id: "edgeId", label: "Edge ID", engines: ["valhalla"], valueType: "id", operators: STRING_OPERATORS, displayFormatter: textFormat, extractor: valhallaValue("id") },
  { id: "distance", label: "Distance", engines: ["osrm"], valueType: "number", operators: NUMERIC_OPERATORS, unit: "m", numericTolerance: 0.001, displayFormatter: numberFormat, extractor: osrmValue("distance") },
  { id: "duration", label: "Duration", engines: ["osrm"], valueType: "number", operators: NUMERIC_OPERATORS, unit: "s", numericTolerance: 0.001, displayFormatter: numberFormat, extractor: osrmValue("duration") },
  { id: "weight", label: "Weight", engines: ["osrm"], valueType: "number", operators: NUMERIC_OPERATORS, numericTolerance: 0.001, displayFormatter: numberFormat, extractor: osrmValue("weight") },
  { id: "datasource", label: "Datasource Index", engines: ["osrm"], valueType: "number", operators: NUMERIC_OPERATORS, numericTolerance: 0, displayFormatter: numberFormat, extractor: osrmValue("datasource") },
  { id: "datasourceName", label: "Datasource", engines: ["osrm"], valueType: "enum", operators: CATEGORY_OPERATORS, routeValueOptions: true, displayFormatter: textFormat, extractor: osrmValue("datasourceName") },
  { id: "fromNodeId", label: "From Node ID", engines: ["osrm"], valueType: "id", operators: STRING_OPERATORS, displayFormatter: textFormat, extractor: osrmValue("fromNodeId") },
  { id: "toNodeId", label: "To Node ID", engines: ["osrm"], valueType: "id", operators: STRING_OPERATORS, displayFormatter: textFormat, extractor: osrmValue("toNodeId") },
] as const;

export function routeQueryField(id: RouteQueryFieldId): RouteQueryFieldDefinition {
  return ROUTE_QUERY_FIELDS.find((field) => field.id === id) ?? ROUTE_QUERY_FIELDS[0];
}

export function routeQueryFieldsForEngine(engine: Engine): RouteQueryFieldDefinition[] {
  return ROUTE_QUERY_FIELDS.filter((field) => field.engines.includes(engine));
}

export function defaultRouteQuery(engine: Engine): RouteAttributeQuery {
  const field = routeQueryFieldsForEngine(engine)[0] ?? ROUTE_QUERY_FIELDS[0];
  return { field: field.id, operator: field.operators[0], value: "" };
}

function parseQueryValue(field: RouteQueryFieldDefinition, value: string): RouteQueryValue | null {
  if (field.valueType === "number") {
    if (value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (field.valueType === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
    return null;
  }
  return value === "" ? null : value;
}

function matches(
  actual: RouteQueryValue,
  expected: RouteQueryValue,
  field: RouteQueryFieldDefinition,
  operator: RouteQueryOperator,
): boolean {
  if (field.valueType === "number") {
    if (typeof actual !== "number" || typeof expected !== "number") return false;
    const tolerance = field.numericTolerance ?? 1e-6;
    const equal = Math.abs(actual - expected) <= tolerance;
    if (operator === "=") return equal;
    if (operator === "!=") return !equal;
    if (operator === ">") return actual > expected;
    if (operator === ">=") return actual >= expected;
    if (operator === "<") return actual < expected;
    if (operator === "<=") return actual <= expected;
    return false;
  }
  if (field.valueType === "boolean") return operator === "=" && actual === expected;
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  if (operator === "contains") {
    return actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
  }
  const equal = actual === expected;
  return operator === "=" ? equal : operator === "!=" ? !equal : false;
}

/** O(n) evaluation over the already ordered Phase 1 route profile. */
export function evaluateRouteQuery(
  profile: RouteProfile,
  query: RouteAttributeQuery,
): RouteQueryResult {
  const field = routeQueryField(query.field);
  const expected = parseQueryValue(field, query.value);
  const matchingSegments: RouteProfileSegment[] = [];
  let matchedDistanceMeters = 0;
  let missingLengthSegmentCount = 0;

  if (field.operators.includes(query.operator) && expected !== null) {
    for (const item of profile.segments) {
      if (item.routeId !== profile.routeId || !field.engines.includes(item.engine)) continue;
      const actual = field.extractor(item.segment);
      if (actual === null || !matches(actual, expected, field, query.operator)) continue;
      matchingSegments.push(item);
      if (item.lengthMeters === null) missingLengthSegmentCount += 1;
      else matchedDistanceMeters += item.lengthMeters;
    }
  }

  return {
    matchingSegmentIds: matchingSegments.map((item) => item.debugSegmentId),
    matchingSegments,
    matchedDistanceMeters,
    matchedPercentage:
      profile.totalDistanceMeters > 0
        ? (matchedDistanceMeters / profile.totalDistanceMeters) * 100
        : 0,
    totalSegmentCount: profile.segments.length,
    matchingSegmentCount: matchingSegments.length,
    missingLengthSegmentCount,
    hasIncompleteDistanceCoverage: missingLengthSegmentCount > 0,
  };
}

export function deriveRouteQueryValueOptions(
  profile: RouteProfile,
  field: RouteQueryFieldDefinition,
): string[] {
  if (!field.routeValueOptions) return [];
  const values = new Set<string>();
  for (const item of profile.segments) {
    const value = field.extractor(item.segment);
    if (value !== null) values.add(field.displayFormatter(value));
  }
  return Array.from(values).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}
