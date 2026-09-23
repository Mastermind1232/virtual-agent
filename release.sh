#!/usr/bin/env bash
# Ship a version. Every check must pass or nothing leaves this machine.
#
# A broken Handlebars template does not error visibly in Foundry, it just
# renders nothing, so the phone silently stops opening. That happened on
# 1.8.9.2 because the compile check was advisory. Here it is a gate.
set -euo pipefail

VERSION=$(node -p "require('./module.json').version")
NOTES=${1:?"usage: ./release.sh \"release notes\""}

echo "── checking ${VERSION}"

for f in scripts/*.js; do node --check "$f"; done
echo "   javascript parses"

for f in templates/*.hbs; do npx -y handlebars@4 "$f" > /dev/null; done
echo "   templates compile"

node -e '
const h = require("fs").readFileSync("templates/agent-ui.hbs", "utf8");
const o = (h.match(/{{#(if|each|unless|with)/g) || []).length;
const c = (h.match(/{{\/(if|each|unless|with)/g) || []).length;
if (o !== c) { console.error(`  block tags unbalanced: ${o} open, ${c} close`); process.exit(1); }
const dO = (h.match(/<div/g) || []).length, dC = (h.match(/<\/div>/g) || []).length;
if (dO !== dC) { console.error(`  div tags unbalanced: ${dO} open, ${dC} close`); process.exit(1); }
'
echo "   tags balance"

node -e '
const s = require("fs").readFileSync("styles/agent.css", "utf8");
let b = 0; for (const ch of s) { if (ch === "{") b++; if (ch === "}") b--; }
if (b !== 0) { console.error(`  stylesheet braces unbalanced by ${b}`); process.exit(1); }
'
echo "   stylesheet balances"

git diff --quiet && git diff --cached --quiet || { git add -A; git commit -qm "${VERSION}: ${NOTES}"; }
grep -q "v${VERSION}/module.zip" module.json || { echo "  module.json download URL does not point at v${VERSION}"; exit 1; }
echo "   manifest points at this version"

git push -q
zip -qr module.zip . -x ".git/*" -x "module.zip" -x "release.sh"
gh release create "v${VERSION}" module.zip -t "Virtual Agent ${VERSION}" -n "${NOTES}" > /dev/null
rm -f module.zip

echo "── shipped v${VERSION}"
