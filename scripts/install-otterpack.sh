#!/bin/sh
# Install otterpack in a devcontainer. Copy this file to your project's .devcontainer/ and run it
# from devcontainer.json (postCreateCommand and postAttachCommand). It never fails the container
# build: on any problem it prints what to do and exits 0. It skips the install when the right
# version is already there, so it is cheap to run on every attach.
#
# Change TAG to upgrade; the next rebuild or window reload installs it. A fork can set
# OTTERPACK_REPO (and OTTERPACK_TAG) in the environment instead of editing this file.
TAG=${OTTERPACK_TAG:-v0.4.0}
REPO=${OTTERPACK_REPO:-https://github.com/soatdev-it/otterpack.git}

say() { echo "otterpack install: $*"; }

if command -v otterpack >/dev/null 2>&1 && [ "v$(otterpack --version 2>/dev/null)" = "$TAG" ]; then
  say "$TAG already installed"
  exit 0
fi

# A private repo (a fork, say) needs a git login over HTTPS: the GitHub CLI's (kept across
# rebuilds when ~/.config/gh is a volume) or the one VS Code forwards from your machine.
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh auth setup-git >/dev/null 2>&1
fi
if ! tags=$(GIT_TERMINAL_PROMPT=0 git ls-remote --tags "$REPO" 2>&1); then
  say "can't read $REPO (offline, or a private repo without a login?): $(echo "$tags" | head -1)"
  say "Run: gh auth login && gh auth setup-git && sh $0"
  exit 0
fi
if ! echo "$tags" | grep -q "refs/tags/$TAG\$"; then
  say "$REPO has no tag $TAG: check TAG at the top of $0"
  exit 0
fi

d=$(mktemp -d)
if git -c advice.detachedHead=false clone -q --depth 1 --branch "$TAG" "$REPO" "$d/src" 2>"$d/err" &&
  pkg=$(cd "$d" && npm pack --silent "$d/src" 2>>"$d/err") &&
  npm install -g "$d/$pkg" >>"$d/err" 2>&1; then
  say "installed $TAG ($(command -v otterpack || echo "not on PATH: check \$(npm config get prefix)/bin"))"
else
  say "install of $TAG failed:"
  sed 's/^/  /' "$d/err" | tail -20
  say "fix the cause, then run: sh $0"
fi
rm -rf "$d"
exit 0
