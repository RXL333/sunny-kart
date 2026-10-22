# Browser regression checks

Run `npm run test:e2e` from the repository root. The command builds the local
production bundle, then starts isolated servers on ports 4181 (production app
and WebSocket backend) and 4180 (Vite rare-state fixtures). It never contacts
the public multiplayer server. Existing services on those ports cause an error;
the runner does not silently reuse another task's processes.

`@playwright/test` is pinned in the lockfile. CI installs its matching Chromium
with `npx playwright install --with-deps chromium`. Cloud environments with
`/usr/bin/chromium` reuse that browser; another executable can be supplied using
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`. No TLS or package integrity checks are disabled.

The suite uses a real WebGL2 context and the shipped smooth graphics preset.
SwiftShader software rendering makes the checks available without a physical
GPU, but its frame rate does not predict phone or desktop GPU performance.
Driving assertions allow additional wall-clock time because the game limits
simulation work per rendered frame.

Coverage includes production loading and models, keyboard driving/braking,
pause/resume, course switching, persisted keyboard settings, and an actual
two-browser friend race. The host selects item mode; the guest must see the
same room mode, both receive the inventory HUD, and the WebSocket input stream
must carry the item button independently from driving.

Pickup fixtures only place the player just before a crystal or item: the game's
own physical crossing must award it, hide it, and display feedback. Item tests
select the item race explicitly, verify a pickup fills one slot without activating
a buff/projectile, preserve an occupied slot when crossing another box, and use
the held default E key to consume it. They then rebind use-item to F through the
settings UI, verify E stops working and the hint updates, and check holding F
does not consume another item acquired before release. Random reward selection
remains authoritative; this browser flow exercises whichever reward is awarded.
Deterministic unit tests cover all five item rules. Competitive mode is checked
separately for energy availability and absent item boxes/inventory.

A touch-capable mobile Chromium context (`hasTouch` and `isMobile`) checks all
seven buttons at 568×320, 667×375, and 844×390 landscape sizes. Visible controls
must stay on screen, remain mutually separate, and avoid visible HUD panels.
Native browser touch events exercise concurrent throttle/item use and drag the
item key in the real layout editor. The saved v2 position and the original six
button centers are verified after a full reload. Chromium's CDP touch dispatch
is used only inside this isolated regression runner; user browser acceptance
continues through the host's designated browser-control channel.

The fixture API exists only when both Vite development mode and `VITE_E2E=1` are
active; production absence is explicitly checked. A validated stored ghost is
used to verify the real time-trial UI and rendering. Full recording, invalid
trajectories and storage handling have separate unit tests.

Screenshots, HTML reports and failed-run traces are saved under ignored
`logs/playwright-results` and `logs/playwright-report`; CI uploads them for seven
days. To investigate a failed trace, use `npx playwright show-trace <trace.zip>`.

After a build, `npm run perf:browser` records the current cloud machine's first
playable time, three course-switch times, model network requests and sampled
frame intervals in `logs/performance/current.json`, plus a screenshot. This is
a repeatable measurement, not an asserted before/after improvement. Keep browser,
viewport, graphics settings and workload consistent when comparing runs.
