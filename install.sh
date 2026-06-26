#!/usr/bin/env sh
# ntee-r1quest — install / update from source (Codeberg).
#
# Installs directly from source and links it into your global npm, so you can
# track `main` (or any tag) and update with a re-run.
#
# Install / update:
#   curl -fsSL https://codeberg.org/nickoan/ntee-r1quest/raw/branch/main/install.sh | sh
#
# Optional overrides (env vars):
#   NTEE_REF=v0.13.3   pin a tag / branch / commit (default: main)
#   NTEE_REPO=<url>    clone from a mirror instead of Codeberg
#   NTEE_DIR=<path>    install location (default: ~/.ntee-r1quest/source)
set -eu

REPO="${NTEE_REPO:-https://codeberg.org/nickoan/ntee-r1quest.git}"
REF="${NTEE_REF:-main}"
# A subdirectory of the app's home dir, kept separate from its config/cache.
DIR="${NTEE_DIR:-$HOME/.ntee-r1quest/source}"
MIN_NODE_MAJOR=24

red() { printf '\033[31m%s\033[0m\n' "$1" >&2; }
ok() { printf '\033[32m%s\033[0m\n' "$1"; }

case "$(uname -s)" in
  Darwin | Linux) ;;
  *)
    red "ntee-r1quest supports macOS and Linux only (use WSL on Windows)."
    exit 1
    ;;
esac

for cmd in git node npm; do
  command -v "$cmd" >/dev/null 2>&1 || {
    red "'$cmd' is required but was not found in PATH."
    exit 1
  }
done

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt "$MIN_NODE_MAJOR" ]; then
  red "Node.js ${MIN_NODE_MAJOR}+ is required (found $(node -v)). Install it from https://nodejs.org or via nvm."
  exit 1
fi

# Clone on first run; fast-forward the existing checkout on later runs (re-running
# this installer is how you update).
if [ -d "$DIR/.git" ]; then
  ok "Updating existing checkout in $DIR ..."
  git -C "$DIR" fetch --tags origin
  git -C "$DIR" checkout "$REF"
  git -C "$DIR" pull --ff-only origin "$REF" 2>/dev/null || true
else
  ok "Cloning $REPO ($REF) into $DIR ..."
  mkdir -p "$(dirname "$DIR")"
  git clone "$REPO" "$DIR"
  git -C "$DIR" checkout "$REF"
fi

# Force the official npm registry for this session so dependency installs are
# not affected by a local/private registry configured in the environment. This
# only exports the variable for the commands below; the user's npm config is
# left untouched.
export npm_config_registry="https://registry.npmjs.org/"

# npm ci pulls dependencies from the official registry set above (only
# ntee-r1quest itself is built from source here), then build emits dist/.
ok "Installing dependencies and building (registry: $npm_config_registry) ..."
(cd "$DIR" && npm ci && npm run build:ts)

# Done fetching from the registry — drop the override so the rest of the script
# (and anything sourcing it) uses the normal npm config again.
unset npm_config_registry

# Build the Go / Bubble Tea TUI binaries when the Go toolchain is available;
# otherwise the CLI falls back to the bundled Ink TUI at runtime.
if command -v go >/dev/null 2>&1; then
  ok "Building the Go TUI ..."
  (cd "$DIR" && npm run build:tui:dist)
fi

# tsc emits a non-executable entry, so the symlinked command (npm link or the
# ~/.local/bin fallback) needs the exec bit set after each build.
chmod +x "$DIR/dist/index.js"

# Prefer `npm link`; fall back to a user-level symlink when the global npm
# prefix is not writable (common on locked-down machines).
ok "Linking the 'r1q' / 'ntee-r1quest' commands ..."
# Let npm's error through (npm ci/build already succeeded above, so a failure
# here is almost always the global prefix not being writable without sudo).
if (cd "$DIR" && npm link); then
  :
else
  red "npm link failed (see the error above — usually the global npm prefix is"
  red "not writable without sudo). Falling back to a ~/.local/bin symlink."
  mkdir -p "$HOME/.local/bin"
  ln -sf "$DIR/dist/index.js" "$HOME/.local/bin/r1q"
  ln -sf "$DIR/dist/index.js" "$HOME/.local/bin/ntee-r1quest"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) red "Add ~/.local/bin to your PATH:  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
fi

ok "Installed: $(r1q --version 2>/dev/null || echo "(restart your shell, then run 'r1q --version')")"
ok "Next steps:"
ok "  • run 'r1q --init' to create your config (~/.ntee-r1quest/r1qconfig.yaml)"
ok "  • run 'r1q -r <collection>' to start (see the README for all flags)"
ok "  • using Claude Code? 'r1q --install-claude-plugin' adds the R1Quest skills"
ok "Update any time by re-running this installer."
