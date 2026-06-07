# Context Compass Integration Test

Date: 2026-04-03
Target repo: `~/test-compass/flask`
Context Compass repo: `<local-path> Compass/`

## 1) Init wiring test

Command:

```bash
node <local-path> Compass/dist/cli.js init
```

Result:

- Index built: `1103 functions`, `1170 PMI connections`, `1.69s`
- MCP config: `.mcp.json` present with `context-compass -> context-compass serve`
- SessionStart hook: `.claude/settings.local.json` contains `context-compass hook-session-start`
- Legacy `UserPromptSubmit` Context Compass hook is removed by default
- Skills installed:
  - `.claude/skills/context-compass-explore/SKILL.md`
  - `.claude/skills/context-compass-review/SKILL.md`

## 2) Claude session behavior (`claude`, no explicit MCP instruction)

MCP connectivity check:

```bash
claude mcp list
```

Result: `context-compass ... ✓ Connected`

Prompt tested:

```text
What does the Flask.route decorator do?
```

Observed tool order (first calls):

1. `ToolSearch`
2. `mcp__context-compass__get_relevant_context`
3. `mcp__context-compass__search_functions`
4. `mcp__context-compass__get_function_bundle`
5. `Grep`
6. `Read`

Counts:

- MCP calls: `3`
- Read-style calls (`Read/Grep/Glob/LS`): `2`

Conclusion: MCP was used before any file read.

## 3) Skill invocation test

Prompt tested:

```text
use the context-compass-explore skill to help me understand the testing infrastructure
```

Observed tool order (prefix):

1. `Skill`
2. `ToolSearch`
3. `mcp__context-compass__get_project_overview`
4. `mcp__context-compass__get_relevant_context`
5. `ToolSearch`
6. `mcp__context-compass__get_function_bundle`
7. `mcp__context-compass__get_function_bundle`
8. `mcp__context-compass__get_function_bundle`
9. `Read`
10. `Read`

Counts:

- Skill calls: `1`
- MCP calls: `5`
- Read-style calls: `2`

Conclusion: Claude loaded the skill and followed MCP-first exploration flow.

## 4) No explicit mention test

Prompt tested:

```text
there's a bug in the session handling
```

Observed tool order (prefix):

1. `ToolSearch`
2. `mcp__context-compass__get_relevant_context`
3. `Read`
4. `Bash`

Counts:

- MCP calls: `1`
- Read-style calls: `1`

Conclusion: Claude proactively called `get_relevant_context` from SessionStart guidance, then did targeted file work.

## Artifacts

- `/tmp/cc_sessionstart_test1.jsonl`
- `/tmp/cc_sessionstart_test2.jsonl`
- `/tmp/cc_sessionstart_test3.jsonl`
