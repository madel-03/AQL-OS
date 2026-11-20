$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$steamRoot = Join-Path ${env:ProgramFiles(x86)} 'Steam'
$libraries = @( $steamRoot )
$libraryList = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $steamRoot 'steamapps/libraryfolders.vdf')
foreach ($match in [regex]::Matches($libraryList, '"path"\s*"([^"]+)"')) {
    $libraries += $match.Groups[1].Value.Replace('\\', '\')
}
$installed = @{}
$pending = @{}
foreach ($library in ($libraries | Select-Object -Unique)) {
    $apps = Join-Path $library 'steamapps'
    if (!(Test-Path -LiteralPath $apps)) { throw 'library_unavailable' }
    foreach ($file in (Get-ChildItem -LiteralPath $apps -Filter 'appmanifest_*.acf' -File)) {
        $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName
        $name = [regex]::Match($manifest, '"name"\s*"([^"]+)"').Groups[1].Value
        $state = [regex]::Match($manifest, '"StateFlags"\s*"(\d+)"')
        if (!$name -or !$state.Success) { throw 'invalid_manifest' }
        $installed[$name] = $true
        # Steam's FullyInstalled and UpdateRequired flags must both be set.
        if (([long]$state.Groups[1].Value -band 6) -eq 6) { $pending[$name] = $true }
    }
}
if (!$pending.Count) { '{"pending":0,"requested":0}'; return }
$scope = [System.Windows.Automation.TreeScope]
$element = [System.Windows.Automation.AutomationElement]
$any = [System.Windows.Automation.Condition]::TrueCondition
$button = [System.Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
# Labels used by Steam's English and Arabic Downloads views.
$labels = @('Download now','Update now','Resume download','تنزيل الآن','تحديث الآن','استئناف التنزيل')
$requested = @{}
$deadline = [DateTime]::UtcNow.AddSeconds(12)
while ([DateTime]::UtcNow -lt $deadline -and $requested.Count -lt $pending.Count) {
    $invoked = $false
    foreach ($proc in (Get-Process -Name steam,steamwebhelper -ErrorAction SilentlyContinue)) {
        if (!$proc.MainWindowHandle -or !$proc.Path -or !$proc.Path.StartsWith($steamRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
        $window = $element::FromHandle($proc.MainWindowHandle)
        foreach ($control in $window.FindAll($scope::Descendants, $button)) {
            if (!$control.Current.IsEnabled -or ($control.Current.Name -notin $labels -and $control.Current.HelpText -notin $labels)) { continue }
            $row = $control
            for ($i = 0; $i -lt 6; $i++) {
                $row = $walker.GetParent($row)
                if (!$row -or $row.Current.ControlType.ProgrammaticName -in 'ControlType.Document','ControlType.Window') { break }
                $names = @($row.Current.Name)
                foreach ($item in $row.FindAll($scope::Descendants, $any)) {
                    if ($installed.ContainsKey($item.Current.Name)) { $names += $item.Current.Name }
                }
                $games = @($names | Where-Object { $installed.ContainsKey($_) } | Select-Object -Unique)
                if (!$games.Count) { continue }
                if ($games.Count -eq 1 -and $pending.ContainsKey($games[0]) -and !$requested.ContainsKey($games[0])) {
                    $pattern = $null
                    if ($control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
                        $pattern.Invoke()
                        $requested[$games[0]] = $true
                        $invoked = $true
                    }
                }
                break
            }
            if ($invoked) { break }
        }
        if ($invoked) { break }
    }
    Start-Sleep -Milliseconds 500
}
@{pending=$pending.Count; requested=$requested.Count} | ConvertTo-Json -Compress
