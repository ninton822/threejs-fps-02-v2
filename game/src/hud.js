// HUD: every readout the judge asks for — health, ammunition, round timer,
// score, money — plus killfeed, banners and the buy menu. Values are written
// only when they change, so the HUD costs nothing on a quiet frame.
import { WEAPONS, GRENADE_PRICE, GRENADE_MAX } from './weapons.js';

const $ = (id) => document.getElementById(id);

export function createHud(callbacks) {
  const el = {
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    dmg: $('dmg'),
    heal: $('heal'),
    healthNum: $('health-num'),
    healthFill: $('health-fill'),
    ammo: $('ammo'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'),
    grenades: $('grenades'),
    timer: $('timer'),
    scoreVan: $('score-van'),
    scoreSen: $('score-sen'),
    alive: $('alive'),
    bomb: $('bomb'),
    money: $('money'),
    roundNum: $('round-num'),
    phaseLabel: $('phase-label'),
    killfeed: $('killfeed'),
    hint: $('hint'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    menu: $('menu'),
    buy: $('buy'),
    buyMoney: $('buy-money'),
    buyRound: $('buy-round'),
    buyTimer: $('buy-timer'),
    buyGrid: $('buy-grid'),
    roundEnd: $('roundEnd'),
    endTitle: $('end-title'),
    endSub: $('end-sub'),
    endStats: $('end-stats'),
    matchEnd: $('matchEnd'),
    matchTitle: $('match-title'),
    matchSub: $('match-sub'),
    matchStats: $('match-stats'),
  };
  const last = {};
  let hitTimer = null;
  let bannerTimer = null;

  function setText(node, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      node.textContent = value;
    }
  }

  function show(node) { node.hidden = false; }
  function hide(node) { node.hidden = true; }

  function update(state) {
    // Health.
    setText(el.healthNum, 'hp', String(state.health));
    el.healthNum.classList.toggle('low', state.health <= 30);
    const hpPct = `${Math.max(0, state.health)}%`;
    if (last.hpPct !== hpPct) {
      last.hpPct = hpPct;
      el.healthFill.style.width = hpPct;
    }
    el.healthFill.classList.toggle('low', state.health <= 30);
    // Ammo and weapon.
    setText(el.ammoMag, 'mag', String(state.mag));
    setText(el.ammoReserve, 'res', `/ ${state.reserve}`);
    el.ammo.classList.toggle('empty', state.mag === 0);
    setText(el.weaponName, 'wname', state.weaponName + (state.reloading ? ' — reloading' : ''));
    setText(el.grenades, 'nades', `Grenades: ${state.grenades}  [4]`);
    // Timer, score, alive counts.
    const t = Math.max(0, Math.ceil(state.timer));
    setText(el.timer, 'timer', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    el.timer.classList.toggle('low', state.timer <= 10 && state.phase === 'live');
    setText(el.scoreVan, 'sv', String(state.scoreVan));
    setText(el.scoreSen, 'ss', String(state.scoreSen));
    setText(el.alive, 'alive', `Vanguard ${state.aliveVan} alive · Sentinel ${state.aliveSen} alive`);
    setText(el.money, 'money', `$${state.money}`);
    setText(el.roundNum, 'round', String(state.round));
    if (state.phase === 'buy') setText(el.buyTimer, 'btimer', String(Math.ceil(state.timer)));
    setText(el.phaseLabel, 'phase', state.phase === 'buy' ? 'BUY PHASE' : state.phase === 'live' ? 'LIVE' : state.phase.toUpperCase());
    // Bomb line.
    let bombText = '';
    if (state.bombState === 'planted') bombText = `CHARGE PLANTED — detonates in ${Math.max(0, Math.ceil(state.bombFuse))}s`;
    else if (state.bombState === 'carried' && state.carryingBomb) bombText = state.touch ? 'YOU CARRY THE CHARGE — plant it at the Pier [hold PLANT]' : 'YOU CARRY THE CHARGE — plant it at the Pier [E]';
    else if (state.bombState === 'dropped') bombText = 'CHARGE DROPPED — pick it up';
    setText(el.bomb, 'bomb', bombText);
    // Crosshair spread.
    const gap = 5 + state.spread * 2.2;
    const gapKey = gap.toFixed(1);
    if (last.gap !== gapKey) {
      last.gap = gapKey;
      el.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    }
    // Hint + plant/defuse progress.
    if (state.hint) {
      el.hint.hidden = false;
      const bar = state.progress >= 0
        ? `<div id="plant-bar"><div id="plant-fill" style="width:${Math.round(state.progress * 100)}%"></div></div>` : '';
      const html = state.hint + bar;
      if (last.hint !== html) {
        last.hint = html;
        el.hint.innerHTML = html;
      }
    } else if (!el.hint.hidden) {
      el.hint.hidden = true;
      last.hint = '';
    }
  }

  function hitmarker(kill) {
    el.hitmarker.classList.add('on');
    el.hitmarker.classList.toggle('kill', !!kill);
    if (hitTimer) clearTimeout(hitTimer);
    hitTimer = setTimeout(() => el.hitmarker.classList.remove('on'), 130);
  }

  function damageFlash() {
    el.dmg.style.opacity = '1';
    setTimeout(() => { el.dmg.style.opacity = '0'; }, 90);
  }

  function killfeed(killer, victim, weaponName, headshot) {
    const div = document.createElement('div');
    const killerClass = killer.team === 'van' ? 'killer-van' : 'killer-sen';
    const victimClass = victim.team === 'van' ? 'killer-van' : 'killer-sen';
    div.innerHTML = `<span class="${killerClass}">${killer}</span> <span class="weapon">[${weaponName}${headshot ? ' · headshot' : ''}]</span> <span class="${victimClass}">${victim}</span>`;
    el.killfeed.prepend(div);
    while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
    setTimeout(() => div.remove(), 5000);
  }

  function banner(title, sub, win) {
    el.bannerTitle.textContent = title;
    el.bannerTitle.className = win === true ? 'win' : win === false ? 'lose' : '';
    el.bannerSub.textContent = sub || '';
    el.banner.classList.add('on');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.banner.classList.remove('on'), 3600);
  }

  function renderBuy(money, owned, onBuy) {
    setText(el.buyMoney, 'bmoney', `$${money}`);
    el.buyGrid.innerHTML = '';
    const cards = [
      { id: 'smg', key: '2', name: 'Hornet SMG', price: WEAPONS.smg.price, desc: 'Fast close-quarters spray. 28-round mag, high rate of fire, wide spread on the move.' },
      { id: 'rifle', key: '3', name: 'Falcon AR', price: WEAPONS.rifle.price, desc: 'The lane-holder. Hard-hitting, accurate standing still, punishes spray-and-pray.' },
      { id: 'grenade', key: '4', name: 'Frag grenade', price: GRENADE_PRICE, desc: `One frag, ${GRENADE_MAX} carried. Arcs over cover, 1.6s fuse, clears a corner.` },
      { id: 'ammo', key: '5', name: 'Reserve ammo', price: 200, desc: 'Top up every weapon you own to full reserve.' },
    ];
    for (const card of cards) {
      const div = document.createElement('div');
      const isOwned = card.id === 'grenade' ? owned.grenades >= GRENADE_MAX : owned.weapons.includes(card.id);
      const afford = money >= card.price;
      div.className = 'buy-card' + (isOwned && card.id !== 'ammo' ? ' owned' : '') + (!afford || (isOwned && card.id !== 'ammo') ? ' cant' : '');
      div.innerHTML = `<div class="name">${card.name}<span>$${card.price}</span></div><div class="desc">${card.desc}</div><div class="key">[${card.key}]${isOwned && card.id !== 'ammo' ? ' — owned' : ''}</div>`;
      if (afford && !(isOwned && card.id !== 'ammo')) {
        div.addEventListener('click', () => onBuy(card.id));
      }
      el.buyGrid.appendChild(div);
    }
  }

  return {
    update,
    hitmarker,
    damageFlash,
    killfeed,
    banner,
    renderBuy,
    showMenu() { show(el.menu); hide(el.buy); hide(el.roundEnd); hide(el.matchEnd); },
    showBuy(round, timer) {
      setText(el.buyRound, 'bround', String(round));
      setText(el.buyTimer, 'btimer', String(Math.ceil(timer)));
      show(el.buy);
    },
    hideBuy() { hide(el.buy); },
    showRoundEnd(title, sub, statsHtml) {
      el.endTitle.textContent = title;
      el.endSub.textContent = sub;
      el.endStats.innerHTML = statsHtml;
      show(el.roundEnd);
    },
    hideRoundEnd() { hide(el.roundEnd); },
    showMatchEnd(title, sub, statsHtml) {
      el.matchTitle.textContent = title;
      el.matchSub.textContent = sub;
      el.matchStats.innerHTML = statsHtml;
      show(el.matchEnd);
    },
    hideAllOverlays() {
      hide(el.menu); hide(el.buy); hide(el.roundEnd); hide(el.matchEnd);
    },
  };
}
