// Reports the visible top-level windows (in z-order, top-most first) so the
// spider can walk on them, hang from them and hide behind them.
//
// Windows only: a long-lived PowerShell process compiles a tiny C# helper
// that polls EnumWindows and prints a JSON line whenever anything changes.
// No native Node modules needed. Other platforms get an empty list.

const { spawn } = require('child_process');
const readline = require('readline');

const HELPER = String.raw`
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;

public static class ItsyWindows {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmRect(IntPtr h, int a, out RECT r, int s);
  [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmInt(IntPtr h, int a, out int v, int s);

  public static void Run(int ownPid) {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { }
    string last = "";
    while (true) {
      StringBuilder sb = new StringBuilder("[");
      bool first = true;
      EnumWindows(delegate (IntPtr h, IntPtr l) {
        if (!IsWindowVisible(h) || IsIconic(h)) return true;
        if ((GetWindowLong(h, -20) & 0x80) != 0) return true; // tool windows
        int cloaked;
        if (DwmInt(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true; // hidden UWP / other desktops
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        if (pid == ownPid) return true;
        StringBuilder cls = new StringBuilder(64);
        GetClassName(h, cls, 64);
        string c = cls.ToString();
        if (c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd" || c == "Progman" || c == "WorkerW") return true;
        RECT r;
        if (DwmRect(h, 9, out r, 16) != 0) GetWindowRect(h, out r); // frame without invisible borders
        if (r.R - r.L < 120 || r.B - r.T < 80) return true;
        if (!first) sb.Append(',');
        first = false;
        sb.Append('[').Append(h.ToInt64()).Append(',').Append(r.L).Append(',').Append(r.T)
          .Append(',').Append(r.R - r.L).Append(',').Append(r.B - r.T).Append(']');
        return true;
      }, IntPtr.Zero);
      sb.Append(']');
      string s = sb.ToString();
      if (s != last) { Console.Out.WriteLine(s); Console.Out.Flush(); last = s; }
      Thread.Sleep(50);
    }
  }
}
`;

function startWindowTracker(onWindows) {
  if (process.platform !== 'win32') return () => {};
  let child = null;
  let stopped = false;

  const launch = () => {
    const script = `Add-Type -TypeDefinition @'\n${HELPER}\n'@\n[ItsyWindows]::Run(${process.pid})`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        onWindows(JSON.parse(line).map(([id, x, y, w, h]) => ({ id: String(id), x, y, w, h })));
      } catch (_) { /* partial line */ }
    });
    child.stderr.on('data', (d) => {
      const text = String(d).trim();
      if (text && !text.startsWith('#< CLIXML')) console.error('[itsy windows]', text);
    });
    child.on('exit', () => {
      child = null;
      if (!stopped) setTimeout(launch, 3000);
    });
  };
  launch();

  return () => {
    stopped = true;
    if (child) child.kill();
  };
}

module.exports = { startWindowTracker };
