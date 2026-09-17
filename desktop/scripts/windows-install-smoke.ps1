$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$diagnostics = Join-Path $PWD 'smoke-diagnostics'
New-Item -ItemType Directory -Force $diagnostics | Out-Null
$api = 'http://127.0.0.1:8765'

function Get-Listener {
    @(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)
}

function Save-Snapshot([string]$Name) {
    Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'voice-memory*' } |
        Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine |
        ConvertTo-Json -Depth 5 | Set-Content (Join-Path $diagnostics "$Name-processes.json")
    @(Get-Listener) | Select-Object LocalAddress, LocalPort, OwningProcess |
        ConvertTo-Json | Set-Content (Join-Path $diagnostics "$Name-listeners.json")
}

function Wait-Ready($App) {
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        $App.Refresh()
        if ($App.HasExited) { throw "Desktop exited during startup: $($App.ExitCode)" }
        $health = $null
        try { $health = Invoke-RestMethod "$api/health" -TimeoutSec 1 } catch {}
        if ($health -and $health.status -eq 'ok' -and $health.service -eq 'voice-memory') {
            $listeners = @(Get-Listener)
            if ($listeners.Count -ne 1) { throw 'Expected exactly one API listener' }
            $processes = @(Get-CimInstance Win32_Process)
            $ancestor = [int]$listeners[0].OwningProcess
            $owned = $false
            for ($depth = 0; $depth -lt 20; $depth++) {
                if ($ancestor -eq $App.Id) { $owned = $true; break }
                $parent = @($processes | Where-Object ProcessId -eq $ancestor)
                if ($parent.Count -ne 1) { break }
                $ancestor = [int]$parent[0].ParentProcessId
            }
            if (-not $owned) { throw 'Healthy API is not a descendant of the installed desktop' }
            $profiles = Invoke-RestMethod "$api/profiles" -TimeoutSec 5 |
                ConvertTo-Json -Depth 10 | ConvertFrom-Json -AsHashtable
            $expected = @('knowledge','decision','interview','negotiation','relationship','evidence','operations')
            if (@(Compare-Object $expected @($profiles.Keys)).Count -ne 0) {
                throw "Unexpected profiles: $($profiles.Keys -join ', ')"
            }
            if ($App.MainWindowHandle -ne 0 -and $App.MainWindowTitle -eq 'Voice Memory') { return }
        }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Installed desktop did not become ready within 45 seconds'
}

function Wait-Stopped {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $nodes = @(Get-Process -Name 'voice-memory-node' -ErrorAction SilentlyContinue)
        if (@(Get-Listener).Count -eq 0 -and $nodes.Count -eq 0) { return }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Desktop exited but an API listener or PyInstaller process survived'
}

$app = $null
try {
    if (@(Get-Listener).Count -ne 0 -or @(Get-Process -Name 'voice-memory-node' -ErrorAction SilentlyContinue).Count -ne 0) {
        throw 'Runner is not clean before installation'
    }
    $packages = @(Get-ChildItem src-tauri/target -Filter *.msi -Recurse)
    if ($packages.Count -ne 1) { throw "Expected one MSI, got $($packages.Count)" }
    $msi = $packages[0].FullName
    Get-FileHash $msi -Algorithm SHA256 | Format-List | Out-File (Join-Path $diagnostics 'package-hash.txt')
    $log = Join-Path $diagnostics 'install.log'
    $install = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart /L*v `"$log`"" -PassThru
    if (-not $install.WaitForExit(120000)) { $install.Kill(); throw 'MSI installation timed out' }
    if ($install.ExitCode -notin @(0,3010)) { throw "MSI install failed: $($install.ExitCode)" }
    $exe = Join-Path $env:ProgramFiles 'Voice Memory\voice-memory-desktop.exe'
    if (-not (Test-Path $exe)) { throw "Installed executable missing: $exe" }
    # Run from outside the checkout so development files cannot mask packaging gaps.
    foreach ($mode in @('normal-close','restart-close','forced-exit')) {
        $app = Start-Process $exe -WorkingDirectory $env:TEMP -PassThru
        Wait-Ready $app
        Save-Snapshot "$mode-ready"
        if ($mode -eq 'forced-exit') { Stop-Process -Id $app.Id -Force }
        elseif (-not $app.CloseMainWindow()) { throw 'Desktop rejected close request' }
        if (-not $app.WaitForExit(15000)) { throw "Desktop failed to exit: $mode" }
        Wait-Stopped
        Save-Snapshot "$mode-stopped"
        Write-Output "PASS: $mode; owned API, exact profiles, desktop exit, process-tree cleanup"
        $app = $null
    }
    $log = Join-Path $diagnostics 'uninstall.log'
    $uninstall = Start-Process msiexec.exe -ArgumentList "/x `"$msi`" /qn /norestart /L*v `"$log`"" -PassThru
    if (-not $uninstall.WaitForExit(120000)) { $uninstall.Kill(); throw 'MSI uninstall timed out' }
    if ($uninstall.ExitCode -notin @(0,3010)) { throw "MSI uninstall failed: $($uninstall.ExitCode)" }
    if (Test-Path $exe) { throw 'Desktop executable survived uninstall' }
    Write-Output 'PASS: MSI uninstall'
} catch {
    Save-Snapshot 'failure'
    $_ | Out-String | Set-Content (Join-Path $diagnostics 'failure.txt')
    throw
} finally {
    if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
}
