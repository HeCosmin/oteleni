param([Parameter(Mandatory=$true)][string]$ProcessName)
Start-Sleep -Milliseconds 1200
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class CineWaveWindow {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
$targets = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
if ($targets.Count -eq 0) { exit 0 }
$script:done = $false
$cb = [CineWaveWindow+EnumWindowsProc]{ param($hWnd, $lp)
  if ($script:done) { return $false }
  [uint32]$pid = 0
  [void][CineWaveWindow]::GetWindowThreadProcessId($hWnd, [ref]$pid)
  if (($targets -contains [int]$pid) -and [CineWaveWindow]::IsWindowVisible($hWnd)) {
    # SW_RESTORE then move/resize inside primary display bounds.
    [void][CineWaveWindow]::ShowWindowAsync($hWnd, 9)
    Start-Sleep -Milliseconds 150
    [void][CineWaveWindow]::SetWindowPos($hWnd, [IntPtr]::Zero, 40, 40, 1280, 720, 0x0040)
    $script:done = $true
    return $false
  }
  return $true
}
[void][CineWaveWindow]::EnumWindows($cb, [IntPtr]::Zero)
