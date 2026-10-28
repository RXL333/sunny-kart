import { DEFAULT_KEY_BINDINGS, keyLabel } from './keyboard-bindings.js';

export const NEW_PLAYER_GUIDE_KEY = 'sunny-onboarding-v1';
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);

function pages(touch, bindings) {
  const keys = action => (bindings?.[action] || DEFAULT_KEY_BINDINGS[action]).map(code => `<kbd>${esc(keyLabel(code))}</kbd>`).join(' / ');
  const card = (icon, title, body) => ({ icon, title, body });
  return [
    {
      section: '01 / 发车准备', title: '先选搭档，再决定去哪。',
      intro: '欢迎来到晴空卡丁车！花一分钟认识各个区域，随时可以跳过。',
      cards: [
        card('搭', '选择你的搭档', '点选阿橘、薄荷或波波，选一位喜欢的车手陪你出发。'),
        card('图', '换条赛道 / 航拍全图', '四张地图有不同风景与弯道。点“换条赛道”选择地图，也能用“航拍全图”先认路。'),
        card('速', '比赛节奏', '轻松兜风、标准竞速、全力以赴决定对手的比赛节奏。第一次可以从轻松兜风开始。'),
      ], note: '介绍只会自动出现一次；跳过也不会替你更改任何选择。',
    },
    {
      section: '02 / 玩法入口', title: '这一局，你想怎么玩？',
      intro: '先选比赛类型，再决定单人、和朋友一起，或挑战自己的纪录。',
      cards: [
        card('竞', '竞速赛', '专注过弯、漂移和氮气，靠路线与操作争取更好的名次。'),
        card('道', '道具赛', '经过彩色道具箱获得道具，自己决定出手时机。五种道具各有进攻、防守或补给用途。'),
        card('旗', '出发，去兜风', '按当前搭档、地图、难度和比赛类型开始单人比赛，与 AI 车手跑完三圈。'),
        card('时', '计时挑战', '没有对手和随机道具，完成三圈留下计时幽灵，下次再挑战自己的最佳成绩。'),
      ], note: '“好友联机”会进入房间大厅，后面会单独介绍。',
    },
    {
      section: '03 / 驾驶入门', title: '踩油门，也要会过弯。',
      intro: touch ? '手机建议横屏。按你当前布局上的功能键操作，转向、漂移和氮气可以配合使用。' : '下面显示你当前的实际键位；在设置中改键后，这里的提示也会一起更新。',
      cards: [
        card('油', '加速与刹车', touch ? '按住“油门”加速、“刹车”减速。自动油门开启时可专心转向，仍能刹车。' : `按住 ${keys('throttle')} 加速，${keys('brake')} 刹车；${keys('autoThrottle')} 切换自动油门。`),
        card('向', '转向与路线', touch ? '按住方向区的 ◀ / ▶ 转向，也可滑动切换。草地会减速，入弯前先轻刹。' : `${keys('left')} 向左，${keys('right')} 向右。草地会减速，入弯前先轻刹。`),
        card('漂', '漂移与小喷', touch ? '有速度后，转弯时按住“漂移”。看到彩色火花后松开，获得出弯小喷。' : `有速度后，转弯时按住 ${keys('drift')}；出现彩色火花后松开，获得出弯小喷。`),
        card('氮', '氮气冲刺', touch ? '出弯回正后按住 ⚡ 氮气加速。留一点氮气给长直道或关键超车。' : `出弯回正后按住 ${keys('nitro')} 加速。留一点氮气给长直道或关键超车。`),
        card('道', '主动使用道具', touch ? '道具赛拾取后点“道具”使用；不要急着出手，也可以留着防守或在合适位置放陷阱。' : `道具赛拾取后按 ${keys('useItem')} 使用；可以留着防守，或在合适位置放陷阱。`),
      ], note: '不必一次记住：最后可以进入没有对手的弯道练习，边开边学。',
    },
    {
      section: '04 / 比赛界面', title: '看懂赛道上的提示。',
      intro: '比赛开始后，屏幕上的这些区域会告诉你当前状态和下一步机会。',
      cards: [
        card('圈', '圈数、计时与名次', '圈数记录比赛进度，计时显示已用时间，名次显示你在所有车手中的位置。'),
        card('图', '右上角小地图', '提前判断下一个弯道，查看自己与其他车手在赛道上的位置。'),
        card('氮', '氮气条与金色晶体', '氮气条显示剩余能量。收集金色晶体、成功漂移都能补充氮气。'),
        card('焰', '车速与漂移蓄力', '车速帮助判断入弯时机；漂移蓄力从蓝、金到紫，松开后的喷射也会更强。'),
        card('道', '道具槽与来袭提示', '道具槽显示持有的道具，按提示使用。来袭警告出现时，可准备护盾或调整路线。'),
        card('线', '彩色策略路线', '绿线减速补能，橙线消耗氮气换速度，中线正常通过。根据剩余能量选择路线。'),
      ], note: '先保持在路面上，再尝试小喷、收集和路线组合，逐步提速就好。',
    },
    {
      section: '05 / 好友联机', title: '约上朋友，一起追风。',
      intro: '主菜单的“好友联机”是创建或加入房间的入口，支持 2～8 人一起比赛。',
      cards: [
        card('建', '创建好友房间', '房主创建后分享 6 位房间号。朋友输入房间号加入，空余车位会由 AI 车手补齐。'),
        card('入', '加入朋友的房间', '在联机面板输入朋友给你的房间号，加入后等待房主开始比赛。'),
        card('选', '房间设置与地图投票', '房主可调整比赛设置；大家可以投票选下一张地图，跑完后继续下一局。'),
        card('看', '完赛观战与下一场', '先冲线也能继续观战还在比赛的朋友。赛后可以留在房间继续比，也能返回大厅。'),
      ], note: '联机比赛会持续进行；退出或切到后台不会让其他玩家的比赛暂停。',
    },
    {
      section: '06 / 更多目标', title: '每一程，都有新目标。',
      intro: '主菜单下方的“晴空杯 · 挑战 · 车库”把更多玩法放在一起。',
      cards: [
        card('杯', '晴空杯', '连跑四张地图，按名次累计积分。可选择竞速杯或道具杯，争取总积分领先。'),
        card('章', '挑战奖章', '完成正式比赛中的目标获得奖章，逐步解锁车漆、尾焰和称号。'),
        card('漆', '外观车库', '装备已经解锁的外观。车漆、尾焰和称号只改变样子，不影响赛车性能。'),
        card('练', '弯道练习', '在没有对手的赛道里，按自己的节奏练习刹车入弯、漂移小喷和氮气。可随时退出。'),
      ], note: '奖章、外观和练习完成记录保存在当前浏览器，换设备后不会自动同步。',
    },
    {
      section: '07 / 设置与帮助', title: '最后，调成顺手的样子。',
      intro: touch ? '右上角 ⚙ 打开设置。手机操作有独立的触控布局，横屏和竖屏可以分别保存。' : '右上角 ⚙ 打开设置。电脑键盘与手机触控分开设置，可以随时切换查看。',
      cards: [
        card('键', touch ? '手机触控设置' : '电脑键位设置', touch ? '选择左右手布局，或自由拖动各个按键的位置；还可以调整按键大小和透明度。' : '为每个功能录制主键和副键。游戏内按键提示会跟随修改，避免记错操作。'),
        card('调', '驾驶、画面和声音', '调整转向灵敏度、自动油门、画面质量和音量，设置会自动保存在本机。'),
        card('屏', '全屏与声音按钮', '右上角全屏按钮放大游戏画面；扬声器按钮快速开关声音。手机建议横过来玩。'),
        card('?', '随时重新查看', '右上角“?”可查看操作说明，再点“重看新手介绍”回顾各个区域。'),
      ], note: '准备好了！可以先去练习，也可以回到菜单，自由选择第一场比赛。',
    },
  ];
}

export class NewPlayerGuide {
  constructor(root, { storage, getBindings = () => DEFAULT_KEY_BINDINGS, canOpen = () => true, onOpen, onClose, onPractice, onSaveError } = {}) {
    this.root = root;
    this.document = root.ownerDocument;
    this.getBindings = getBindings; this.canOpen = canOpen;
    this.onOpen = onOpen; this.onClose = onClose; this.onPractice = onPractice; this.onSaveError = onSaveError;
    try { this.storage = storage || this.document.defaultView.localStorage; } catch {}
    try { this.seen = ['done', 'skipped'].includes(this.storage?.getItem(NEW_PLAYER_GUIDE_KEY)); } catch { this.seen = false; }
    this.step = 0; this.pending = false; this.opened = false;
    this.overlay = this.document.createElement('section');
    this.overlay.className = 'overlay new-player-guide'; this.overlay.hidden = true;
    this.overlay.innerHTML = `<div class="guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title" aria-describedby="guide-intro">
      <header class="guide-header"><span class="guide-brand">✳ SUNNY KART <small>新手介绍</small></span><button type="button" class="guide-skip">跳过介绍</button></header>
      <div class="guide-body"><span class="guide-section"></span><h2 id="guide-title" tabindex="-1"></h2><p id="guide-intro"></p><div class="guide-cards"></div><p class="guide-note"></p></div>
      <footer class="guide-footer"><div class="guide-progress"><span class="guide-counter" role="status" aria-live="polite"></span><div class="guide-dots" aria-hidden="true"></div></div><div class="guide-actions"><button type="button" class="guide-prev">上一步</button><button type="button" class="guide-next">下一步</button><button type="button" class="guide-practice" hidden>先去弯道练习 →</button></div></footer>
    </div>`;
    root.append(this.overlay);
    this.replayButton = this.document.createElement('button');
    this.replayButton.type = 'button'; this.replayButton.className = 'guide-replay'; this.replayButton.textContent = '重看新手介绍';
    const help = root.querySelector('.help-dialog');
    if (help) help.insertBefore(this.replayButton, help.querySelector('.help-footnote'));
    this.replayButton.addEventListener('click', () => this.open());
    this.overlay.querySelector('.guide-skip').addEventListener('click', () => this.close());
    this.overlay.querySelector('.guide-prev').addEventListener('click', () => this.previous());
    this.overlay.querySelector('.guide-next').addEventListener('click', () => this.next());
    this.overlay.querySelector('.guide-practice').addEventListener('click', () => this.close({ practice: true }));
    this.overlay.addEventListener('keydown', event => this.onKey(event));
    root.addEventListener('inputmodechange', () => this.refresh());
    this.refresh();
  }

  get isOpen() { return this.opened; }

  offer() { this.pending = !this.seen; }

  update() {
    const allowed = this.canOpen();
    this.replayButton.disabled = !allowed;
    if (this.opened && (!allowed || this.overlay.hidden)) { this.close({ remember: false }); return; }
    if (this.pending && allowed && !this.otherModal()) this.open({ automatic: true });
  }

  otherModal(allowHelp = false) {
    return [...this.root.querySelectorAll('.overlay')].some(element => element !== this.overlay && !element.hidden && !(allowHelp && element.classList.contains('help-overlay')));
  }

  open({ automatic = false } = {}) {
    if (this.opened || !this.canOpen() || this.otherModal(!automatic)) return false;
    this.previousFocus = this.document.activeElement;
    this.onOpen?.();
    this.pending = false; this.step = 0; this.opened = true; this.overlay.hidden = false;
    // Prevent background controls from receiving clicks or keyboard focus.
    this.background = new Map([...this.root.children].filter(child => child !== this.overlay).map(child => [child, child.inert]));
    for (const child of this.background.keys()) child.inert = true;
    this.refresh(true);
    return true;
  }

  close({ remember = true, practice = false } = {}) {
    if (!this.opened) return;
    this.opened = false; this.pending = false; this.overlay.hidden = true;
    for (const [child, inert] of this.background || []) child.inert = inert;
    this.background?.clear();
    if (remember) {
      this.seen = true;
      try { this.storage?.setItem(NEW_PLAYER_GUIDE_KEY, this.step === 6 ? 'done' : 'skipped'); }
      catch { this.onSaveError?.('已关闭新手介绍；浏览器暂未能保存，下次进入可能再次显示。'); }
    }
    const previous = this.previousFocus;
    const focus = previous?.isConnected && !previous.closest('[hidden],[inert]') && previous !== this.document.body ? previous : this.root.querySelector('.help-button');
    focus?.focus();
    this.onClose?.();
    if (practice) this.onPractice?.();
  }

  next() {
    if (!this.opened) return;
    if (this.step === 6) { this.close(); return; }
    this.step++; this.refresh(true);
  }

  previous() { if (this.opened && this.step > 0) { this.step--; this.refresh(true); } }

  refresh(focus = false) {
    const content = pages(this.root.dataset.inputMode === 'touch', this.getBindings())[this.step];
    this.overlay.querySelector('.guide-section').textContent = content.section;
    this.overlay.querySelector('#guide-title').textContent = content.title;
    this.overlay.querySelector('#guide-intro').textContent = content.intro;
    this.overlay.querySelector('.guide-cards').innerHTML = content.cards.map(({ icon, title, body }) => `<article class="guide-card"><span class="guide-card-icon" aria-hidden="true">${esc(icon)}</span><div><h3>${esc(title)}</h3><p>${body}</p></div></article>`).join('');
    this.overlay.querySelector('.guide-note').textContent = content.note;
    this.overlay.querySelector('.guide-counter').textContent = `${this.step + 1} / 7`;
    this.overlay.querySelector('.guide-dots').innerHTML = Array.from({ length: 7 }, (_, index) => `<span${index === this.step ? ' aria-current="step"' : ''}></span>`).join('');
    this.overlay.querySelector('.guide-prev').disabled = this.step === 0;
    this.overlay.querySelector('.guide-next').textContent = this.step === 6 ? '明白了，自由游玩' : '下一步 →';
    this.overlay.querySelector('.guide-practice').hidden = this.step !== 6 || !this.onPractice;
    if (focus && this.opened) {
      this.overlay.querySelector('.guide-body').scrollTop = 0;
      this.overlay.querySelector('#guide-title').focus({ preventScroll: true });
    }
  }

  onKey(event) {
    if (!this.opened) return;
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); if (this.step < 6) this.next(); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.previous(); return; }
    if (event.key !== 'Tab') return;
    const buttons = [...this.overlay.querySelectorAll('button')].filter(button => !button.disabled && !button.closest('[hidden]'));
    const first = buttons[0], last = buttons.at(-1), active = this.document.activeElement;
    if (event.shiftKey && (active === first || !buttons.includes(active))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (active === last || !buttons.includes(active))) { event.preventDefault(); first?.focus(); }
  }
}
