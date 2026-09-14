#!/bin/sh
# Kept for habit: see tool/serve-local.mjs (works on Mac and Windows).
cd "$(dirname "$0")/.." && exec node tool/serve-local.mjs
