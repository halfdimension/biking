#!/usr/bin/env bash
set -euo pipefail

VALHALLA_SOURCE_ROOT="${VALHALLA_SOURCE_ROOT:-/home/cn004231/harsh/VALHALLA/engine/default/routing-nextgen-routing_nextgen_ETA}"
PROTO_DIR="${VALHALLA_SOURCE_ROOT}/proto"
OUTPUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/app/valhalla_proto"

mkdir -p "${OUTPUT_DIR}"
protoc -I "${PROTO_DIR}" --python_out="${OUTPUT_DIR}" \
  "${PROTO_DIR}/api.proto" \
  "${PROTO_DIR}/options.proto" \
  "${PROTO_DIR}/trip.proto" \
  "${PROTO_DIR}/directions.proto" \
  "${PROTO_DIR}/info.proto" \
  "${PROTO_DIR}/status.proto" \
  "${PROTO_DIR}/common.proto" \
  "${PROTO_DIR}/sign.proto" \
  "${PROTO_DIR}/incidents.proto"

# protoc 3.12 generates sibling imports. Make them package-relative so these
# bindings cannot accidentally resolve a different installed Valhalla schema.
sed -i -E \
  's/^import ([a-z_]+_pb2) as/from app.valhalla_proto import \1 as/' \
  "${OUTPUT_DIR}"/*_pb2.py
sed -i -E \
  's/^from ([a-z_]+_pb2) import/from app.valhalla_proto.\1 import/' \
  "${OUTPUT_DIR}"/*_pb2.py
