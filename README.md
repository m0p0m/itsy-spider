<div align="center">

# 🕷 Itsy

**A tiny spider with a brain that lives on your desktop.**
It crawls over your windows, hangs from them on silk, spins webs in their corners, runs from a rushing mouse, makes friends with a gentle one, and hunts the one you leave lying still.

<img src="docs/demo.gif" width="720" alt="Itsy catching a cursor">

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Electron](https://img.shields.io/badge/built%20with-Electron-47848f)

**English** · [فارسی](README.fa.md)

</div>

---

## What makes it alive

**It has a brain.** Not a script: a small drive-based mind, the way simple animals are modelled.

| | |
|---|---|
| **Senses** | how far the cursor is, how fast it moves, whether it is coming *at* the spider, how long it has been still, which windows are open |
| **Emotions** | fear, hunger (real time since its last catch), energy, curiosity, boredom, and **trust in you**, remembered across restarts |
| **Spider sense** | rush the mouse at it and it dodge-jumps out of the way before it even thinks |
| **Choices** | explore window edges · spin a web · rappel under a window · rest · watch you · befriend you · freeze · flee · hunt |

Be calm around it and its trust grows: it walks up to your cursor, waves a front leg and does a little side-to-side dance. Chase it and it learns to be wary. Leave the mouse still while it is hungry and it stalks, crouches and pounces.

**It lives in your windows, not just on top of the screen.**

- Walks along window title bars and hangs from their bottom edges on a thread
- Drag a window and its webs come along; the spider dangling under it swings
- Close or minimize a window and the silk on it falls
- Bring another window to the front and anything behind it is hidden. The spider crawls out from under it.

**A super-spider look.** Glossy red and blue with web lines and big white eyes, sphere-shaded with rim light and a soft shadow so it stands out from the screen. Prefer retro? Switch on pixel style.

**Real legs.** Eight legs driven by two-bone inverse kinematics and an alternating tetrapod gait, the leg pattern real spiders use. Every joint has a height, so shadows lift as feet step and the whole spider leaves the ground when it jumps. It walks sideways and backwards like a spider instead of spinning on the spot.

**Real silk.** Sagging, swaying threads; orb webs built the way spiders build them (frame, radials, then a sticky capture spiral laid from the outside in, with glue droplets). Old silk fades away by itself. **Swipe the mouse fast through silk to tear it** (the spider won't like that), or use *Clear webs* in the tray.

**The trap.** A caught cursor is wrapped in a cocoon and pinned down. Shaking the mouse doesn't help. You have to **click** the strands apart: from 3 clicks right after its last meal up to 10 if it has gone hungry for an hour. Stop clicking and it wraps you up again.

## Install

### Option 1: installer (easiest)

Download the latest installer from **[Releases](../../releases)** and run it. Windows gives you `Itsy Setup.exe` (or a portable `.exe` that needs no install).

### Option 2: run from source

You need:

| Requirement | Version | Get it |
|---|---|---|
| **Node.js** (includes npm) | 18 or newer | [nodejs.org](https://nodejs.org) (LTS) |
| **Git** | any | [git-scm.com](https://git-scm.com) |
| **OS** | Windows 10/11 for the full experience | macOS/Linux run too, without window awareness |

Then:

```bash
git clone https://github.com/m0p0m/itsy-spider.git
cd itsy-spider
npm install
npm start
```

`npm install` downloads Electron (about 100 MB) the first time, so give it a minute.

## Turning it on and off

| | |
|---|---|
| **Start** | `npm start`, or open *Itsy* from the Start menu if you used the installer |
| **Start in demo mode** | `npm run demo`: hunts after 10 s instead of 25 s, great for recording videos |
| **Stop** | Right-click the 🕷 tray icon (next to the clock) → **Quit**, or run `npm run stop` |
| **Pause / resume** | Tray icon → **Pause** (hides it without quitting) |
| **Start with Windows** | Tray icon → **Start with system** |
| **Free a trapped cursor now** | `Ctrl+Alt+X` |

Only one spider runs at a time; starting it again while it is paused wakes it up.

## Controls

Right-click the tray icon:

| | |
|---|---|
| **Pause** | Hide the spider |
| **Free my cursor** / `Ctrl+Alt+X` | Emergency escape |
| **Clear webs** | Sweep away all silk |
| **Size** | Small / Medium / Large |
| **Pixel style** | Retro pixel-art spider |
| **Show its brain** | Live panel with its current action and emotions (great for videos) |
| **Start with system** | Launch at login |

Safety first: the cursor is only captured while the spider is actively guarding it. It lets go by itself after 60 seconds, and if the app ever stops responding the overlay goes click-through again within 2 seconds.

**Try it without installing:** serve `src/renderer/` with any static server (for example `npx serve src/renderer`) and open it in a browser. It runs over a fake desktop with draggable windows. Keys: `P` pixel style, `B` brain panel, `C` clear webs.

## Build your own installer

```bash
npm run dist
```

The installer lands in `dist/`. Pushing a tag like `v0.1.0` builds Windows, macOS and Linux installers on GitHub Actions and attaches them to a draft release.

## Troubleshooting

| Problem | Fix |
|---|---|
| My cursor is stuck in a web | Click fast, or press `Ctrl+Alt+X`. It also lets go by itself after 60 s. |
| I don't see the spider | It may be behind a window or paused: check the tray icon. Try **Size → Large**. |
| It hunts too often / too soon | Change `idleToHunt` and `cooldown` in [`src/renderer/app.js`](src/renderer/app.js) (see *Tuning*). |
| `npm install` is very slow | Electron is a large download; a VPN or another network can help. |
| It doesn't react to windows | Window awareness needs Windows 10/11 and PowerShell (built in). |

## Tuning

The knobs are at the top of [`src/renderer/app.js`](src/renderer/app.js):

```js
idleToHunt: 25,     // seconds the mouse must rest before it gets hunted
cooldown: 120,      // seconds after an escape before it hunts again
minHunger: 0.25,    // right after a meal it is full and leaves you alone
minClicks: 3,       // strands on a quick re-catch
maxClicks: 10,      // strands after a long fast
hungerFull: 3600,   // seconds without a catch to reach maxClicks
regrowAfter: 1.5,   // stop clicking this long and it re-wraps
maxTrap: 60,        // it gets bored and lets go
```

## How it works

```
src/
  main.js        Electron: transparent always-on-top overlay, cursor feed, tray
  windows.js     Windows: lists open windows (EnumWindows via a tiny C# helper run by PowerShell, no native modules)
  renderer/
    world.js     windows in z-order, ledges/undersides, anchors relative to windows, layering
    brain.js     senses → emotions → scored actions, spider sense, memory
    spider.js    steering, gait, IK legs, hanging, jumping, 2.5D drawing, pixel mode
    silk.js      threads, orb web generation and spinning route, tearing, cocoon
    app.js       glue + layered rendering (+ a fake desktop when opened in a browser)
```

- **Layering.** Things are anchored to a host window. Drawing goes from the desktop up through each window, erasing that window's rectangle before drawing what sits on it, so a window brought to the front really hides the silk behind it.
- **IK.** Each leg is hip → knee → foot, solved analytically (law of cosines). The knee always bends away from the body so legs never flip between the two solutions.
- **Gait.** Two leg groups (L1 R2 L3 R4 / R1 L2 R3 L4). A group only steps while the other is planted. Feet land half a gait cycle ahead of their rest position.
- **Webs are graphs plus a route.** The spider chases a "pen" along the route and the pen only moves while the spider keeps up, so the silk always comes out of the spider.

Window awareness is Windows-only for now. On macOS/Linux it treats the whole screen as one surface.

## Roadmap ideas

- macOS window tracking
- Multi-monitor roaming
- Pause automatically during full-screen games and videos
- More species and skins

PRs welcome!

## License

MIT
