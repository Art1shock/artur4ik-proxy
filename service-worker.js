import { PROXY_CONFIG } from './config.js';

const DEFAULT_STATE = {
  enabled: false,
  status: 'off',
  lastError: '',
  lastCheck: null
};

async function getState() {
  const data = await chrome.storage.local.get('state');
  return { ...DEFAULT_STATE, ...(data.state || {}) };
}

async function setState(patch) {
  const current = await getState();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ state: next });
  try {
    await chrome.runtime.sendMessage({ type: 'STATE_UPDATED', payload: next });
  } catch {}
  return next;
}

function buildProxyConfig() {
  return {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: PROXY_CONFIG.scheme,
        host: PROXY_CONFIG.host,
        port: Number(PROXY_CONFIG.port)
      }
    }
  };
}

async function applyProxy() {
  await chrome.proxy.settings.set({ value: buildProxyConfig(), scope: 'regular' });
}

async function clearProxy() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
}

async function verifyApplied() {
  const proxySettings = await chrome.proxy.settings.get({ incognito: false });
  const singleProxy = proxySettings?.value?.rules?.singleProxy;
  return Boolean(
    singleProxy &&
    singleProxy.scheme === PROXY_CONFIG.scheme &&
    singleProxy.host === PROXY_CONFIG.host &&
    Number(singleProxy.port) === Number(PROXY_CONFIG.port)
  );
}

async function checkExternalIp() {
  const response = await fetch('https://api.ipify.org?format=json', {
    method: 'GET',
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Тестовый запрос не прошел: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data?.ip) {
    throw new Error('Тестовый сервис не вернул IP');
  }

  return String(data.ip);
}

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get('state');
  if (!data.state) {
    await chrome.storage.local.set({ state: DEFAULT_STATE });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'GET_STATE') {
      sendResponse(await getState());
      return;
    }

    if (message.type === 'CONNECT_PROXY') {
      await setState({ enabled: false, status: 'connecting', lastError: '', lastCheck: null });
      try {
        await applyProxy();

        const applied = await verifyApplied();
        if (!applied) {
          await clearProxy();
          sendResponse({
            ok: false,
            state: await setState({
              enabled: false,
              status: 'error',
              lastError: 'Браузер не применил настройки встроенного прокси.',
              lastCheck: null
            })
          });
          return;
        }

        const ip = await checkExternalIp();
        sendResponse({
          ok: true,
          state: await setState({
            enabled: true,
            status: 'on',
            lastError: '',
            lastCheck: { at: Date.now(), ip }
          })
        });
      } catch (error) {
        await clearProxy();
        sendResponse({
          ok: false,
          state: await setState({
            enabled: false,
            status: 'error',
            lastError: error?.message || 'Не удалось подключиться через встроенный прокси.',
            lastCheck: null
          })
        });
      }
      return;
    }

    if (message.type === 'DISCONNECT_PROXY') {
      try {
        await clearProxy();
        sendResponse({
          ok: true,
          state: await setState({
            enabled: false,
            status: 'off',
            lastError: '',
            lastCheck: null
          })
        });
      } catch (error) {
        sendResponse({
          ok: false,
          state: await setState({
            enabled: false,
            status: 'error',
            lastError: error?.message || 'Не удалось отключить прокси.'
          })
        });
      }
      return;
    }
  })();

  return true;
});

chrome.proxy.onProxyError.addListener(async (details) => {
  await setState({
    enabled: false,
    status: 'error',
    lastError: details?.error || 'Proxy error',
    lastCheck: null
  });
});
