# Context Compass Claims

## Current benchmark claim (verified)

On Flask held-out git sessions (`context-compass eval`):

- Claude baseline (same-file heuristic): `28,206` tokens, `54.3%` Recall@10
- Context Compass: `18,313` tokens, `86.2%` Recall@10

This is:

- `9,893` fewer tokens
- `35.1%` token reduction
- `1.5x` fewer tokens
- `+31.9` recall points (`1.59x` recall)

## Source of truth

Run these commands in the target repo:

```bash
context-compass eval
context-compass eval --json
```

The JSON output is the canonical machine-readable benchmark format.

## Notes on claim language

- Public claim should be stated as repository-specific unless multiple repos are benchmarked.
- Preferred wording today: "In Flask held-out evaluation, Context Compass used 35% fewer tokens at higher recall (86.2% vs 54.3%)."
