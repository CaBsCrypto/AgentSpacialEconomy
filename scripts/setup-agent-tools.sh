#!/usr/bin/env bash
# Installs the Stellar tools coding agents use in this repo.
#   - Official Stellar skills (stellar/stellar-dev-skill, Apache-2.0) into .claude/skills/
#   - Raven + Stellar Docs MCP servers are declared in .mcp.json (Claude Code asks to approve them)
#   - Optional: stellar-build (46 skills + 6 personas), project-scoped, with --with-stellar-build
#
# Usage: bash scripts/setup-agent-tools.sh [--with-stellar-build]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_DIR="$ROOT/.claude/skills"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ Official Stellar skills"
git clone --depth 1 -q https://github.com/stellar/stellar-dev-skill "$TMP/stellar-dev-skill"
mkdir -p "$SKILLS_DIR"
for s in agentic-payments dapp assets data standards smart-contracts; do
  rm -rf "$SKILLS_DIR/stellar-$s"
  cp -R "$TMP/stellar-dev-skill/skills/$s" "$SKILLS_DIR/stellar-$s"
done
cp "$TMP/stellar-dev-skill/LICENSE" "$SKILLS_DIR/STELLAR-SKILLS-LICENSE"
echo "  installed into .claude/skills/stellar-*"

echo "→ Stellar docs index"
mkdir -p "$ROOT/docs/reference"
if curl -fsSL https://developers.stellar.org/llms.txt -o "$ROOT/docs/reference/stellar-llms.txt"; then
  echo "  saved docs/reference/stellar-llms.txt"
else
  echo "  could not download llms.txt (continue; agents can use the Stellar Docs MCP)"
fi

if [[ "${1:-}" == "--with-stellar-build" ]]; then
  echo "→ stellar-build (project-scoped)"
  echo "  Note: it installs prompt hooks that rewrite every request, and a learning loop."
  echo "  Fine for planning; consider skipping it during the final build hours."
  curl -fsSL https://raw.githubusercontent.com/kaankacar/stellar-build/main/install.sh | bash -s -- --prefix="$ROOT"
fi

cat <<'EOF'

Next:
  1. Start your agent in the repo root (e.g. `claude`) and approve the MCP servers from .mcp.json.
     Raven signs you in with OAuth on first use.
     Codex: install the skills globally per https://github.com/stellar/stellar-dev-skill#installing
  2. Ask Raven one question to confirm it works, e.g.
     "Which x402 facilitators support stellar:testnet right now?"
EOF
