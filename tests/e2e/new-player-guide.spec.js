import { test, expect } from '@playwright/test';

// Existing driving tests use a returning-player profile. These cases deliberately
// retain clean onboarding storage and cover the real first-visit entry point.
async function freshSettings(context) {
  await context.addInitScript(() => {
    if (!localStorage.getItem('sunny-settings-v1')) localStorage.setItem('sunny-settings-v1', JSON.stringify({ graphics: 'smooth' }));
  });
}

test('first visit explains the game, remembers dismissal, replays, and lets the player drive', async ({ page, context }, testInfo) => {
  test.setTimeout(150000);
  await freshSettings(context);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const guide = page.locator('.new-player-guide');
  await expect(guide).toBeVisible();
  await expect(guide.locator('.guide-counter')).toHaveText('1 / 7');
  await expect(page.locator('.menu-screen')).toHaveJSProperty('inert', true);
  await guide.locator('.guide-next').click();
  await guide.locator('.guide-next').click();
  await expect(guide.locator('.guide-cards')).toContainText('漂移');
  await expect(guide.locator('kbd')).not.toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();
  await expect(page.locator('.menu-screen')).toHaveJSProperty('inert', false);
  await page.reload();
  await expect(page.locator('.start-button')).toBeEnabled();
  await expect(guide).toBeHidden();
  await page.locator('.help-button').click();
  await page.locator('.guide-replay').click();
  await expect(guide.locator('.guide-counter')).toHaveText('1 / 7');
  for (let i = 0; i < 6; i++) await guide.locator('.guide-next').click();
  await expect(guide.locator('.guide-practice')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('guide-desktop-last.png') });
  await guide.locator('.guide-next').click();
  await expect(guide).toBeHidden();
  await page.locator('.start-button').click();
  await expect(page.locator('.race-hud')).toBeVisible();
  await page.keyboard.down('KeyW');
  await expect.poll(async () => Number(await page.locator('.speed-value').textContent()), { timeout: 60000 }).toBeGreaterThan(30);
  await page.keyboard.up('KeyW');
  expect(errors).toEqual([]);
});

test('first-visit phone guide keeps navigation visible in portrait and small landscape', async ({ browser }, testInfo) => {
  test.setTimeout(150000);
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  try {
    await freshSettings(context);
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4181/');
    const guide = page.locator('.new-player-guide');
    await expect(guide).toBeVisible();
    await guide.locator('.guide-next').tap();
    await guide.locator('.guide-next').tap();
    await expect(guide.locator('#guide-intro')).toContainText('手机');
    await expect(guide.locator('kbd')).toHaveCount(0);
    for (const viewport of [{ width: 375, height: 667 }, { width: 667, height: 375 }, { width: 568, height: 320 }]) {
      await page.setViewportSize(viewport);
      for (const selector of ['.guide-skip', '.guide-prev', '.guide-next']) {
        await expect(guide.locator(selector)).toBeInViewport({ ratio: 1 });
      }
      const problems = await guide.evaluate(element => {
        const rect = element.querySelector('.guide-dialog').getBoundingClientRect();
        return rect.left < 0 || rect.top < 0 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1;
      });
      expect(problems).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`guide-phone-${viewport.width}x${viewport.height}.png`) });
    }
    for (let i = 2; i < 6; i++) await guide.locator('.guide-next').tap();
    await expect(guide.locator('.guide-practice')).toBeInViewport({ ratio: 1 });
    await guide.locator('.guide-practice').tap();
    await expect(guide).toBeHidden();
    await expect(page.locator('.lesson-panel')).toBeVisible();
    await expect(page.locator('.touch-controls')).toBeVisible();
  } finally { await context.close(); }
});
