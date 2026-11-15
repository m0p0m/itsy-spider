# Security policy

Itsy draws a transparent, always-on-top window over your desktop and can capture the mouse cursor, so a bug here can lock someone out of their own computer. Security reports are taken seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub instead:

1. Go to the [Security tab](../../security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the problem, how to reproduce it, and what an attacker could do with it.

You'll get a reply within a few days. Once it's fixed, you'll be credited in the release notes unless you'd rather stay anonymous.

## What counts

Examples of things worth reporting:

- Any way for the cursor to stay captured after `Ctrl+Alt+X`, after 60 seconds, or after the app stops responding
- The overlay blocking clicks or keyboard input when it shouldn't
- Code execution through settings files, window titles, or the PowerShell window helper
- A release file that doesn't match what the source builds

## Supported versions

Only the [latest release](../../releases/latest) gets security fixes.
