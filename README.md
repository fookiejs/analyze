# @fookiejs/analyze

A dependency-free observability UI for a running fookie app: an application map, live runs, the outbox
and saga state, logs, metrics and traces. No build step, no frontend framework, no runtime dependency
beyond `node:http` and `zod`.

```ts
import { analyze } from "@fookiejs/analyze";

const server = analyze(app, { ...defaultOptions(), port: ["4300"] });
console.log(`http://127.0.0.1:4300/?token=${server.accessToken()}`);
```

`analyze()` takes anything satisfying the structural `AnalyzeSource` port — `App` satisfies it — so the
package can be exercised with no database at all.

## Read this before you expose it

**This surface is strictly more sensitive than your app's own API.** Your API answers through model
flows, which is where filtering and authorization live. Analyze reads the engine's own tables and
buffers, so it bypasses all of them. It serves:

- every log line the app has emitted, including the fields your flows attached to them
- `fookie_run.body` — the **entire create body of every mutation**, so whatever your app accepts,
  including anything secret a caller sent
- `fookie_outbox.input` and `output` — every payload handed to or returned by an external

**Never put this on a public address, and never proxy `App.sql` over HTTP.** Raw SQL is a
developer-authored statement with bound parameters; behind an HTTP endpoint it becomes an
attacker-authored statement instead.

### Signing in

There are no accounts and no passwords. Analyze has no user store and should not invent one, and core
has no concept of identity to borrow. What it has is a single access token, and the app that embeds the
dashboard decides where that token comes from:

```ts
analyze(app, { ...defaultOptions(), port: ["4300"], token: [process.env.ANALYZE_TOKEN] });
```

Pass nothing and one is generated at boot, so a forgotten config never leaves the surface open. Print
it, or pin it from your secret store so the link survives a restart.

The token reaches the browser once. A `?token=…` in the address bar is consumed on load, kept in
`sessionStorage`, and stripped from the URL, so a refresh works and the token stops travelling in
history, bookmarks and screenshots. Arrive without one and you get a sign-in card to paste it into.

The page shell is served without a token because it carries no data. Every `/api/*` endpoint stays
behind `timingSafeEqual`, which is what the tests assert.

### What the defaults do for you

| Default          | Behaviour                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Bind address     | `127.0.0.1`. Loopback only unless you opt out.                                                                 |
| Token            | Required. Generated (24 random bytes) if you don't supply one.                                                 |
| Token comparison | `crypto.timingSafeEqual`, after a length check. Never stored in a cookie.                                      |
| Origin           | A request carrying a foreign `Origin` is refused. No CORS headers are ever sent.                               |
| Methods          | GET only. There are no write endpoints in v1, by design.                                                       |
| CSP              | `default-src 'none'` with one per-response nonce shared by the header, the inline style and the inline script. |
| Redaction        | A key deny-list applied at any depth to run bodies, outbox inputs and log fields, on by default.               |
| Page size        | Capped at 500 rows regardless of what the caller asks for.                                                     |
| Live viewers     | Capped at 16 SSE clients; one interval fans each tick out to all of them.                                      |

There is deliberately no retry-the-dead-letter button. A write endpoint behind dev-grade auth is a
worse trade than walking over to a psql prompt.

## Where the numbers come from

Worth being exact, because two of these are durable and three are not:

| What                 | Source                                                                                        | Survives a restart |
| -------------------- | --------------------------------------------------------------------------------------------- | ------------------ |
| Outbox rows          | `fookie_outbox` in Postgres, read through `app.outboxList()`                                  | yes                |
| Runs and their phase | `fookie_run` in Postgres, read through `app.runList()`                                        | yes                |
| Logs                 | an in-memory ring inside the app process, written by `flow.log(...)`                          | **no**             |
| Metrics              | the same ring set, written by `flow.metric.*`                                                 | **no**             |
| Traces               | the same, written by the span the engine wraps around every operation and every external call | **no**             |

The three rings hold ten thousand entries each and drop the oldest — measured at roughly **eighteen
minutes** of history on the demo. OpenTelemetry is present as an **API only**: there is no SDK and no
exporter anywhere in core, so the tracer is a no-op and these buffers are the entire record. They die
with the process. "What happened last night" is a question analyze cannot answer today, and that is a
decision waiting to be made rather than an oversight.

## Why it failed, in the interface

Clicking a step — in the operations tree or in the outbox table — opens a drawer that answers the only
question that matters when something is wrong:

- **Why it failed**, quoting the reason the external reported, not a generic status
- the **input it was given** and, for a completed step, the **output it returned**
- attempt count, step index, and whether the step is itself an undo of another
- when it started and how long it took, taken from the span
- a link back to the request, and the lines that request logged

Redaction still applies to both the input and the output. The deny list deliberately does **not** match
a bare `auth`, because `authId` is how you correlate a payment across the authorise and capture steps
and hiding it would make the drawer useless; `authorization`, `token`, `secret` and `credential` are
still removed. Add to `defaultSensitiveKeys` rather than replacing it if your bodies carry something
else.

## Every page is about the same request

A request id is clickable wherever it appears — in the logs, in the outbox, on an operation in the
tree. Clicking it follows that request: the map draws it, a bar at the top names it, and the logs and
outbox narrow to it. The bar carries links back to each view and a way to stop following.

A followed request reads its own outbox rows rather than filtering the shared window, so it stays
correct however far back the request is. When a filtered view is empty it says why — logs live in
memory only, so an old request genuinely has nothing left to show.

The canvas opens showing everything, flows and relations together, with switches to look at one plane
at a time.

## It streams deltas, not the world

The dashboard used to refetch everything on every tick: measured at **~4 MB every three seconds**, of
which 3.8 MB was the observability page alone. Core has always returned `nextSeq` and `oldestSeq` so a
client can ask only for what is new, and this one ignored both.

It now carries a cursor and merges what arrives into bounded local buffers — measured at **32 to 140 KB
per tick**, proportional to what happened rather than to how much history exists. The catalog, the map
and the listings refresh every fourth tick, since their shape changes far more slowly than the log does.

`oldestSeq` is what makes that honest rather than merely cheap: when the ring drops entries a client
never saw, the sidebar says how many instead of quietly skipping them.

## The map is two maps

The **declared** map comes from `catalog()`: model cards, external cards, relation edges and
compensation pairs. It describes your **data model, not your call graph** — which model calls which
external is decided inside flow function bodies and is not statically recoverable. The UI says so on
the page.

The **observed** map is the real one. Model→external edges come from `fookie_outbox` grouped by
`(model, name, status)`: durable, indexed, and it survives a restart. Model→model edges come from the
parent the engine records at the one place nesting actually happens, not from guessing at span
time-containment.

Layout is layered (Sugiyama-lite) and computed **server-side** in TypeScript, so it is typed,
unit-tested and deterministic. Not force-directed: a map that jitters on every refresh is one you
cannot visually diff.

The layering breaks cycles before it ranks anything, which is not optional: relation edges point
child to parent while nesting edges point parent to child, so a model that nests a child which also
references it forms a two node cycle. Without cycle breaking the whole map collapses into a single
column.

## One request at a time

The map answers two different questions and should not confuse them. The declarative view says what
the application _can_ do. Pick a request from the rail and the same map says what _that run_ did:
each external card takes the colour of its outcome in that run — completed, still pending, dead
lettered — the model card carries the run's phase, and everything the run never touched fades out.
The rail names what it is waiting on right now, if anything.

A real run reads as a sentence: reserve completed, charge dead lettered, release completed. That is a
saga that paid for nothing and correctly gave the stock back.

## The map reads left to right

A saga is a sequence, so the map draws it as one. Each successive step sits **one column further right**
than the step before it, and a compensation sits one column after the step it undoes. A five step order
flow spreads across five columns instead of stacking in a single pile, which is the difference between
seeing a shape and squinting at a list.

Position comes from the flow graph alone. Relations are drawn, but they do not rank anything, so the
models nothing creates gather in the leftmost column — read them as the roots of your data model — and
the saga marches away from them.

There is one card per model however many arrows reach it. A flow that writes two log rows produces one
edge of weight two, not two cards.

## One model at a time

Every model has its own lifecycle, and reading twenty of them at once is a different question from
reading one. The canvas answers the second by default: pick a model from the rail and you get its card
in full — all four flows and its columns — with its neighbourhood around it as context, expanded to a
**bounded depth** so the walk always terminates. "Everything" gives the coarse overview.

A model card carries the four flows whether or not anything was ever observed on them, because "delete
calls nothing" is a fact worth seeing rather than an absence to infer. Edges leave a flow row and land
on the row they reach, so an arrow says which flow does what, not merely that two things are related.

Clicking a flow lights every edge reachable from it and dims the rest. Opening a card shows that
model's own activity: the metrics counted against it, the recent operations it took part in, and the
lines it logged — each linking to the request that produced them.

Mouse behaviour follows a CAD editor rather than a web page: **middle button drags the canvas, left
click always selects**, and the wheel zooms at the cursor. `f` or the Fit button frames everything.

## The page

The browser page ships as a TypeScript module exporting a string, because the build is bare `tsc`,
which emits only `.ts` — an `src/index.html` would silently vanish from `dist`. CI asserts the built
page still carries both nonces.

Nothing is interpolated into it and it renders exclusively with `textContent` and `createElementNS`.
`innerHTML` is a stored-XSS sink here, since log fields carry user-supplied request bodies; CI greps
for it.

## Operations, not requests

The Operations view groups spans by their root run rather than listing rows. One entry is one root
operation — whatever started it, whether an HTTP request, a GraphQL resolver or a line of code that
ran at boot — and underneath it sits the tree of everything that operation caused: the externals it
called and the nested creates, updates and deletes its flow started in turn.

A suspended flow re-executes from the top on every resume, so a single root shows up as several
**passes**. That is the truth of the engine, not a rendering artefact: pass 1 reserves stock and
suspends, pass 2 replays the reserve and charges, pass 3 replays both and sends the receipt. Steps the
outbox dispatcher performed on its own sit at trace level rather than inside a pass.

Nesting comes from the parent the engine records, and time containment is only the fallback for spans
that carry no recorded parent.

## Options

```ts
type AnalyzeOptions = {
  port: readonly string[];
  token: readonly string[];
  bind: readonly string[];
  deny: readonly string[];
};
```

Slot-style readonly arrays: empty means absent. `deny` may not be empty — pass
`defaultSensitiveKeys` and add to it rather than replacing it.

## License

MIT
