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

The canvas pans and zooms like any node editor: drag to pan, scroll to zoom at the cursor, `f` or the
Fit button to frame everything, and clicking a node opens an inspector with its columns, its
compensation pairs and the traffic the outbox recorded for it.

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
