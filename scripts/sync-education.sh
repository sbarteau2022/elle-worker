#!/usr/bin/env bash
# Re-vendor the education engine from a sibling CustomCourseBuilder checkout.
# Usage: scripts/sync-education.sh [path-to-CustomCourseBuilder]
set -euo pipefail

CCB="${1:-../CustomCourseBuilder}"
DEST="$(dirname "$0")/../src/education"

[ -d "$CCB/src/runtime" ] || { echo "CustomCourseBuilder not found at $CCB" >&2; exit 1; }

(cd "$CCB" && npm run --silent build)

header() {
  printf '// VENDORED from CustomCourseBuilder %s — do not hand-edit.\n// Authoring, tests, and CLI live in that repo; re-sync with\n// scripts/sync-education.sh after building there.\n' "$1"
}

vendor() { # vendor <src-rel-path> <dest-name>
  { header "$1"; sed 's|from "../types/course.ts"|from "./course-types.ts"|' "$CCB/$1"; } > "$DEST/$2"
}

vendor src/types/course.ts    course-types.ts
vendor src/runtime/state.ts   state.ts
vendor src/runtime/signals.ts signals.ts
vendor src/runtime/engine.ts  engine.ts
vendor src/runtime/seal.ts    seal.ts
vendor src/runtime/brief.ts   brief.ts
cp "$CCB/dist/courses/ai-engineer-stack.json" "$DEST/courses/ai-engineer-stack.json"
cp "$CCB/docs/FACILITATOR.md" "$DEST/FACILITATOR.md"

echo "education vendored from $CCB — run: npx tsc --noEmit && npx vitest run src/education"
