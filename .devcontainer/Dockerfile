FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# tmux: the seat backend otterpack drives
RUN apt-get update && apt-get install -y --no-install-recommends tmux \
    && rm -rf /var/lib/apt/lists/*

# Agent CLIs: used to build otterpack, and as real harnesses to test `up` against
RUN npm install -g @anthropic-ai/claude-code @openai/codex

# Created here so the named volumes mounted on them start out owned by node
RUN mkdir -p /home/node/.claude /home/node/.codex /home/node/.otterpack \
    && chown -R node:node /home/node/.claude /home/node/.codex /home/node/.otterpack
