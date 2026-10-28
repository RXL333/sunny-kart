import { test, expect } from '@playwright/test';

const actions = ['left','right','drift','nitro','brake','throttle','useItem'];

// Native Chromium touch input exercises pointer capture and trusted pointer
// events. It does not call the game's input handlers or grant inventory.
async function touchGesture(session, from, to = from) {
  const point = ({x,y}) => [{x,y,id:1,radiusX:7,radiusY:7,force:1}];
  await session.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:point(from)});
  try {
    await session.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:point({x:(from.x+to.x)/2,y:(from.y+to.y)/2})});
    await session.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:point(to)});
  } finally { await session.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]}); }
}

async function center(locator) {
  const box=await locator.boundingBox();
  if(!box)throw new Error('Expected a visible control before native touch input');
  return {x:box.x+box.width/2,y:box.y+box.height/2};
}

async function layoutProblems(page) {
  return page.evaluate(() => {
    const visible = element => element && !element.closest('[hidden]') && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
    const rect = element => element.getBoundingClientRect();
    const overlaps = (a,b) => Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
    const controls=[...document.querySelectorAll('.touch-controls [data-touch]')].filter(visible);
    const panels=['.topbar','.lap-panel','.position-panel','.minimap-panel','.speed-panel','.nitro-panel','.auto-throttle-button','.inventory-panel','.item-effects']
      .map(selector=>({selector,element:document.querySelector(selector)})).filter(({element})=>visible(element));
    const problems=[];
    for(let index=0;index<controls.length;index++) {
      const button=controls[index],box=rect(button),name=button.dataset.touch;
      if(box.left<-.5||box.top<-.5||box.right>innerWidth+.5||box.bottom>innerHeight+.5)problems.push(`${name} outside viewport`);
      for(const other of controls.slice(index+1))if(overlaps(box,rect(other)))problems.push(`${name} overlaps ${other.dataset.touch}`);
      for(const {selector,element} of panels)if(overlaps(box,rect(element)))problems.push(`${name} overlaps ${selector}`);
    }
    return problems;
  });
}

test('touch phones keep seven landscape controls clear of HUD, use items, and preserve a dragged item position after reload', async ({browser},testInfo) => {
  test.setTimeout(240000);
  const context=await browser.newContext({viewport:{width:667,height:375},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  try {
    await context.addInitScript(() => {
      localStorage.setItem('sunny-onboarding-v1', 'done');
      if(!localStorage.getItem('sunny-settings-v1'))localStorage.setItem('sunny-settings-v1',JSON.stringify({graphics:'smooth',autoThrottle:false}));
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:4180/');
    await expect(page.locator('.start-button')).toBeEnabled();
    await page.locator('.menu-screen [data-race-mode="items"]').tap();
    await page.locator('.start-button').tap();
    await expect(page.locator('#app')).toHaveAttribute('data-input-mode','touch');
    await expect.poll(()=>page.evaluate(()=>window.__SUNNY_KART_TEST__.state().race.phase),{timeout:90000}).toBe('racing');
    for(const viewport of [{width:667,height:375},{width:568,height:320},{width:844,height:390}]) {
      await page.setViewportSize(viewport);
      for(const action of actions)await expect(page.locator(`.touch-controls [data-touch="${action}"]`)).toBeVisible();
      await expect(page.locator('.touch-controls [data-touch]')).toHaveCount(7);
      await expect.poll(()=>layoutProblems(page),{message:`phone controls and visible HUD at ${viewport.width}x${viewport.height}`}).toEqual([]);
      await page.screenshot({path:testInfo.outputPath(`phone-items-${viewport.width}x${viewport.height}.png`)});
    }
    await page.setViewportSize({width:667,height:375});
    await page.evaluate(() => {
      const box=window.__SUNNY_KART_TEST__.state().track.items[0];
      window.__SUNNY_KART_TEST__.setPose({distance:box.distance-.08,offset:box.lane,speed:15,yaw:0,yawRate:0,lateralVelocity:0});
    });
    await expect.poll(()=>page.evaluate(()=>window.__SUNNY_KART_TEST__.state().race.player.inventory)).toMatch(/^(shield|magnet|rocket|bubble|jelly)$/);
    await expect(page.locator('.inventory-panel')).toBeVisible();
    await expect.poll(()=>layoutProblems(page)).toEqual([]);
    const session=await context.newCDPSession(page);
    const throttle=await center(page.locator('[data-touch="throttle"]')),item=await center(page.locator('[data-touch="useItem"]'));
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...throttle,id:1,radiusX:7,radiusY:7,force:1},{...item,id:2,radiusX:7,radiusY:7,force:1}]});
    try {
      await expect(page.locator('[data-touch="throttle"]')).toHaveClass(/pressed/);
      await expect.poll(()=>page.evaluate(()=>window.__SUNNY_KART_TEST__.state().race.player.inventory)).toBe(null);
    } finally { await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); }
    await expect(page.locator('[data-touch="throttle"]')).not.toHaveClass(/pressed/);
    await expect(page.locator('[data-touch="useItem"]')).not.toHaveClass(/pressed/);
    // Recheck the short phone after using a real item: active effect chips add
    // HUD content and must not cover the new button above the steering thumb.
    for(const viewport of [{width:568,height:320},{width:667,height:375}]) {
      await page.setViewportSize(viewport);
      await expect.poll(()=>layoutProblems(page),{message:`phone HUD after item use at ${viewport.width}x${viewport.height}`}).toEqual([]);
      await page.screenshot({path:testInfo.outputPath(`phone-item-used-${viewport.width}x${viewport.height}.png`)});
    }

    await page.locator('.settings-button').tap();
    await expect(page.locator('.settings-touch-panel')).toBeVisible();
    await page.locator('.settings-custom-layout').tap();
    const six=await page.locator('[data-layout-action]').evaluateAll(buttons=>Object.fromEntries(buttons.filter(button=>button.dataset.layoutAction!=='useItem').map(button=>[button.dataset.layoutAction,{x:parseFloat(button.style.left),y:parseFloat(button.style.top)}])));
    const preview=page.locator('[data-layout-action="useItem"]'),from=await center(preview),target={x:333,y:250};
    await touchGesture(session,from,target);
    await expect(page.locator('.control-editor-save')).toBeEnabled();
    const dragged=await center(preview);
    expect(Math.hypot(dragged.x-from.x,dragged.y-from.y)).toBeGreaterThan(30);
    await page.locator('.control-editor-save').tap();
    await page.locator('.settings-done').tap();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('sunny-touch-layout-v2')));
    expect(saved.version).toBe(2);
    expect(saved.landscape.useItem.x).toBeCloseTo(dragged.x/667,3);
    expect(saved.landscape.useItem.y).toBeCloseTo(dragged.y/375,3);
    await expect.poll(()=>layoutProblems(page)).toEqual([]);
    await page.reload();
    await expect(page.locator('.start-button')).toBeEnabled();
    await page.locator('.menu-screen [data-race-mode="items"]').tap();
    await page.locator('.start-button').tap();
    await expect(page.locator('[data-touch="useItem"]')).toBeVisible();
    await expect(page.locator('#app')).toHaveAttribute('data-custom-controls','true');
    const restored=await center(page.locator('[data-touch="useItem"]'));
    expect(restored.x).toBeCloseTo(dragged.x,0);expect(restored.y).toBeCloseTo(dragged.y,0);
    for(const [action,point] of Object.entries(six)) {
      const control=await center(page.locator(`[data-touch="${action}"]`));
      expect(control.x).toBeCloseTo(point.x,0);expect(control.y).toBeCloseTo(point.y,0);
    }
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sunny-touch-layout-v2')))).toEqual(saved);
    await expect.poll(()=>layoutProblems(page)).toEqual([]);
    await page.screenshot({path:testInfo.outputPath('phone-item-layout-restored.png')});
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
