import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { compareVersions, DEFAULT_JUMP_PRESETS, DEFAULT_JUMP_SECONDS, jumpLabel, parseJump } from '@relay/protocol';
import { clearLog, readLog } from './log';
import {
  getLanguage,
  type Language,
  LANGUAGE_NAMES,
  LANGUAGES,
  loadLanguage,
  saveLanguage,
  setLanguage,
  tr,
} from './i18n';
import qrcode from 'qrcode-generator';
import {
  ACTIONS,
  addPreset,
  boundTo,
  chips,
  comboFromEvent,
  comboProblem,
  DEFAULT_BINDINGS,
  DEFAULT_PANEL,
  formatCombo,
  hostOff,
  jumpCommand,
  type PanelAction,
  type PanelSettings,
  type PanelStyle,
  removePreset,
  setHostOff,
  siteKeys,
  STYLES,
} from './panel';
import sites from './sites.json';
import {
  type ActionResult,
  type BrowserTransportId,
  type ExtensionSettings,
  type LastCommand,
  loadPanel,
  loadSettings,
  PRESENCE_WINDOW_MS,
  savePanel,
  type ReceiverState,
  type RuntimeMessage,
  isStoreInstall,
  type TargetInfo,
  type UpdateInfo,
} from './shared';

// ------------------------------------------------------------------- i18n

const t = tr;

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

const SITE = 'https://sandoramix.github.io/slop-remote-relay/';
const LATEST_RELEASE = 'https://github.com/sandoramix/slop-remote-relay/releases/latest';

function Header({ language, onLanguage }: { language: Language; onLanguage: (l: Language) => void }) {
  return (
    <header class="header">
      <img src="icon-48.png" alt="" width={32} height={32} />
      <div class="grow">
        <h1>Skipper</h1>
        <p class="muted small">{t('subtitle')}</p>
      </div>
      <div class="segmented" role="group" aria-label={t('languageLabel')}>
        {LANGUAGES.map((l) => (
          <button
            type="button"
            key={l}
            class={language === l ? 'on' : ''}
            aria-pressed={language === l}
            title={LANGUAGE_NAMES[l]}
            lang={l}
            onClick={() => onLanguage(l)}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  );
}

type Tab = 'skip' | 'phone' | 'settings';
const TABS: Tab[] = ['skip', 'phone', 'settings'];
const isTab = (x: unknown): x is Tab => TABS.some((id) => id === x);

/**
 * The popup's scrolling part: header, tabs and footer stay put, and what is
 * between them scrolls inside its own themed scrollbar. Soft fades at the top
 * and bottom edge show there is more, and disappear at the ends.
 */
function ScrollArea({ children, resetKey }: { children: preact.ComponentChildren; resetKey: string }) {
  const ref = useRef<HTMLDivElement>(null);

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--fade-top', el.scrollTop > 2 ? '18px' : '0px');
    el.style.setProperty('--fade-bottom', el.scrollHeight - el.clientHeight - el.scrollTop > 2 ? '18px' : '0px');
  };

  // A different tab starts at the top.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    measure();
  }, [resetKey]);

  // Content grows and shrinks (sections open, an update arrives): keep the fades right.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, []);

  return (
    <div class="scroll" ref={ref} onScroll={measure}>
      <div class="stack">{children}</div>
    </div>
  );
}

function Tabs({ tab, onTab, phoneTone }: { tab: Tab; onTab: (t: Tab) => void; phoneTone: string }) {
  return (
    <nav class="tabs" role="tablist">
      {TABS.map((id) => (
        <button
          type="button"
          key={id}
          role="tab"
          aria-selected={tab === id}
          class={tab === id ? 'on' : ''}
          onClick={() => onTab(id)}
        >
          {id === 'phone' ? <span class={`dot ${phoneTone}`} /> : null}
          {t(`tab_${id}`)}
        </button>
      ))}
    </nav>
  );
}

function Setup({ initial, onDone }: { initial: ExtensionSettings; onDone: (s: ExtensionSettings) => void }) {
  const [relay, setRelay] = useState(initial.relayUrl);
  const [code, setCode] = useState(initial.pairCode || generatePairCode());
  // Optional: the public MQTT broker already works as shipped.
  const relayOk = !relay.trim() || isWsUrl(relay);

  return (
    <section class="card stack">
      <div>
        <h2>{t('setupTitle')}</h2>
        <p class="muted">{t('setupIntro')}</p>
        <p class="muted small">
          {t('setupNoApp')}{' '}
          <a href={`${SITE}#install`} target="_blank" rel="noreferrer">
            {t('getIt')}
          </a>
        </p>
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
          <span class={!relayOk ? 'error small' : 'muted small'}>
            {!relayOk ? t('invalidRelay') : t('stepRelayHint')}
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

// -------------------------------------------------------------- skip panel

const IS_MAC = /Mac/i.test(navigator.platform);

/** The panel's settings, kept in step with what pages and other popups save. */
function usePanel(): [PanelSettings, (patch: Partial<PanelSettings>) => void] {
  const [panel, setPanel] = useState<PanelSettings>(DEFAULT_PANEL);
  useEffect(() => {
    void loadPanel().then(setPanel);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.panel) void loadPanel().then(setPanel);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  const update = (patch: Partial<PanelSettings>) => {
    const next = { ...panel, ...patch };
    setPanel(next);
    void savePanel(next);
  };
  return [panel, update];
}

function SkipCard({ panel, update, ready }: { panel: PanelSettings; update: (p: Partial<PanelSettings>) => void; ready: boolean }) {
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = parseJump(draft);

  const jump = async (direction: 1 | -1) => {
    setBusy(true);
    const res = (await chrome.runtime
      .sendMessage({ to: 'worker', type: 'execute', cmd: jumpCommand(direction, panel.selected) } satisfies RuntimeMessage)
      .catch((e: Error) => ({ ok: false, detail: e.message }))) as ActionResult;
    setResult(res);
    setBusy(false);
    setTimeout(() => setResult(null), 2500);
  };

  return (
    <section class="card stack">
      <span class="label">{t('skipTitle')}</span>
      <div class="chips">
        {chips(panel).map((seconds) => (
          <button
            type="button"
            key={seconds}
            class={`chip ${seconds === panel.selected ? 'sel' : ''}`}
            aria-pressed={seconds === panel.selected}
            onClick={() =>
              editing ? update({ presets: removePreset(panel.presets, seconds) }) : update({ selected: seconds })
            }
          >
            {jumpLabel(seconds)}
            {editing && panel.presets.length > 1 ? <span aria-label={t('skipRemove')}> ×</span> : null}
          </button>
        ))}
        <button
          type="button"
          class="chip dashed"
          onClick={() => {
            setEditing(!editing);
            setAsking(false);
          }}
        >
          {editing ? t('skipDone') : t('skipEdit')}
        </button>
      </div>
      {editing && !asking ? (
        <button type="button" class="ghost" onClick={() => setAsking(true)}>
          {t('skipRestore')}
        </button>
      ) : null}
      {editing && asking ? (
        <div class="card confirm stack tight" role="alertdialog" aria-label={t('skipRestoreAsk')}>
          <span class="small">{t('skipRestoreAsk')}</span>
          <div class="row">
            <button
              type="button"
              class="primary grow"
              onClick={() => {
                update({ presets: [...DEFAULT_JUMP_PRESETS], selected: DEFAULT_JUMP_SECONDS });
                setAsking(false);
                setEditing(false);
              }}
            >
              {t('skipRestoreYes')}
            </button>
            <button type="button" class="ghost" onClick={() => setAsking(false)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : null}
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!parsed) return;
          update({ selected: parsed, presets: addPreset(panel.presets, parsed) });
          setDraft('');
        }}
      >
        <input
          class="grow"
          value={draft}
          placeholder={t('skipPlaceholder')}
          spellcheck={false}
          aria-label={t('skipPlaceholder')}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
        />
        <button type="submit" class="ghost" disabled={!parsed}>
          {parsed ? t('skipAddAmount', { amount: jumpLabel(parsed) }) : t('skipAdd')}
        </button>
      </form>
      {draft && !parsed ? <span class="error small">{t('panelBadFormat')}</span> : null}
      <div class="row">
        <button type="button" class="jump grow" disabled={busy || !ready} onClick={() => void jump(-1)}>
          ↺ −{jumpLabel(panel.selected)}
        </button>
        <button type="button" class="jump grow" disabled={busy || !ready} onClick={() => void jump(1)}>
          +{jumpLabel(panel.selected)} ↻
        </button>
      </div>
      {result && !result.ok ? <span class="error small">{result.detail}</span> : null}
      <span class="muted small">{t('skipIndependent')}</span>
    </section>
  );
}

function ShortcutRow({
  action,
  panel,
  recording,
  onRecord,
}: {
  action: PanelAction;
  panel: PanelSettings;
  recording: PanelAction | null;
  onRecord: (a: PanelAction | null) => void;
}) {
  const active = recording === action;
  const combo = panel.bindings[action];
  const problem = comboProblem(combo);
  const clash = Object.keys(sites)
    .filter((d) => !d.startsWith('_') && siteKeys(sites as Record<string, { keys?: string[] }>, d).includes(combo))
    .join(', ');
  return (
    <li class="shortcut">
      <span class="grow">
        {t(`act_${action}`)}
        {problem || clash ? (
          <span class="warn small"> · {problem ? t(`problem_${problem}`) : t('siteUses', { site: clash })}</span>
        ) : null}
      </span>
      <kbd>{active ? t('recording') : formatCombo(combo, IS_MAC)}</kbd>
      <button type="button" class="ghost" onClick={() => onRecord(active ? null : action)}>
        {active ? t('cancel') : t('change')}
      </button>
    </li>
  );
}

// ------------------------------------------------------------- style picker

const PREVIEWS: Record<PanelStyle, preact.ComponentChildren> = {
  pills: (
    <>
      <rect x="2" y="15" width="17" height="10" rx="5" />
      <rect x="45" y="15" width="17" height="10" rx="5" />
    </>
  ),
  dock: (
    <>
      <rect x="57" y="12" width="7" height="16" rx="3" />
      <rect x="30" y="9" width="24" height="22" rx="5" fill="none" />
      <rect x="33" y="13" width="8" height="6" rx="2" />
      <rect x="43" y="13" width="8" height="6" rx="2" />
    </>
  ),
  gesture: (
    <>
      <circle cx="32" cy="20" r="10" fill="none" />
      <text x="32" y="23.5" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor" stroke="none">
        ⌥ ⇅
      </text>
    </>
  ),
  timeline: (
    <>
      <rect x="10" y="26" width="44" height="3" rx="1.5" fill="none" />
      <rect x="10" y="26" width="30" height="3" rx="1.5" />
      <circle cx="40" cy="27.5" r="3.5" fill="currentColor" stroke="none" />
    </>
  ),
};

function StylePicker({ panel, update }: { panel: PanelSettings; update: (p: Partial<PanelSettings>) => void }) {
  return (
    <div class="stack tight">
      <span class="label">{t('styleTitle')}</span>
      <div class="styles" role="radiogroup" aria-label={t('styleTitle')}>
        {STYLES.map((id) => (
          <button
            type="button"
            key={id}
            role="radio"
            aria-checked={panel.style === id}
            class={`style-card ${panel.style === id ? 'sel' : ''}`}
            // A new style is new to the person: let it explain itself again.
            onClick={() => update({ style: id, hints: { shown: 0, done: false } })}
          >
            <svg viewBox="0 0 64 40" aria-hidden="true">
              <rect x="0" y="0" width="64" height="40" rx="4" class="screen" />
              <g class="art">{PREVIEWS[id]}</g>
            </svg>
            <strong class="small">{t(`style_${id}`)}</strong>
            <span class="muted small">{t(`style_${id}_d`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Shown once, after the extension gains the panel: where the new thing is. */
function IntroNote() {
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    void chrome.storage.local.get('panelIntro').then((r) => setSeen(r.panelIntro === true));
  }, []);
  if (seen !== false) return null;
  return (
    <section class="card update stack">
      <div class="stack tight">
        <strong>{t('introTitle')}</strong>
        <span class="muted small">{t('introBody')}</span>
      </div>
      <button
        type="button"
        class="primary"
        onClick={() => {
          void chrome.storage.local.set({ panelIntro: true });
          setSeen(true);
        }}
      >
        {t('introGotIt')}
      </button>
    </section>
  );
}

/** Look, on-video controls and the sites they stay away from. */
function LookSettings({ panel, update, host }: { panel: PanelSettings; update: (p: Partial<PanelSettings>) => void; host: string | null }) {
  const hiddenHere = !!host && hostOff(panel.offHosts, host);
  const others = panel.offHosts.filter((h) => h !== host);
  const toggle = (label: string, hint: string | null, on: boolean, set: (v: boolean) => void) => (
    <label class="row option">
      <span class="grow stack tight">
        <span>{label}</span>
        {hint ? <span class="muted small">{hint}</span> : null}
      </span>
      <input type="checkbox" class="switch" checked={on} onChange={(e) => set((e.target as HTMLInputElement).checked)} />
    </label>
  );

  return (
    <div class="stack">
      <StylePicker panel={panel} update={update} />
      {toggle(t('optOverlay'), t('optOverlayHint'), panel.overlay === 'hover', (on) => update({ overlay: on ? 'hover' : 'off' }))}
      {toggle(t('optToast'), null, panel.toast, (toast) => update({ toast }))}
      {toggle(t('optKeys'), t('optKeysHint'), panel.keys, (keys) => update({ keys }))}
      {host
        ? toggle(t('optHideHost', { host }), null, hiddenHere, (off) => update({ offHosts: setHostOff(panel.offHosts, host, off) }))
        : null}
      {others.length > 0 ? (
        <div class="stack tight">
          <span class="label">{t('hiddenOn')}</span>
          <div class="chips">
            {others.map((h) => (
              <button type="button" class="chip" key={h} onClick={() => update({ offHosts: setHostOff(panel.offHosts, h, false) })}>
                {h} ×
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The shortcut list and its recorder. */
function ShortcutSettings({ panel, update }: { panel: PanelSettings; update: (p: Partial<PanelSettings>) => void }) {
  const [recording, setRecording] = useState<PanelAction | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // While a shortcut is being recorded, the next combination is the answer.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setRecording(null);
      const combo = comboFromEvent(e);
      if (!combo) return; // only a modifier so far
      if (comboProblem(combo) === 'needsModifier') return setNote(t('problem_needsModifier'));
      const other = boundTo(panel.bindings, combo, recording);
      if (other) return setNote(t('usedBy', { action: t(`act_${other}`) }));
      update({ bindings: { ...panel.bindings, [recording]: combo } });
      setNote(null);
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, panel]);

  return (
    <div class="stack tight">
      <ul class="shortcuts">
        {ACTIONS.map((a) => (
          <ShortcutRow
            key={a}
            action={a}
            panel={panel}
            recording={recording}
            onRecord={(r) => {
              setNote(null);
              setRecording(r);
            }}
          />
        ))}
      </ul>
      {note ? <span class="error small">{note}</span> : <span class="muted small">{t('shortcutsHint')}</span>}
      <button type="button" class="ghost" onClick={() => update({ bindings: { ...DEFAULT_BINDINGS } })}>
        {t('resetKeys')}
      </button>
    </div>
  );
}

/** The log for the developer: copied, or saved as a file, with the pair code taken out. */
function LogSection() {
  const [note, setNote] = useState<string | null>(null);

  const report = async (): Promise<string> => {
    const { settings } = (await chrome.storage.local.get('settings')) as { settings?: { pairCode?: string } };
    const body = await readLog(settings?.pairCode ? [settings.pairCode] : []);
    if (!body) return '';
    const header = [
      `Skipper extension ${chrome.runtime.getManifest().version}`,
      navigator.userAgent,
      `Language ${getLanguage()}`,
      '---',
    ];
    return [...header, body].join('\n');
  };

  const copy = async () => {
    const text = await report();
    if (!text) return setNote(t('logEmpty'));
    await navigator.clipboard.writeText(text);
    setNote(t('logCopied'));
  };

  const download = async () => {
    const text = await report();
    if (!text) return setNote(t('logEmpty'));
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = `skipper-extension-log-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div class="stack tight">
      <p class="small muted">{t('logHint')}</p>
      <div class="row">
        <button type="button" class="ghost" onClick={() => void copy()}>
          {t('logCopy')}
        </button>
        <button type="button" class="ghost" onClick={() => void download()}>
          {t('logDownload')}
        </button>
        <button
          type="button"
          class="ghost"
          onClick={() => void clearLog().then(() => setNote(null))}
        >
          {t('logClear')}
        </button>
      </div>
      {note ? <span class="small muted">{note}</span> : null}
    </div>
  );
}

/** What the extension does and where to get the remote: for first-time users and store reviewers. */
function AboutSection() {
  return (
    <>
      <p class="small">{t('aboutRemote')}</p>
      <p class="small muted">{t('aboutPaths')}</p>
      <p class="small muted">{t('aboutFullscreen')}</p>
      <div class="stack tight">
        <strong class="small">{t('getAppTitle')}</strong>
        <ul class="links small">
          <li>
            <a href={LATEST_RELEASE} target="_blank" rel="noreferrer">{t('getAndroid')}</a>
          </li>
          <li>
            <a href={`${SITE}#install`} target="_blank" rel="noreferrer">{t('getIphone')}</a>
          </li>
          <li>
            <a href={SITE} target="_blank" rel="noreferrer">{t('installGuide')}</a>
          </li>
        </ul>
      </div>
    </>
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
  // An https link, so a phone camera opens it; the landing page hands off to relay://pair.
  qr.addData(`${SITE}pair/#${params}`);
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

// ---------------------------------------------------------------- updates

const currentVersion = () => chrome.runtime.getManifest().version;

function useUpdate(): [UpdateInfo | null, (info: UpdateInfo | null) => void] {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    void chrome.storage.local.get('update').then((r) => setInfo((r.update as UpdateInfo) ?? null));
  }, []);
  return [info, setInfo];
}

/**
 * Recommended, never forced. An unpacked extension cannot update itself: the
 * user downloads the zip, unzips it over the folder Relay is loaded from, and
 * presses Reload here. Settings and pairing survive, because the manifest's
 * key keeps the extension id fixed.
 */
function UpdateBanner() {
  const [info] = useUpdate();
  const [snoozed, setSnoozed] = useState<boolean | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  useEffect(() => {
    void chrome.storage.local.get('updateSnooze').then((r) => {
      const s = r.updateSnooze as { version: string; until: number } | undefined;
      setSnoozed(!!s && s.version === info?.version && Date.now() < s.until);
    });
  }, [info]);
  if (!info || snoozed !== false || compareVersions(info.version, currentVersion()) <= 0) return null;

  return (
    <section class={`card update stack ${info.important ? 'important' : ''}`}>
      <div class="stack tight">
        <strong>{t(info.important ? 'updateImportant' : 'updateAvailable', { version: info.version })}</strong>
        <span class="muted small">
          {t('updateYouHave', { version: currentVersion() })} {info.important ? t('updateImportantBody') : t('updateRecommended')}
        </span>
      </div>
      {info.summary.length ? (
        <details class="whatsnew">
          <summary class="small">{t('updateWhatsNew')}</summary>
          <ul class="notes small">
            {info.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {!downloaded ? (
        <div class="row">
          <button
            type="button"
            class="primary grow"
            onClick={() => {
              void chrome.tabs.create({ url: info.zipUrl ?? info.pageUrl, active: false });
              setDownloaded(true);
            }}
          >
            {t('updateDownload')}
          </button>
          <button
            type="button"
            class="ghost"
            onClick={() => {
              const days = info.important ? 1 : 3;
              void chrome.storage.local.set({ updateSnooze: { version: info.version, until: Date.now() + days * 86_400_000 } });
              setSnoozed(true);
            }}
          >
            {t('updateLater')}
          </button>
        </div>
      ) : (
        <div class="stack">
          <span class="small">{t('updateSteps')}</span>
          <button type="button" class="primary" onClick={() => chrome.runtime.reload()}>
            {t('updateReload')}
          </button>
        </div>
      )}
      <a class="small" href={info.pageUrl} target="_blank" rel="noreferrer">
        {t('updateNotes')}
      </a>
    </section>
  );
}

function UpdateSetting() {
  const [info, setInfo] = useUpdate();
  const [checking, setChecking] = useState(false);
  const newer = !!info && compareVersions(info.version, currentVersion()) > 0;
  return (
    <div class="row">
      <span class="grow stack tight">
        <span class="label">{t('updatesSetting')}</span>
        <span class="muted small">
          {checking
            ? t('updateChecking')
            : newer
              ? t('updateAvailable', { version: info!.version })
              : info
                ? t('updateUpToDate', { version: currentVersion() })
                : t('version', { version: currentVersion() })}
        </span>
      </span>
      <button
        type="button"
        class="ghost"
        disabled={checking}
        onClick={async () => {
          setChecking(true);
          const next = (await chrome.runtime
            .sendMessage({ to: 'worker', type: 'checkUpdate' } satisfies RuntimeMessage)
            .catch(() => null)) as UpdateInfo | null;
          if (next) setInfo(next);
          setChecking(false);
        }}
      >
        {t('updateCheck')}
      </button>
    </div>
  );
}

function App() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [language, setLang] = useState<Language | null>(null);
  const [tab, setTab] = useState<Tab>('skip');
  const [justPaired, setJustPaired] = useState(false);
  const state = useReceiverState();
  const now = useNow();
  const paired = !!settings?.pairCode;
  const target = useTarget(true);
  const [panel, updatePanel] = usePanel();
  const targetHost = (() => {
    try {
      return target ? new URL(target.url).hostname : null;
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    void Promise.all([loadSettings(), loadLanguage(), chrome.storage.local.get('popupTab')]).then(([s, l, stored]) => {
      setLanguage(l);
      setLang(l);
      setSettings(s);
      if (isTab(stored.popupTab)) setTab(stored.popupTab);
    });
  }, []);

  if (!settings || !language) return null;

  const pickTab = (next: Tab) => {
    setTab(next);
    void chrome.storage.local.set({ popupTab: next });
  };
  const pickLanguage = (l: Language) => {
    setLanguage(l);
    setLang(l);
    void saveLanguage(l);
  };

  // What the Phone tab's dot says, so the connection is visible from every tab.
  const present = !!state?.lastFrameAt && now - state.lastFrameAt < PRESENCE_WINDOW_MS;
  const phoneTone = !paired
    ? 'wait'
    : present
      ? 'ok'
      : state?.paths.some((p) => p.up)
        ? 'ready'
        : state && state.paths.length > 0
          ? 'bad'
          : 'wait';

  return (
    <main class="stack">
      <Header language={language} onLanguage={pickLanguage} />
      <Tabs tab={tab} onTab={pickTab} phoneTone={phoneTone} />
      <ScrollArea resetKey={tab}>
        {isStoreInstall() ? null : <UpdateBanner />}

        {tab === 'skip' ? (
          <>
            {/* Skipping needs no phone and no server, so it is here from the first open. */}
            <IntroNote />
            <TargetCard target={target} />
            <SkipCard panel={panel} update={updatePanel} ready={!!target?.hasMedia} />
          </>
        ) : null}

        {tab === 'phone' ? (
          !paired ? (
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
              <LastCommandRow cmd={state?.lastCommand ?? null} now={now} />
              {/* Open while no phone has ever connected: pairing is the next step. */}
              <Collapsible title={t('pairSection')} open={justPaired || !state?.lastFrameAt}>
                <PairSection settings={settings} onChange={setSettings} />
              </Collapsible>
              <Collapsible title={t('pathsSection')}>
                <PathsSection settings={settings} state={state} now={now} onChange={setSettings} />
              </Collapsible>
              <Collapsible title={t('relaySection')}>
                <SettingsSection settings={settings} onChange={setSettings} />
              </Collapsible>
            </>
          )
        ) : null}

        {tab === 'settings' ? (
          <>
            <section class="card">
              <LookSettings panel={panel} update={updatePanel} host={targetHost} />
            </section>
            <Collapsible title={t('shortcutsTitle')}>
              <ShortcutSettings panel={panel} update={updatePanel} />
            </Collapsible>
            <Collapsible title={t('logTitle')}>
              <LogSection />
            </Collapsible>
            <Collapsible title={t('updatesAbout')}>
              {isStoreInstall() ? null : <UpdateSetting />}
              <AboutSection />
            </Collapsible>
          </>
        ) : null}
      </ScrollArea>

      <footer class="footer muted small">
        <span>{t('version', { version: chrome.runtime.getManifest().version })}</span>
        <span class="row">
          <a href={SITE} target="_blank" rel="noreferrer">
            {t('guide')}
          </a>
          <a href="https://github.com/sandoramix/slop-remote-relay" target="_blank" rel="noreferrer">
            {t('project')}
          </a>
        </span>
      </footer>
    </main>
  );
}

render(<App />, document.getElementById('app')!);
