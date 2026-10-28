import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('sunny-onboarding-v1', 'done');
    localStorage.setItem('sunny-settings-v1', JSON.stringify({ graphics: 'smooth' }));
  });
});

async function developmentGame(page) {
  await page.goto('http://127.0.0.1:4180/');
  await expect(page.locator('.start-button')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => Boolean(window.__SUNNY_KART_TEST__))).toBe(true);
}

const itemNames = { shield:'泡泡护盾', magnet:'能量磁铁', rocket:'火箭冲刺', bubble:'泡泡弹', jelly:'果冻陷阱' };

async function crossItemBox(page, index) {
  return page.evaluate(index => {
    const box = window.__SUNNY_KART_TEST__.state().track.items[index];
    if (!box) throw new Error(`Missing physical item box ${index}`);
    window.__SUNNY_KART_TEST__.setPose({ distance:box.distance-.08, offset:box.lane, speed:15, yaw:0, yawRate:0, lateralVelocity:0 });
    return box;
  }, index);
}

async function inventory(page) {
  return page.evaluate(() => window.__SUNNY_KART_TEST__.state().race.player.inventory);
}

async function simulationAdvances(page, seconds = .15) {
  const elapsed = await page.evaluate(() => window.__SUNNY_KART_TEST__.state().race.elapsed);
  await expect.poll(() => page.evaluate(() => window.__SUNNY_KART_TEST__.state().race.elapsed), {timeout:30000}).toBeGreaterThan(elapsed + seconds);
}

async function useKeyboardItem(page, key) {
  await page.keyboard.down(key);
  try { await expect.poll(() => inventory(page)).toBe(null); }
  finally { await page.keyboard.up(key); }
}

test('physics crossings collect energy, store one manual item, and respect default and customized item keys', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await developmentGame(page);
  await page.locator('.menu-screen [data-race-mode="items"]').click();
  await page.locator('.start-button').click();
  await expect.poll(() => page.evaluate(() => window.__SUNNY_KART_TEST__.state().race.phase), { timeout: 90000 }).toBe('racing');
  expect(await page.evaluate(() => window.__SUNNY_KART_TEST__.state().race.mode)).toBe('items');
  const before = await page.evaluate(() => {
    const state = window.__SUNNY_KART_TEST__.state(), crystal = state.track.coins[0];
    window.__SUNNY_KART_TEST__.setPose({ distance: crystal.distance - .08, offset: crystal.lane, speed: 15, yaw: 0, yawRate: 0, lateralVelocity: 0 });
    return { crystal, coins: state.race.player.coins };
  });
  await expect.poll(() => page.evaluate(id => window.__SUNNY_KART_TEST__.state().race.player.collectedLaps[id], before.crystal.id)).toBe(0);
  const collected = await page.evaluate(id => {
    const state = window.__SUNNY_KART_TEST__.state();
    return { coins: state.race.player.coins, collectedAt: state.race.player.collected[id], visible: state.world.crystals.find(item => item.id === id).visible, particles: state.world.pickupEffects };
  }, before.crystal.id);
  expect(collected.coins).toBe(before.coins + 1);
  expect(collected.visible).toBe(false);
  expect(collected.particles).toBeGreaterThan(0);
  await expect(page.locator('.nitro-panel')).toHaveClass(/energy-collected/);
  await page.screenshot({ path: testInfo.outputPath('energy-pickup-feedback.png') });
  // Re-crossing the same crystal in the same lap must not grant more energy.
  await page.evaluate(crystal => window.__SUNNY_KART_TEST__.setPose({ distance: crystal.distance - .08, offset: crystal.lane, speed: 15 }), before.crystal);
  await expect.poll(() => page.evaluate(distance => window.__SUNNY_KART_TEST__.state().race.player.distance > distance, before.crystal.distance)).toBe(true);
  const recrossed=await page.evaluate(()=>window.__SUNNY_KART_TEST__.state().race.player);
  expect(recrossed.collected[before.crystal.id]).toBe(collected.collectedAt);
  // Rendering/screenshots can allow the car to reach another nearby crystal;
  // total awards must still match unique first-lap pickups, not a frozen total.
  expect(recrossed.coins).toBe(Object.keys(recrossed.collectedLaps).length);
  const box = await crossItemBox(page, 0);
  await expect.poll(() => inventory(page)).toMatch(/^(shield|magnet|rocket|bubble|jelly)$/);
  const held = await inventory(page);
  await expect(page.locator('.inventory-panel')).toBeVisible();
  await expect(page.locator('.inventory-name')).toContainText(itemNames[held]);
  expect(await page.evaluate(id => window.__SUNNY_KART_TEST__.state().world.items.find(item => item.id === id).visible, box.id)).toBe(false);
  const stored = await page.evaluate(() => window.__SUNNY_KART_TEST__.state().race);
  expect([stored.player.shield, stored.player.magnet, stored.player.rocket]).toEqual([0,0,0]);
  expect(stored.itemObjects.filter(object => object.ownerId === stored.player.id)).toHaveLength(0);
  await page.screenshot({ path:testInfo.outputPath('item-stored-not-active.png') });

  // Crossing a second box with a full slot neither replaces nor consumes it.
  const secondBox = await crossItemBox(page, 1);
  await expect.poll(() => page.evaluate(distance => window.__SUNNY_KART_TEST__.state().race.player.distance > distance, secondBox.distance)).toBe(true);
  expect(await inventory(page)).toBe(held);
  expect(await page.evaluate(id => window.__SUNNY_KART_TEST__.state().race.player.itemCollected[id] ?? null, secondBox.id)).toBe(null);
  expect(await page.evaluate(id => window.__SUNNY_KART_TEST__.state().world.items.find(item => item.id === id).visible, secondBox.id)).toBe(true);
  await useKeyboardItem(page, 'KeyE');
  if (['shield','magnet','rocket'].includes(held)) {
    await expect.poll(() => page.evaluate(type => window.__SUNNY_KART_TEST__.state().race.player[type], held)).toBeGreaterThan(0);
    await expect(page.locator(`.item-effect.item-${held}`)).toBeVisible();
  } else {
    await expect.poll(() => page.evaluate(type => {
      const {race} = window.__SUNNY_KART_TEST__.state();
      return race.itemObjects.some(object => object.type === type && object.ownerId === race.player.id);
    }, held)).toBe(true);
  }
  await page.screenshot({path:testInfo.outputPath('item-manually-used.png')});

  await page.locator('.settings-button').click();
  await page.locator('[data-control-mode="keyboard"]').click();
  await page.locator('[data-binding-action="useItem"][data-binding-slot="0"]').click();
  await page.keyboard.press('KeyF');
  await expect(page.locator('[data-binding-action="useItem"][data-binding-slot="0"]')).toHaveText('F');
  await page.locator('.settings-done').click();
  await expect(page.locator('.race-hint [data-action-hint="useItem"]')).toContainText('F');
  await crossItemBox(page, 1);
  await expect.poll(() => inventory(page)).toMatch(/^(shield|magnet|rocket|bubble|jelly)$/);
  const secondHeld = await inventory(page);
  await page.keyboard.down('KeyE');
  try { await simulationAdvances(page);expect(await inventory(page)).toBe(secondHeld); }
  finally { await page.keyboard.up('KeyE'); }

  // Keep F down while crossing another box: one physical press consumes only
  // one item, even when the slot fills again before the player lifts the key.
  await page.keyboard.down('KeyF');
  try {
    await expect.poll(() => inventory(page)).toBe(null);
    await crossItemBox(page, 2);
    await expect.poll(() => inventory(page)).toMatch(/^(shield|magnet|rocket|bubble|jelly)$/);
    const thirdHeld = await inventory(page);
    await simulationAdvances(page);
    expect(await inventory(page)).toBe(thirdHeld);
    // Settings clears logical keys while F is still physically held. A
    // subsequent OS auto-repeat must not become a new item press after close.
    await page.locator('.settings-button').click();
    await page.locator('.settings-done').click();
    await simulationAdvances(page, .05);
    await page.keyboard.down('KeyF'); // already held: native repeat=true
    await simulationAdvances(page);
    expect(await inventory(page)).toBe(thirdHeld);
  } finally { await page.keyboard.up('KeyF'); }
  await simulationAdvances(page, .05);
  // A press/release entirely between render frames must survive until the
  // next simulation step, just like a quick real keyboard tap.
  await page.keyboard.press('KeyF');
  await expect.poll(() => inventory(page)).toBe(null);
  expect(errors).toEqual([]);
});

test('competitive racing keeps energy but disables item boxes, inventory and item use', async ({ page }) => {
  await developmentGame(page);
  await page.locator('.menu-screen [data-race-mode="race"]').click();
  await page.locator('.start-button').click();
  await expect(page.locator('.race-hud')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__SUNNY_KART_TEST__.state().race.phase), {timeout:60000}).toBe('racing');
  const state=await page.evaluate(() => window.__SUNNY_KART_TEST__.state());
  expect(state.race.mode).toBe('race');expect(state.track.coins.length).toBeGreaterThan(0);
  expect(state.track.items).toHaveLength(0);expect(state.world.items).toHaveLength(0);
  expect(state.race.player.inventory).toBe(null);expect(state.race.itemObjects).toHaveLength(0);
  await expect(page.locator('.inventory-panel')).toBeHidden();
  await page.keyboard.down('KeyE');
  try { await simulationAdvances(page);expect(await inventory(page)).toBe(null); }
  finally { await page.keyboard.up('KeyE'); }
});

test('time trial loads an isolated best ghost, displays it, and disables traffic and items', async ({ page }, testInfo) => {
  await developmentGame(page);
  // A validated reference recording is a storage fixture, not a fabricated
  // finish. Recorder completion itself is exercised by the physics unit suite.
  await page.evaluate(async () => {
    const { GhostStore, GHOST_PHYSICS_VERSION } = await import('/src/ghost.js');
    const state = window.__SUNNY_KART_TEST__.state(), length = state.track.length;
    const duration = Math.ceil(length * 3 / 25 * 10) / 10;
    const samples = [];
    for (let i = 0; i <= Math.round(duration * 10); i++) {
      const time = Number((i / 10).toFixed(3));
      samples.push([time, Number((length * 3 * time / duration).toFixed(3)), 0, 0, 25]);
    }
    const result = new GhostStore().save({ schema: 1, mode: 'time-trial', trackId: state.track.id, trackLength: length, character: 'fox', laps: 3, physicsVersion: GHOST_PHYSICS_VERSION, time: duration, samples });
    if (!result.saved) throw new Error(`Reference fixture rejected: ${result.reason}`);
  });
  await page.locator('.time-trial-button').click();
  await expect(page.locator('.time-trial-panel')).toBeVisible();
  await expect(page.locator('.trial-reference')).toContainText('个人最佳');
  await expect.poll(() => page.evaluate(() => window.__SUNNY_KART_TEST__.state().world.ghostVisible)).toBe(true);
  const state = await page.evaluate(() => window.__SUNNY_KART_TEST__.state());
  expect(state.race.mode).toBe('time-trial');
  expect(state.race.racers).toHaveLength(1);
  expect(state.track.items).toHaveLength(0);
  expect(state.world.items).toHaveLength(0);
  expect(state.race.itemObjects).toHaveLength(0);
  expect(state.race.player.inventory).toBe(null);
  await expect(page.locator('.inventory-panel')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('time-trial-ghost.png') });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.time-trial-panel')).toBeVisible();
  const boxes = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
    return { trial: rect('.time-trial-panel'), speed: rect('.speed-panel'), nitro: rect('.nitro-panel'), lap: rect('.lap-panel') };
  });
  const overlaps = (a, b) => Math.min(a.right, b.right) > Math.max(a.x, b.x) && Math.min(a.bottom, b.bottom) > Math.max(a.y, b.y);
  expect(overlaps(boxes.trial, boxes.speed)).toBe(false);
  expect(overlaps(boxes.trial, boxes.nitro)).toBe(false);
  expect(overlaps(boxes.trial, boxes.lap)).toBe(false);
  expect(boxes.trial.x).toBeGreaterThanOrEqual(0);
  expect(boxes.trial.right).toBeLessThanOrEqual(844);
  await page.screenshot({ path: testInfo.outputPath('time-trial-narrow-landscape.png') });
});
