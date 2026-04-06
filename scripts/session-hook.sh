#!/bin/bash
# session-hook.sh — Claude Code Stop hook wrapper
# Runs session-extract.sh in the background so it doesn't block conversation end.
# Add to Claude Code settings: hooks.Stop = [{ "command": "~/knowledge-base/scripts/session-hook.sh" }]

nohup ~/knowledge-base/scripts/session-extract.sh > /dev/null 2>&1 &
