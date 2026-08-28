# Runbook — Lua platform

## First-time setup

```bash
npm install -g lua-cli
lua auth configure          # choose Email, enter your address, paste the 6-digit code
```

There is no separate dashboard signup. The CLI generates and stores an API key for you.

```bash
lua init                    # choose "Create new agent"
```

`lua init` writes `lua.skill.yaml`. That file is CLI-managed — do not hand-edit it. Your agent id
appears there; you need it for the portal and for the WhatsApp test link.

## Everyday loop

```bash
npm run check               # typecheck, knowledge-base freshness, tests
lua push                    # upload, staged but not live
lua chat -e sandbox -t dev --clear -m "How many annual leave days do I have?"
lua deploy                  # promote the staged build to production
```

`lua push` stages. `lua deploy` promotes. `--auto-deploy` does both. Test in sandbox first: the
production agent is what your WhatsApp number and portal talk to.

## Environment variables

`.env` covers sandbox only. Production variables live on the server:

```bash
lua env                     # interactive: choose Production, then add/update
```

## Loading the knowledge base

The markdown under `kb/` is compiled into the bundle by `npm run kb:build`. It is not read from disk
at runtime — the tool runtime executes a bundle, not a checkout.

After a push, ask the agent as an HR user:

> reindex the knowledge base

That runs `reindex_knowledge_base`, which is idempotent by document id: a rerun updates entries
rather than duplicating them.

## Diagnostics

```bash
lua test skill --name calculate_gratuity --input '{"country":"SA","monthlyWage":12000,"hireDate":"2018-03-01","endDate":"2026-03-01","separationReason":"resignation"}'
lua logs --type skill --limit 20
```

`lua test` runs a tool in isolation with no model involved. `lua chat` runs the whole agent. When a
tool works under `lua test` but the agent never calls it, the problem is the skill `context`, not the
tool.

## Gotchas

- **`User.get()` can return null.** Every tool here handles that; new tools must too.
- **`Data.search` and `Data.get` return different shapes.** `search` gives a flat proxied array
  (`r.title`); `get` gives an envelope (`r.data[i].data.title`).
- **Skill and tool `condition()` are fail-closed.** If the check throws or times out, the tool is
  hidden. That is the behaviour we want for the HR-only tools, but it means a broken `currentEmployee`
  lookup makes tools silently vanish rather than erroring.
