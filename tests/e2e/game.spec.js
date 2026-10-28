import { test, expect } from '@playwright/test';

// SwiftShader is a real software WebGL renderer. Use the shipped smooth preset
// so test deadlines do not depend on a cloud machine having a physical GPU.
async function smoothRendering(context) {
  await context.addInitScript(() => {
    localStorage.setItem('sunny-onboarding-v1', 'done');
    if (!localStorage.getItem('sunny-settings-v1')) localStorage.setItem('sunny-settings-v1', JSON.stringify({ graphics: 'smooth' }));
  });
}
test.beforeEach(async ({ context }) => { await smoothRendering(context); });

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('.start-button')).toBeEnabled();
  await expect(page.locator('#game')).toBeVisible();
}

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

test('production WebGL game loads models, drives, brakes and pauses', async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  const models = new Set();
  page.on('response', response => { if (/\/models\/.*\.glb$/.test(response.url()) && response.ok()) models.add(response.url()); });
  await ready(page);
  expect(await page.evaluate(() => typeof window.__SUNNY_KART_TEST__)).toBe('undefined');
  await expect.poll(() => models.size).toBe(3);
  expect(await page.evaluate(() => Boolean(document.querySelector('#game').getContext('webgl2')))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('menu-webgl.png') });
  await page.locator('.start-button').click();
  await expect(page.locator('.race-hud')).toBeVisible();
  await page.keyboard.down('KeyW');
  await expect.poll(async () => Number(await page.locator('.speed-value').textContent()), { timeout: 60000 }).toBeGreaterThan(35);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyS');
  await expect.poll(async () => Number(await page.locator('.speed-value').textContent())).toBeLessThan(10);
  await page.keyboard.up('KeyS');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-overlay')).toBeVisible();
  await page.locator('.resume-button').click();
  await expect(page.locator('.pause-overlay')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('race-webgl.png') });
  expect(errors).toEqual([]);
});

test('course switching and keyboard settings persist after a real page reload', async ({ page }) => {
  const errors = watchErrors(page);
  await ready(page);
  await page.locator('.course-picker-button').click();
  await page.locator('[data-course="candy-hills"]').click();
  await expect(page.locator('.start-button')).toBeEnabled();
  await expect(page.locator('.chosen-course-name')).toContainText('糖果');
  await page.locator('.settings-button').click();
  await page.locator('[data-control-mode="keyboard"]').click();
  await page.locator('[data-binding-action="throttle"][data-binding-slot="0"]').click();
  await page.keyboard.press('KeyI');
  await expect(page.locator('[data-binding-action="throttle"][data-binding-slot="0"]')).toHaveText('I');
  await page.locator('[data-setting="graphics"]').selectOption('smooth');
  await page.locator('.settings-done').click();
  await page.reload();
  await expect(page.locator('.start-button')).toBeEnabled();
  await expect(page.locator('.chosen-course-name')).toContainText('糖果');
  await page.locator('.settings-button').click();
  await expect(page.locator('[data-binding-action="throttle"][data-binding-slot="0"]')).toHaveText('I');
  await expect(page.locator('[data-setting="graphics"]')).toHaveValue('smooth');
  await page.locator('.settings-done').click();
  await page.locator('.start-button').click();
  await page.keyboard.down('KeyI');
  await expect.poll(async () => Number(await page.locator('.speed-value').textContent()), { timeout: 60000 }).toBeGreaterThan(30);
  await page.keyboard.up('KeyI');
  expect(errors).toEqual([]);
});

test('two browser pages share the selected item-race mode and send authoritative driving and item inputs', async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const guestContext = await browser.newContext({ viewport: { width: 960, height: 540 } });
  try {
    await smoothRendering(hostContext);
    await smoothRendering(guestContext);
    const host = await hostContext.newPage(), guest = await guestContext.newPage();
    const hostErrors = watchErrors(host), guestErrors = watchErrors(guest);
    const inputs={host:[],guest:[]};
    for(const [name,page] of [['host',host],['guest',guest]])page.on('websocket',socket=>socket.on('framesent',({payload})=>{
      const message=JSON.parse(String(payload));
      if(message.type==='input'){inputs[name].push(message.input);if(inputs[name].length>120)inputs[name].shift();}
    }));
    await Promise.all([host.goto('http://127.0.0.1:4181/'), guest.goto('http://127.0.0.1:4181/')]);
    await expect(host.locator('.friend-button')).toBeEnabled();
    await expect(guest.locator('.friend-button')).toBeEnabled();
    await host.locator('.menu-screen [data-race-mode="items"]').click();
    await host.locator('.friend-button').click();
    await host.locator('.create-room-button').click();
    await expect(host.locator('.room-code')).toHaveText(/^[A-Z2-9]{6}$/);
    await expect(host.locator('.room-mode')).toHaveText('道具赛');
    const code = await host.locator('.room-code').textContent();
    await guest.locator('.friend-button').click();
    await guest.locator('#room-code-input').fill(code);
    await guest.locator('.join-room-button').click();
    await expect(host.locator('.lobby-player:not(.empty)')).toHaveCount(2);
    await expect(guest.locator('.lobby-player:not(.empty)')).toHaveCount(2);
    await expect(guest.locator('.room-mode')).toHaveText('道具赛');
    await host.locator('.start-room-button').click();
    await expect(host.locator('.race-hud')).toBeVisible();
    await expect(guest.locator('.race-hud')).toBeVisible();
    await expect(host.locator('.inventory-panel')).toBeVisible();
    await expect(guest.locator('.inventory-panel')).toBeVisible();
    await host.keyboard.down('KeyW');
    await guest.keyboard.down('KeyS');
    await expect.poll(async () => Number(await host.locator('.speed-value').textContent()), { timeout: 20000 }).toBeGreaterThan(35);
    await expect.poll(()=>inputs.host.some(input=>input.throttle===1&&input.brake===0)).toBe(true);
    await expect.poll(()=>inputs.guest.some(input=>input.throttle===0&&input.brake===1)).toBe(true);
    // The starting pack can push a braking kart. Wait for traffic to pass,
    // then verify braking actually stops it instead of assuming zero impulse.
    await expect.poll(async()=>Number(await guest.locator('.speed-value').textContent()),{timeout:20000}).toBeLessThan(10);
    await host.keyboard.up('KeyW');
    await guest.keyboard.up('KeyS');
    await host.keyboard.down('KeyE');
    try { await expect.poll(()=>inputs.host.some(input=>input.useItem===true)).toBe(true); }
    finally { await host.keyboard.up('KeyE'); }
    expect([...hostErrors, ...guestErrors]).toEqual([]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
