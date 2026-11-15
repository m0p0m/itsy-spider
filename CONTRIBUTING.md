# Contributing to Itsy

Thanks for wanting to make the spider better! 🕷 Bug reports, ideas, art and code are all welcome, and you don't need to be an expert: plenty of issues are labelled [`good first issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

## Ways to help

- **Found a bug?** [Open a bug report](../../issues/new?template=bug_report.yml). A short screen recording helps a lot.
- **Have an idea?** [Suggest a feature](../../issues/new?template=feature_request.yml), or start a thread in [Discussions](../../discussions).
- **Want to code?** Pick an open issue, leave a comment saying you're on it, and send a pull request.
- **Like it?** A ⭐ on the repo helps other people find it.

## Run it locally

You need Node.js 18 or newer.

```bash
git clone https://github.com/m0p0m/itsy-spider.git
cd itsy-spider
npm install
npm start          # the real desktop app
npm run demo       # same, but it hunts after 10 s instead of 25 s
npm run stop       # quit a running instance
```

**Faster loop for drawing and behaviour work:** the renderer also runs in a plain browser over a fake desktop with draggable windows, no Electron needed:

```bash
npx serve src/renderer
```

Keys there: `P` pixel style, `B` brain panel, `C` clear webs. `window.__itsy` in the devtools console gives you the brain, spider, webs and a `step(dt)` function for stepping time by hand.

## Where things live

| File | What it does |
|---|---|
| `src/main.js` | Electron: transparent overlay window, cursor feed, tray menu |
| `src/windows.js` | Lists open windows on Windows (a tiny C# helper run by PowerShell) |
| `src/renderer/brain.js` | Senses → emotions → scored actions |
| `src/renderer/spider.js` | Steering, gait, inverse-kinematics legs, drawing |
| `src/renderer/silk.js` | Threads, orb webs, dew, the cursor cocoon |
| `src/renderer/world.js` | Windows, ledges and anchors |
| `src/renderer/app.js` | Glue and layered rendering |

The README's [How it works](README.md#how-it-works) section explains the IK, gait and web-building in more detail.

## Code style

- Plain JavaScript, no build step and no runtime dependencies. The renderer files are classic scripts loaded in order by `index.html`.
- Keep it fast: it draws every frame on top of the whole desktop. Avoid `shadowBlur` and per-object `save()/restore()` in hot paths; batch strokes into one `Path2D` where you can.
- Comments explain *why*, not *what*.
- Match the style of the file you're editing (2-space indent, single quotes, semicolons).

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Keep each PR focused on one thing.
3. Test it: in the browser demo for drawing and behaviour, and with `npm start` for anything that touches windows, the tray or the cursor trap.
4. Use a short, imperative title in the [Conventional Commits](https://www.conventionalcommits.org/) style, like `feat: add a jumping spider skin` or `fix: release the cursor when the screen locks`.
5. Add a screenshot or a short clip if it changes how the spider looks or moves.

## The cursor trap is a safety feature

Itsy can capture the mouse, so changes near the trap must keep these guarantees: the cursor is only captured while the spider is actively guarding it, `Ctrl+Alt+X` always frees it, it lets go by itself after 60 seconds, and the overlay goes click-through again within 2 seconds if the app stops responding. PRs that weaken any of these won't be merged.

## Security

Please don't open public issues for security problems. See [SECURITY.md](SECURITY.md).

## Code of conduct

Be kind. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
