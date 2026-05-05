#!/usr/bin/env bash
# Interactive release: preflight, version bump, commit, tag, push, publish.
# Usage: npm run release  (or ./scripts/release.sh)

set -euo pipefail

cd "$(dirname "$0")/.."

confirm() {
  local prompt="$1"
  local yn
  read -r -p "$prompt [y/N] " yn
  [[ "$yn" =~ ^[Yy]$ ]]
}

pkg_name=$(node -p "require('./package.json').name")
current=$(node -p "require('./package.json').version")

# 1. Preflight
echo "→ Checking working tree is clean..."
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "✗ Working tree has uncommitted changes. Commit or stash first."
  exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != "main" ]]; then
  echo "✗ Not on main (current: $branch)"
  exit 1
fi

echo "→ Fetching origin..."
git fetch origin --tags --quiet || true

remote_head=$(git rev-parse origin/main 2>/dev/null || echo "")
if [[ -n "$remote_head" && "$(git rev-parse HEAD)" != "$remote_head" ]]; then
  echo "⚠ HEAD differs from origin/main."
  confirm "  Continue anyway?" || exit 1
fi

echo "→ Running lint..."
npm run lint

echo "→ Verifying npm login..."
if ! npm whoami >/dev/null 2>&1; then
  echo "✗ Not logged in to npm. Run 'npm login' first."
  exit 1
fi
echo "  Logged in as: $(npm whoami)"

# 2. Prompt
echo
echo "Package: $pkg_name"
echo "Current version: $current"
read -r -p "New version (X.Y.Z): " new_version

if [[ ! "$new_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "✗ Invalid semver: $new_version"
  exit 1
fi

if git rev-parse "v$new_version" >/dev/null 2>&1; then
  echo "✗ Tag v$new_version already exists locally"
  exit 1
fi
if git ls-remote --exit-code --tags origin "v$new_version" >/dev/null 2>&1; then
  echo "✗ Tag v$new_version already exists on origin"
  exit 1
fi

# 3. Plan preview + confirm
echo
echo "Plan:"
if [[ "$new_version" == "$current" ]]; then
  echo "  • Sync package-lock.json to $new_version (current package.json is already $current)"
  echo "  • Create commit '$new_version'"
else
  echo "  • Bump $current → $new_version (package.json + package-lock.json)"
  echo "  • Create commit '$new_version'"
fi
echo "  • Create tag v$new_version"
echo "  • git push --follow-tags"
echo "  • npm publish"
echo
confirm "Continue?" || exit 1

# 4. Bump
if [[ "$new_version" == "$current" ]]; then
  echo "→ Syncing package-lock.json..."
  npm install --package-lock-only --silent
  git add package.json package-lock.json
  git commit --allow-empty -m "$new_version"
  git tag "v$new_version"
else
  echo "→ Running npm version $new_version..."
  npm version "$new_version" -m "%s"
fi

# 5. Tarball preview + confirm
echo
echo "→ Tarball preview (npm pack --dry-run):"
npm pack --dry-run 2>&1 | grep -E "^npm notice" || true
echo

if ! confirm "Push and publish?"; then
  echo
  echo "✗ Aborted before push. Roll back local changes with:"
  echo "    git tag -d v$new_version"
  echo "    git reset --hard HEAD~1"
  exit 1
fi

# 6. Push + publish
echo "→ Pushing..."
git push --follow-tags

echo "→ Publishing to npm..."
npm publish

# 7. Verify
echo "→ Verifying registry..."
sleep 3
remote_version=$(npm view "$pkg_name" version 2>/dev/null || echo "?")
if [[ "$remote_version" == "$new_version" ]]; then
  echo
  echo "✅ Released $pkg_name@$new_version"
  echo "   https://www.npmjs.com/package/$pkg_name"
else
  echo
  echo "⚠ npm view returned '$remote_version', expected '$new_version'."
  echo "   Check https://www.npmjs.com/package/$pkg_name manually."
fi
