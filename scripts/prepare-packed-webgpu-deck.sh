#!/bin/sh
# Build the candidate tarballs under their public names, then install like an external consumer.
set -eu
repo_dir=$(cd "$(dirname "$0")/.." && pwd)
case $# in
  0) app_dir=$(mktemp -d "${TMPDIR:-/tmp}/cosmos-packed-deck.XXXXXX") ;;
  1)
    app_dir=$(cd "$1" && pwd)
    if [ -n "$(ls -A "$app_dir")" ]; then
      echo "The packed consumer requires an empty output directory: $app_dir" >&2
      exit 2
    fi ;;
  *) echo "Usage: $0 [empty-output-directory]" >&2; exit 2 ;;
esac
echo "Preparing standalone app in $app_dir"
pnpm --dir "$repo_dir/experiments/graph-webgpu" run pack:public "$app_dir"
pnpm --dir "$repo_dir/integrations/deck-layers" run pack:public "$app_dir"
cd "$repo_dir/experiments/graph-webgpu/fixtures/deck-consumer"
cp index.html ./*.ts package.json tsconfig.json "$app_dir/"
cd "$app_dir"
mv cosmos.gl-graph-*.tgz graph.tgz
mv cosmos.gl-deck-layers-*.tgz deck-layers.tgz
npm install --strict-peer-deps --no-fund --no-audit --ignore-scripts
npm ls @cosmos.gl/graph @cosmos.gl/deck-layers @deck.gl/core @luma.gl/core @luma.gl/graph
# Serve the installed package's CDN file as a plain script, outside Vite's module graph.
mkdir -p public/standalone
cp "$repo_dir/experiments/graph-webgpu/fixtures/deck-consumer/standalone.html" public/standalone/index.html
cdn_entry=$(node -p "require('./node_modules/@cosmos.gl/graph/package.json').jsdelivr")
cp "node_modules/@cosmos.gl/graph/$cdn_entry" public/standalone/index.min.js
npm run build
echo "Run the browser checks: node \"$repo_dir/scripts/check-packed-webgpu-deck.mjs\" \"$app_dir\""
echo "Open the app: npm --prefix \"$app_dir\" run preview"
