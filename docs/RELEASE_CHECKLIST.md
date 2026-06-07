# Release Checklist

Use this checklist before publishing `context-compass` to npm.

## 1) Validate release gates

```bash
npm ci
npm run release:check
```

Expected:
- typecheck passes
- `npm audit --omit=dev` reports no high/moderate vulnerabilities
- `npm pack --dry-run` succeeds and package contents look correct

## 2) Validate CLI smoke behavior

```bash
node dist/cli.js --version
node dist/cli.js --help
```

## 3) Validate functional smoke on a test repo

```bash
context-compass init
context-compass eval --json
context-compass serve
```

Expected:
- `init` installs `.mcp.json`, SessionStart hook, and skills
- `eval --json` emits valid JSON
- `serve` starts MCP stdio server without crashing

## 4) Version + tag

- Bump `package.json` version (semver)
- Commit changelog/release notes
- Create and push tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

## 5) Publish

```bash
npm login
npm publish --access public --provenance
```

## 6) Rollback path

If publish is bad:
- prefer immediate patch release (`X.Y.Z+1`) with fix
- use `npm deprecate` for bad versions if needed
- avoid unpublish except for immediate accidental publish windows per npm policy
