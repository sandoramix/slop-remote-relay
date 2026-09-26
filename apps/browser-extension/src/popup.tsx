import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import qrcode from 'qrcode-generator';
import {
  type BrowserTransportId,
  type ExtensionSettings,
  type LastCommand,
  loadSettings,
  PRESENCE_WINDOW_MS,
  type ReceiverState,
  type RuntimeMessage,
  type TargetInfo,
} from './shared';

// ------------------------------------------------------------------- i18n

/** chrome.i18n with {name} placeholders. English is the fallback locale. */
function t(key: string, vars: Record<string, string | number> = {}): string {
  const msg = chrome.i18n.getMessage(key) || key;
  return msg.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

function ago(at: number | null, now: number): string {
  if (!at) return '';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 3) return t('justNow');
  if (s < 60) return t('secondsAgo', { n: s });
  if (s < 3600) return t('minutesAgo', { n: Math.round(s / 60) });
  return t('hoursAgo', { n: Math.round(s / 3600) });
}

function clock(ms: number | null): string {
  if (ms == null) return '–:––';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function describe(cmd: LastCommand): string {
  const a = cmd.args;
  switch (cmd.op) {
    case 'playback.seek': {
      const sec = Math.round((a.deltaMs ?? 0) / 1000);
      return t('cmdSeek', { amount: `${sec >= 0 ? '+' : '−'}${Math.abs(sec)} s` });
    }
    case 'playback.seekTo':
      return t('cmdSeekTo', { time: clock(a.positionMs ?? 0) });
    case 'playback.playPause':
      return a.play === true ? t('cmdPlay') : a.play === false ? t('cmdPause') : t('cmdPlayPause');
    case 'fullscreen.enter':
      return t('cmdFullscreen');
    case 'fullscreen.exit':
      return t('cmdExitFullscreen');
    default:
      return cmd.op;
  }
}

const PATHS: BrowserTransportId[] = ['webrtc', 'relay', 'http', 'mqtt'];

// Same 80-bit scheme as the controller and the Android receiver.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
function generatePairCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b, i) => ALPHABET[b % 32] + (i % 4 === 3 && i < 15 ? '-' : '')).join('');
}

const isWsUrl = (v: string) => /^wss?:\/\/[^\s/]+/i.test(v.trim());
const weak = (code: string) => code.replace(/[^a-z0-9]/gi, '').length < 12;

async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
}

// ------------------------------------------------------------------ hooks

/** Receiver state from the offscreen document, live while the popup is open. */
function useReceiverState(): ReceiverState | null {
  const [state, setState] = useState<ReceiverState | null>(null);
  useEffect(() => {
    const load = () =>
      chrome.runtime
        .sendMessage({ to: 'offscreen', type: 'getState' } satisfies RuntimeMessage)
        .then((s: ReceiverState) => s && setState(s))
        .catch(() => undefined);
    void load();
    const onMessage = (msg: RuntimeMessage) => {
      if (msg.to === 'any' && msg.type === 'state') setState(msg.state);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    const timer = setInterval(load, 3000);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      clearInterval(timer);
    };
  }, []);
  return state;
}

function useTarget(enabled: boolean): TargetInfo | null | undefined {
  const [target, setTarget] = useState<TargetInfo | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    const load = () =>
      chrome.runtime
        .sendMessage({ to: 'worker', type: 'getTarget' } satisfies RuntimeMessage)
        .then((info: TargetInfo | null) => setTarget(info ?? null))
        .catch(() => setTarget(null));
    void load();
    const timer = setInterval(load, 1500);
    return () => clearInterval(timer);
  }, [enabled]);
  return target;
}

function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// ------------------------------------------------------------------ views

function Header() {
  return (
    <header class="header">
      <img src="icon-48.png" alt="" width={32} height={32} />
      <div>
        <h1>Relay</h1>
        <p class="muted small">{t('subtitle')}</p>
      </div>
    </header>
  );
}

function Setup({ initial, onDone }: { initial: ExtensionSettings; onDone: (s: ExtensionSettings) => void }) {
  const [relay, setRelay] = useState(initial.relayUrl);
  const [code, setCode] = useState(initial.pairCode || generatePairCode());
  const relayOk = isWsUrl(relay);

  return (
    <section class="card stack">
      <div>
        <h2>{t('setupTitle')}</h2>
        <p class="muted">{t('setupIntro')}</p>
      </div>
      <label class="step">
        <span class="step-num">1</span>
        <span class="stack grow">
          <span class="label">{t('stepRelay')}</span>
          <input
            type="url"
            value={relay}
            placeholder="wss://relay.example.com"
            spellcheck={false}
            onInput={(e) => setRelay((e.target as HTMLInputElement).value)}
          />
          <span class={relay && !relayOk ? 'error small' : 'muted small'}>
            {relay && !relayOk ? t('invalidRelay') : t('stepRelayHint')}
          </span>
        </span>
      </label>
      <label class="step">
        <span class="step-num">2</span>
        <span class="stack grow">
          <span class="label">{t('stepCode')}</span>
          <span class="row">
            <input
              class="mono grow"
              value={code}
              spellcheck={false}
              onInput={(e) => setCode((e.target as HTMLInputElement).value.trim())}
            />
            <button type="button" class="ghost" onClick={() => setCode(generatePairCode())}>
              {t('newCode')}
            </button>
          </span>
          <span class="muted small">{t('stepCodeHint')}</span>
        </span>
      </label>
      <div class="step">
        <span class="step-num">3</span>
        <button
          type="button"
          class="primary grow"
          disabled={!relayOk || !code}
          onClick={async () => {
            const next = { ...initial, relayUrl: relay.trim(), pairCode: code };
            await saveSettings(next);
            onDone(next);
          }}
        >
          {t('stepFinish')}
        </button>
      </div>
    </section>
  );
}

function StatusCard({ state, now }: { state: ReceiverState | null; now: number }) {
  const present = !!state?.lastFrameAt && now - state.lastFrameAt < PRESENCE_WINDOW_MS;
  const anyUp = state?.paths.some((p) => p.up) ?? false;
  let tone = 'wait';
  let title = t('connectingTitle');
  let sub = '';
  if (present && state?.lastPath) {
    tone = 'ok';
    title = t('connectedTitle');
    sub = t('connectedSub', { path: t(`path_${state.lastPath}`), ago: ago(state.lastFrameAt, now) });
  } else if (anyUp) {
    title = t('waitingTitle');
    sub = t('waitingSub');
  } else if (state && state.paths.length > 0) {
    tone = 'bad';
    title = t('offlineTitle');
    sub = t('offlineSub');
  }
  return (
    <section class={`card status ${tone}`} aria-live="polite">
      <span class={`pulse ${tone}`} />
      <div class="stack tight">
        <strong class="status-title">{title}</strong>
        {sub ? <span class="muted small">{sub}</span> : null}
      </div>
    </section>
  );
}

function TargetCard({ target }: { target: TargetInfo | null | undefined }) {
  if (target === undefined) return null;
  return (
    <section class="card stack tight">
      <span class="label">{t('nowControlling')}</span>
      {target ? (
        <div class="row">
          {target.favIconUrl ? (
            <img class="favicon" src={target.favIconUrl} alt="" width={20} height={20} />
          ) : (
            <span class="favicon placeholder" />
          )}
          <div class="stack tight grow clip">
            <span class="ellipsis">{target.title}</span>
            <span class="muted small ellipsis">
              {target.hasMedia
                ? `${target.playing ? '▶ ' + t('playing') : '❚❚ ' + t('paused')} · ${clock(target.positionMs)} / ${clock(target.durationMs)}${target.fullscreen ? ' · ' + t('fullscreenOn') : ''}`
                : t('noVideo')}
            </span>
          </div>
        </div>
      ) : (
        <div class="stack tight">
          <span>{t('noTarget')}</span>
          <span class="muted small">{t('noTargetHint')}</span>
        </div>
      )}
    </section>
  );
}

function LastCommandRow({ cmd, now }: { cmd: LastCommand | null; now: number }) {
  if (!cmd) return null;
  return (
    <section class="card row">
      <span class={`badge ${cmd.ok ? 'ok' : 'bad'}`}>{cmd.ok ? '✓' : '✕'}</span>
      <div class="stack tight grow clip">
        <span class="label">{t('lastCommand')}</span>
        <span class="ellipsis">
          {describe(cmd)} <span class="muted small">· {ago(cmd.at, now)}</span>
        </span>
        {!cmd.ok && cmd.detail ? <span class="error small">{cmd.detail}</span> : null}
      </div>
    </section>
  );
}

function useDebuggerPermission() {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    void chrome.permissions.contains({ permissions: ['debugger'] }).then(setGranted);
  }, []);
  const request = async () => setGranted(await chrome.permissions.request({ permissions: ['debugger'] }));
  return [granted, request] as const;
}

function FullscreenBanner() {
  const [granted, request] = useDebuggerPermission();
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    void chrome.storage.local.get('fsBannerDismissed').then((r) => setDismissed(!!r.fsBannerDismissed));
  }, []);
  if (granted !== false || dismissed !== false) return null;
  return (
    <section class="card banner stack">
      <strong>{t('fsBannerTitle')}</strong>
      <span class="muted small">{t('fsBannerBody')}</span>
      <div class="row">
        <button type="button" class="primary grow" onClick={request}>
          {t('fsBannerButton')}
        </button>
        <button
          type="button"
          class="ghost"
          onClick={() => {
            setDismissed(true);
            void chrome.storage.local.set({ fsBannerDismissed: true });
          }}
        >
          {t('notNow')}
        </button>
      </div>
    </section>
  );
}

function Collapsible({ title, children, open }: { title: string; children: preact.ComponentChildren; open?: boolean }) {
  return (
    <details class="card collapsible" open={open}>
      <summary>{title}</summary>
      <div class="stack">{children}</div>
    </details>
  );
}

function PairSection({ settings, onChange }: { settings: ExtensionSettings; onChange: (s: ExtensionSettings) => void }) {
  const [copied, setCopied] = useState(false);
  const params = new URLSearchParams({ code: settings.pairCode, name: 'Browser', kind: 'browser' });
  if (settings.relayUrl) params.set('relay', settings.relayUrl);
  const qr = qrcode(0, 'M');
  qr.addData(`relay://pair?${params}`);
  qr.make();

  return (
    <div class="stack">
      <p class="muted small">{t('pairHint')}</p>
      <div class="qr" dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 4, margin: 0 }) }} />
      <div class="row">
        <code class="mono grow">{settings.pairCode}</code>
        <button
          type="button"
          class="ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(settings.pairCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? t('copied') : t('copy')}
        </button>
        <button
          type="button"
          class="ghost"
          onClick={async () => {
            if (!confirm(t('newCodeConfirm'))) return;
            const next = { ...settings, pairCode: generatePairCode() };
            await saveSettings(next);
            onChange(next);
          }}
        >
          {t('newCode')}
        </button>
      </div>
      {weak(settings.pairCode) ? <span class="warn small">{t('weakCode')}</span> : null}
    </div>
  );
}

function PathsSection({
  settings,
  state,
  now,
  onChange,
}: {
  settings: ExtensionSettings;
  state: ReceiverState | null;
  now: number;
  onChange: (s: ExtensionSettings) => void;
}) {
  return (
    <ul class="paths">
      {PATHS.map((id) => {
        const off = settings.disabled.includes(id);
        const needsRelay = id !== 'mqtt' && !settings.relayUrl;
        const live = state?.paths.find((p) => p.id === id);
        const inUse = !!live?.lastFrameAt && now - live.lastFrameAt < PRESENCE_WINDOW_MS;
        const [tone, text] = off
          ? ['off', t('pathOff')]
          : needsRelay
            ? ['off', t('pathNeedsRelay')]
            : inUse
              ? ['ok', t('pathInUse')]
              : live?.up
                ? ['ready', t('pathReady')]
                : ['wait', t('pathConnecting')];
        return (
          <li class="path" key={id}>
            <span class={`dot ${tone}`} />
            <span class="grow">
              {t(`path_${id}`)}
              <span class="muted small"> · {text}</span>
            </span>
            <input
              type="checkbox"
              class="switch"
              aria-label={t(`path_${id}`)}
              checked={!off}
              onChange={async (e) => {
                const on = (e.target as HTMLInputElement).checked;
                const next = {
                  ...settings,
                  disabled: on ? settings.disabled.filter((d) => d !== id) : [...settings.disabled, id],
                };
                await saveSettings(next);
                onChange(next);
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}

function SettingsSection({ settings, onChange }: { settings: ExtensionSettings; onChange: (s: ExtensionSettings) => void }) {
  const [relay, setRelay] = useState(settings.relayUrl);
  const [mqtt, setMqtt] = useState(settings.mqttUrl);
  const [saved, setSaved] = useState(false);
  const relayOk = !relay || isWsUrl(relay);
  const mqttOk = !mqtt || isWsUrl(mqtt);
  return (
    <div class="stack">
      <label class="stack tight">
        <span class="label">{t('relayServer')}</span>
        <input type="url" value={relay} spellcheck={false} onInput={(e) => setRelay((e.target as HTMLInputElement).value)} />
        {!relayOk ? <span class="error small">{t('invalidRelay')}</span> : null}
      </label>
      <label class="stack tight">
        <span class="label">{t('mqttBroker')}</span>
        <input type="url" value={mqtt} spellcheck={false} onInput={(e) => setMqtt((e.target as HTMLInputElement).value)} />
        {!mqttOk ? <span class="error small">{t('invalidRelay')}</span> : null}
      </label>
      <FullscreenSetting />
      <button
        type="button"
        class="primary"
        disabled={!relayOk || !mqttOk}
        onClick={async () => {
          const next = { ...settings, relayUrl: relay.trim(), mqttUrl: mqtt.trim() };
          await saveSettings(next);
          onChange(next);
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        }}
      >
        {saved ? t('saved') : t('save')}
      </button>
    </div>
  );
}

/** The fullscreen permission, always reachable here even after "Not now". */
function FullscreenSetting() {
  const [granted, request] = useDebuggerPermission();
  if (granted === null) return null;
  return (
    <div class="row">
      <span class="grow stack tight">
        <span class="label">{t('fsSetting')}</span>
        <span class="muted small">{granted ? t('fsSettingOn') : t('fsSettingOff')}</span>
      </span>
      {granted ? null : (
        <button type="button" class="ghost" onClick={request}>
          {t('fsBannerButton')}
        </button>
      )}
    </div>
  );
}

function App() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [justPaired, setJustPaired] = useState(false);
  const state = useReceiverState();
  const now = useNow();
  const paired = !!settings?.pairCode;
  const target = useTarget(paired);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  if (!settings) return null;

  return (
    <main class="stack">
      <Header />
      {!paired ? (
        <Setup
          initial={settings}
          onDone={(s) => {
            setSettings(s);
            setJustPaired(true);
          }}
        />
      ) : (
        <>
          <StatusCard state={state} now={now} />
          <TargetCard target={target} />
          <LastCommandRow cmd={state?.lastCommand ?? null} now={now} />
          <FullscreenBanner />
          {/* Open while no phone has ever connected: pairing is the next step. */}
          <Collapsible title={t('pairSection')} open={justPaired || !state?.lastFrameAt}>
            <PairSection settings={settings} onChange={setSettings} />
          </Collapsible>
          <Collapsible title={t('pathsSection')}>
            <PathsSection settings={settings} state={state} now={now} onChange={setSettings} />
          </Collapsible>
          <Collapsible title={t('settingsSection')}>
            <SettingsSection settings={settings} onChange={setSettings} />
          </Collapsible>
        </>
      )}
      <footer class="footer muted small">
        <span>{t('version', { version: chrome.runtime.getManifest().version })}</span>
        <a href="https://github.com/sandoramix/slop-remote-relay" target="_blank" rel="noreferrer">
          {t('project')}
        </a>
      </footer>
    </main>
  );
}

render(<App />, document.getElementById('app')!);
