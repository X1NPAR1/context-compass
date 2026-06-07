# Context Compass Hook Integration

## What was verified

Using current Claude Code docs:

- Hook events include `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `Notification`, and others.
- `UserPromptSubmit` supports adding context to Claude before prompt processing.
- Context can be injected via:
  - plain stdout text (exit code 0), or
  - JSON output with `hookSpecificOutput.additionalContext`.
- Hook configuration is supported in:
  - `~/.claude/settings.json`,
  - `.claude/settings.json`,
  - `.claude/settings.local.json`.

References:

- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/cli-reference

## Chosen approach

Primary path is `UserPromptSubmit` command hook with JSON output:

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "..."
  }
}
```

This is used because it injects context per-prompt with low latency and does not require model-side fallback behavior.

Registration target is `.claude/settings.local.json` and merge is idempotent (no clobber of existing hooks).

## Runtime behavior

1. User submits prompt in Claude Code.
2. Hook command `context-compass hook-prompt` runs.
3. Hook reads JSON stdin event payload, extracts prompt text.
4. Context Compass selects relevant bundles from `.context-compass/index.db`.
5. Hook returns `additionalContext` via JSON.
6. Hook also writes `.context-compass/active-context.md` for diagnostics.

If enrichment fails, hook returns `{ "continue": true }` so raw prompt proceeds unchanged.

## Degraded fallback (only when hook registration is unavailable)

If Context Compass cannot register hooks, it enables a file-based fallback:

1. Generates `.context-compass/PROJECT_MAP.md` (module overview + hot functions + top PMI connections).
2. Ensures `CLAUDE.md` references `@.context-compass/PROJECT_MAP.md`.

This fallback is less dynamic than per-prompt enrichment but preserves a navigation speedup.
