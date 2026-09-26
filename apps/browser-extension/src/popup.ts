import qrcode from 'qrcode-generator';
import {
  type BrowserTransportId,
  type ExtensionSettings,
  loadSettings,
  type PathState,
  type RuntimeMessage,
} from './shared';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const PATHS: Array<[BrowserTransportId, string]> = [
  ['webrtc', 'WebRTC P2P'],
  ['relay', 'Relay WebSocket'],
  ['http', 'Relay HTTP'],
  ['mqtt', 'MQTT'],
];

// Same 80-bit scheme as the controller and the Android receiver.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
function generatePairCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b, i) => ALPHABET[b % 32] + (i % 4 === 3 && i < 15 ? '-' : '')).join('');
}

let settings: ExtensionSettings;
let health: PathState[] = [];

function renderPaths(): void {
  const box = $('paths');
  box.replaceChildren(
    ...PATHS.map(([id, name]) => {
      const row = document.createElement('label');
      row.className = 'path';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = !settings.disabled.includes(id);
      toggle.onchange = () => {
        settings.disabled = toggle.checked
          ? settings.disabled.filter((d) => d !== id)
          : [...settings.disabled, id];
        void chrome.storage.local.set({ settings });
      };
      const dot = document.createElement('span');
      dot.className = `dot${health.find((h) => h.id === id)?.up ? ' up' : ''}`;
      const label = document.createElement('span');
      label.className = 'name';
      label.textContent = name;
      row.append(toggle, label, dot);
      return row;
    }),
  );
}

function renderQr(): void {
  const box = $('qr');
  box.replaceChildren();
  $('qrHint').hidden = true;
  if (!settings.pairCode) return;
  const params = new URLSearchParams({ code: settings.pairCode, name: 'Browser', kind: 'browser' });
  if (settings.relayUrl) params.set('relay', settings.relayUrl);
  const qr = qrcode(0, 'M');
  qr.addData(`relay://pair?${params}`);
  qr.make();
  box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
  $('qrHint').hidden = false;
}

async function renderDebugger(): Promise<void> {
  const granted = await chrome.permissions.contains({ permissions: ['debugger'] });
  $('dbgState').textContent = granted
    ? 'Pronto. Durante il comando Chrome mostra per un attimo la barra "debug": è il modo per dare alla pagina il gesto che serve.'
    : 'Serve il permesso "debugger": è l\'unico modo per un\'estensione di mettere un video a schermo intero.';
  $('grantDebugger').hidden = granted;
}

function fillForm(): void {
  $<HTMLInputElement>('pairCode').value = settings.pairCode;
  $<HTMLInputElement>('relayUrl').value = settings.relayUrl;
  $<HTMLInputElement>('mqttUrl').value = settings.mqttUrl;
  $('weak').hidden = !settings.pairCode || settings.pairCode.replace(/[^a-z0-9]/gi, '').length >= 12;
}

async function init(): Promise<void> {
  settings = await loadSettings();
  fillForm();
  renderQr();
  renderPaths();
  void renderDebugger();

  health = ((await chrome.runtime
    .sendMessage({ to: 'offscreen', type: 'getPaths' } satisfies RuntimeMessage)
    .catch(() => [])) ?? []) as PathState[];
  renderPaths();

  $('generate').onclick = () => {
    $<HTMLInputElement>('pairCode').value = generatePairCode();
  };
  $('save').onclick = async () => {
    settings = {
      ...settings,
      pairCode: $<HTMLInputElement>('pairCode').value.trim(),
      relayUrl: $<HTMLInputElement>('relayUrl').value.trim(),
      mqttUrl: $<HTMLInputElement>('mqttUrl').value.trim(),
    };
    await chrome.storage.local.set({ settings });
    fillForm();
    renderQr();
  };
  $('grantDebugger').onclick = async () => {
    await chrome.permissions.request({ permissions: ['debugger'] });
    void renderDebugger();
  };
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage) => {
  if (msg.to === 'any' && msg.type === 'paths') {
    health = msg.paths;
    renderPaths();
  }
});

void init();
