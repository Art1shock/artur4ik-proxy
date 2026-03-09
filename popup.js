import { UI_TEXT } from './config.js';

const els = {
  statusBadge: document.getElementById('statusBadge'),
  statusText: document.getElementById('statusText'),
  toggleBtn: document.getElementById('toggleBtn'),
  toggleBtnText: document.getElementById('toggleBtnText'),
  messageBox: document.getElementById('messageBox'),
  bgA: document.querySelector('.bg-a'),
  bgB: document.querySelector('.bg-b')
};

const imageMap = {
  off: 'assets/state-off.jpg',
  connecting: 'assets/state-off.jpg',
  on: 'assets/state-on.jpg',
  error: 'assets/state-off.jpg'
};

const BG_TRANSITION_MS = 560;

let currentState = null;
let activeBg = 'A';
let currentBgImage = null;
let transitionTimer = null;
let pendingBgImage = null;
let isBgTransitioning = false;

function preloadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = src;
  });
}

async function switchImage(status, options = {}) {
  const nextImage = imageMap[status] || imageMap.off;
  const immediate = options.immediate === true;

  if (!nextImage) return;

  if (immediate) {
    clearTimeout(transitionTimer);
    isBgTransitioning = false;
    pendingBgImage = null;
    currentBgImage = nextImage;
    els.bgA.style.backgroundImage = `url("${nextImage}")`;
    els.bgB.style.backgroundImage = `url("${nextImage}")`;
    els.bgA.classList.add('active');
    els.bgB.classList.remove('active');
    activeBg = 'A';
    return;
  }

  if (nextImage === currentBgImage && !isBgTransitioning) {
    return;
  }

  if (isBgTransitioning) {
    pendingBgImage = nextImage;
    return;
  }

  isBgTransitioning = true;
  pendingBgImage = null;
  await preloadImage(nextImage);

  const showLayer = activeBg === 'A' ? els.bgB : els.bgA;
  const hideLayer = activeBg === 'A' ? els.bgA : els.bgB;

  showLayer.style.backgroundImage = `url("${nextImage}")`;
  showLayer.classList.add('is-preparing');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      showLayer.classList.remove('is-preparing');
      showLayer.classList.add('active');
      hideLayer.classList.remove('active');
      activeBg = activeBg === 'A' ? 'B' : 'A';
      currentBgImage = nextImage;

      clearTimeout(transitionTimer);
      transitionTimer = setTimeout(() => {
        isBgTransitioning = false;
        if (pendingBgImage && pendingBgImage !== currentBgImage) {
          const queuedImage = pendingBgImage;
          pendingBgImage = null;
          const matchedStatus = Object.keys(imageMap).find((key) => imageMap[key] === queuedImage) || 'off';
          switchImage(matchedStatus);
          return;
        }
        pendingBgImage = null;
      }, BG_TRANSITION_MS);
    });
  });
}

function setMessage(type, text) {
  if (!text) {
    els.messageBox.className = 'message hidden';
    els.messageBox.textContent = '';
    return;
  }
  els.messageBox.className = `message ${type}`;
  els.messageBox.textContent = text;
}

function formatCheckTime(lastCheck) {
  if (!lastCheck?.at) return '';
  try {
    return new Date(lastCheck.at).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function setStatusUI(state) {
  currentState = state;
  const status = state.status || 'off';

  els.statusBadge.className = `status-badge ${status}`;
  els.toggleBtn.className = `toggle-btn ${status}`;

  if (status === 'off') {
    els.statusBadge.textContent = 'Отключено';
    els.statusText.textContent = UI_TEXT.off;
    els.toggleBtnText.textContent = 'Подключить';
    setMessage('', '');
  } else if (status === 'connecting') {
    els.statusBadge.textContent = 'Проверка';
    els.statusText.textContent = 'Не тревожьте Артурчика, идет проверка подключения…';
    els.toggleBtnText.textContent = 'Подключаем…';
    setMessage('info', 'Ждем реального ответа от тестового сервиса.');
  } else if (status === 'on') {
    els.statusBadge.textContent = 'Подключено';
    els.statusText.textContent = UI_TEXT.on;
    els.toggleBtnText.textContent = 'Отключить';
    const at = formatCheckTime(state.lastCheck);
    const suffix = state.lastCheck?.ip ? ` Внешний IP: ${state.lastCheck.ip}.` : '';
    setMessage('ok', `Прокси активен.${at ? ` Проверено в ${at}.` : ''}${suffix}`);
  } else {
    els.statusBadge.textContent = 'Ошибка';
    els.statusText.textContent = 'Артурчик недоволен. Подключение не прошло проверку.';
    els.toggleBtnText.textContent = 'Повторить';
    setMessage('error', state.lastError || 'Не удалось подключиться.');
  }

  switchImage(status);
}

async function init() {
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  await switchImage(state.status || 'off', { immediate: true });
  setStatusUI(state);
}

els.toggleBtn.addEventListener('click', async () => {
  if (!currentState || currentState.status === 'off' || currentState.status === 'error') {
    setStatusUI({ ...(currentState || {}), status: 'connecting', lastError: '', lastCheck: null });
    const result = await chrome.runtime.sendMessage({ type: 'CONNECT_PROXY' });
    setStatusUI(result.state);
    return;
  }

  if (currentState.status === 'on') {
    setStatusUI({ ...currentState, status: 'connecting' });
    const result = await chrome.runtime.sendMessage({ type: 'DISCONNECT_PROXY' });
    setStatusUI(result.state);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATE_UPDATED') {
    setStatusUI(message.payload);
  }
});

init();
