// Itsy main process: a transparent, click-through, always-on-top overlay
// covering the primary display. The renderer draws the spider; this process
// feeds it the global cursor position and the open windows, and toggles mouse
// capture while the cursor is trapped in a cocoon.

const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { startWindowTracker } = require('./windows');

const DEMO = process.argv.includes('--demo');
const FREE_SHORTCUT = 'CommandOrControl+Alt+X';
const WATCHDOG_MS = 2000;
const SIZES = { Small: 0.5, Medium: 0.62, Large: 0.8 };

let win = null;
let tray = null;
let paused = false;
let trapped = false;
let lastBeat = 0;
let stopTracker = () => {};
let lastWindows = [];

if (!app.requestSingleInstanceLock()) app.quit();

// ------------------------------------------------------------ settings

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { size: SIZES.Medium, pixel: false, brain: false };

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch (_) { /* first run */ }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (_) { /* read-only profile */ }
}

function changeSetting(key, value) {
  settings[key] = value;
  saveSettings();
  send('settings', settings);
  buildTrayMenu();
}

// -------------------------------------------------------------- window

function createWindow() {
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    ...(process.platform === 'win32' ? { type: 'toolbar' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { demo: DEMO ? '1' : '0' } });
  win.webContents.on('did-finish-load', () => {
    send('settings', settings);
    send('windows', lastWindows);
  });
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[renderer] ${message} (${source}:${line})`);
  });
  win.webContents.on('render-process-gone', () => setTrapped(false));
}

// Mouse capture is only ever on while the renderer says the cursor is trapped
// and keeps sending heartbeats. If it stops (crash, hang), clicks go back to
// the desktop so the overlay can never lock the user out.
function setTrapped(value) {
  trapped = value;
  lastBeat = Date.now();
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!value, { forward: true });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function startCursorFeed() {
  setInterval(() => {
    if (!win || win.isDestroyed() || paused) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    send('cursor', { x: p.x - b.x, y: p.y - b.y });
    if (trapped && Date.now() - lastBeat > WATCHDOG_MS) setTrapped(false);
  }, 16);
}

// The tracker reports physical pixels; the renderer works in DIPs relative
// to the overlay.
function onWindows(list) {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  lastWindows = list.map((r) => {
    const d = screen.screenToDipRect(null, { x: r.x, y: r.y, width: r.w, height: r.h });
    return { id: r.id, x: d.x - b.x, y: d.y - b.y, w: d.width, h: d.height };
  });
  send('windows', lastWindows);
}

function fitToDisplay() {
  if (!win || win.isDestroyed()) return;
  win.setBounds(screen.getPrimaryDisplay().bounds);
}

function setPaused(value) {
  paused = value;
  if (paused) {
    send('command', 'free');
    setTrapped(false);
    win.hide();
  } else {
    win.showInactive();
  }
  buildTrayMenu();
}

function buildTrayMenu() {
  const login = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Itsy 🕷', enabled: false },
    { type: 'separator' },
    { label: 'Pause', type: 'checkbox', checked: paused, click: (i) => setPaused(i.checked) },
    { label: 'Free my cursor', accelerator: FREE_SHORTCUT, click: () => send('command', 'free') },
    { label: 'Clear webs', click: () => send('command', 'clear') },
    { type: 'separator' },
    {
      label: 'Size',
      submenu: Object.entries(SIZES).map(([label, value]) => ({
        label, type: 'radio', checked: settings.size === value, click: () => changeSetting('size', value),
      })),
    },
    { label: 'Pixel style', type: 'checkbox', checked: settings.pixel, click: (i) => changeSetting('pixel', i.checked) },
    { label: 'Show its brain', type: 'checkbox', checked: settings.brain, click: (i) => changeSetting('brain', i.checked) },
    { type: 'separator' },
    { label: 'Start with system', type: 'checkbox', checked: login, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// Tiny procedural tray icon (no image files to ship): a red spider with a
// light outline so it reads on both light and dark taskbars.
function makeTrayIcon() {
  const S = 32;
  const buf = Buffer.alloc(S * S * 4);
  const circles = [[16, 11, 4.2], [16, 20, 6.2]];
  const legs = [];
  const shape = [[[9, -8], [11, -14]], [[10, -2], [14, -5]], [[10, 3], [14, 8]], [[8, 7], [11, 14]]];
  for (const side of [-1, 1]) {
    for (const [knee, foot] of shape) {
      const hip = [16, 13];
      const k = [hip[0] + side * knee[0], hip[1] + knee[1]];
      const f = [hip[0] + side * foot[0], hip[1] + foot[1]];
      legs.push([hip, k], [k, f]);
    }
  }
  const segDist = (px, py, [a, b]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t);
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5, py = y + 0.5;
      let sd = Infinity;
      for (const [cx, cy, r] of circles) sd = Math.min(sd, Math.hypot(px - cx, py - cy) - r);
      for (const seg of legs) sd = Math.min(sd, segDist(px, py, seg) - 1.1);
      const alpha = Math.max(0, Math.min(1, 1.6 - sd));
      const t = Math.max(0, Math.min(1, sd + 0.6));
      const c = [205 + t * 40, 28 + t * 217, 48 + t * 197];
      const i = (y * S + x) * 4;
      buf[i] = c[2]; buf[i + 1] = c[1]; buf[i + 2] = c[0]; buf[i + 3] = Math.round(alpha * 255);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: S, height: S, scaleFactor: 2 });
}

app.whenReady().then(() => {
  loadSettings();
  createWindow();
  startCursorFeed();
  stopTracker = startWindowTracker(onWindows);

  tray = new Tray(makeTrayIcon());
  tray.setToolTip('Itsy — a spider lives here');
  buildTrayMenu();

  globalShortcut.register(FREE_SHORTCUT, () => send('command', 'free'));
  screen.on('display-metrics-changed', fitToDisplay);
  screen.on('display-added', fitToDisplay);
  screen.on('display-removed', fitToDisplay);

  ipcMain.on('trap', (_e, value) => setTrapped(!!value));
  ipcMain.on('beat', () => { lastBeat = Date.now(); });
});

app.on('second-instance', () => { if (paused) setPaused(false); });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopTracker();
});
app.on('window-all-closed', () => app.quit());
