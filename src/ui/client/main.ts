import { askForToken, fail, state, token } from "./core.ts";
import { markLive, refresh, show, viewFromPath, wire, wireGate } from "./views.ts";

wire();
wireGate();
show(viewFromPath(location.pathname));
window.addEventListener("popstate", () => show(viewFromPath(location.pathname)));
if (token) {
  refresh().catch(fail);
} else {
  askForToken();
}

const stream = new EventSource(
  "/api/stream" + (token ? "?token=" + encodeURIComponent(token) : ""),
);
stream.addEventListener("open", () => {
  markLive(true);
  refresh().catch(fail);
});
stream.addEventListener("error", () => markLive(false));
stream.addEventListener("tick", () => {
  state.lastTick = Date.now();
  refresh().catch(fail);
});

const heartbeatMs = 5000;

setInterval(() => {
  if (!token) {
    return;
  }
  const quiet = Date.now() - state.lastTick;
  if (quiet < heartbeatMs) {
    return;
  }
  refresh()
    .then(() => {
      state.lastTick = Date.now();
      markLive(true);
    })
    .catch(fail);
}, heartbeatMs);

// The debug surface the page and the test sandbox reach for. Everything else stays
// inside the bundle.
export { state } from "./core.ts";
export { paint, renderLogs, renderOutbox, show } from "./views.ts";
export { drawMap, drawRelations } from "./map.ts";
export { renderRuns } from "./trace.ts";
export { compensatedRuns, renderStuck, stuckCount, stuckGroups } from "./stuck.ts";
