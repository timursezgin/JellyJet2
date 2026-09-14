#!/bin/sh
# Kept for habit: the publish script is tool/deploy.mjs (works on Mac and Windows).
cd "$(dirname "$0")/.." && exec node tool/deploy.mjs
