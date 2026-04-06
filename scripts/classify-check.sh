#!/bin/bash
# classify-check.sh — Verify all .md files have classification frontmatter
# Can be used as a pre-commit hook or standalone audit.
# Exit code: 0 = all classified, 1 = unclassified files found, 2 = CONFIDENTIAL content detected

set -euo pipefail

KB_DIR="$HOME/knowledge-base"
ISSUES=0
CONFIDENTIAL_LEAK=0

echo "=== Classification Audit ==="
echo ""

# Check 1: Every .md file must have classification frontmatter
echo "Checking for missing classifications..."
while IFS= read -r file; do
  # Skip README and index
  basename=$(basename "$file")
  [[ "$basename" == "README.md" || "$basename" == "lint-report.md" ]] && continue

  if ! head -10 "$file" | grep -q 'classification:'; then
    echo "  MISSING: $file"
    ISSUES=$((ISSUES + 1))
  fi
done < <(find "$KB_DIR" -name "*.md" -not -path "*/.obsidian/*" -not -path "*/scripts/*" 2>/dev/null)

# Check 2: Scan for potential secrets/credentials in all files
echo ""
echo "Scanning for potential secrets..."
PATTERNS=(
  'sk-[a-zA-Z0-9]{20,}'      # API keys (OpenAI, Stripe, etc.) — min 20 chars to avoid false positives
  'sk_live_'                   # Stripe live keys
  'sk_test_'                   # Stripe test keys
  'sbp_[a-zA-Z0-9]'          # Supabase keys
  'eyJ[a-zA-Z0-9]'           # JWT tokens (base64 encoded)
  'ghp_[a-zA-Z0-9]'          # GitHub personal access tokens
  'gho_[a-zA-Z0-9]'          # GitHub OAuth tokens
  'password\s*[:=]'           # Hardcoded passwords
  'secret\s*[:=]'             # Hardcoded secrets
  'SUPABASE_SERVICE_ROLE_KEY' # Supabase service role references with values
)

for pattern in "${PATTERNS[@]}"; do
  matches=$(grep -rl "$pattern" "$KB_DIR" --include="*.md" 2>/dev/null | grep -v scripts/ || true)
  if [[ -n "$matches" ]]; then
    echo "  CREDENTIAL PATTERN '$pattern' found in:"
    echo "$matches" | sed 's/^/    /'
    CONFIDENTIAL_LEAK=1
  fi
done

# Check 3: Verify CONFIDENTIAL files are in .gitignore
echo ""
echo "Checking CONFIDENTIAL files are git-ignored..."
while IFS= read -r file; do
  if head -10 "$file" | grep -q 'classification: CONFIDENTIAL'; then
    rel_path="${file#$KB_DIR/}"
    if [[ -f "$KB_DIR/.gitignore" ]] && ! grep -q "$rel_path" "$KB_DIR/.gitignore" 2>/dev/null; then
      echo "  NOT IN .gitignore: $rel_path (CONFIDENTIAL)"
      ISSUES=$((ISSUES + 1))
    fi
  fi
done < <(find "$KB_DIR" -name "*.md" -not -path "*/.obsidian/*" -not -path "*/scripts/*" 2>/dev/null)

# Summary
echo ""
echo "=== Results ==="
if [[ $CONFIDENTIAL_LEAK -eq 1 ]]; then
  echo "CRITICAL: Potential credentials detected. Review and rotate immediately."
  exit 2
elif [[ $ISSUES -gt 0 ]]; then
  echo "WARNING: $ISSUES issue(s) found. Fix classifications before sharing."
  exit 1
else
  echo "ALL CLEAR: Every file is classified, no credentials detected."
  exit 0
fi
