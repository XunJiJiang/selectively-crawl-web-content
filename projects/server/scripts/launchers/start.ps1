$ErrorActionPreference = 'Stop'
$nodeSetting = $env:SCWC_NODE_PATH
$configFile = Join-Path $PSScriptRoot '.env'
if (Test-Path -LiteralPath $configFile) {
  foreach ($line in Get-Content -LiteralPath $configFile -Encoding utf8) {
    if ($line -match '^\s*(?:export\s+)?SCWC_NODE_PATH\s*=') {
      if ($line -notmatch '^\s*(?:export\s+)?SCWC_NODE_PATH\s*=\s*(?:"([^"]*)"|''([^'']*)''|([^#]*))\s*(?:#.*)?$') {
        throw 'Invalid SCWC_NODE_PATH: use a single quoted or unquoted file path.'
      }
      if ($null -ne $Matches[1]) { $nodeSetting = $Matches[1] }
      elseif ($null -ne $Matches[2]) { $nodeSetting = $Matches[2] }
      else { $nodeSetting = $Matches[3].Trim() }
    }
  }
}
$explicitNode = -not [string]::IsNullOrWhiteSpace($nodeSetting)
if ($explicitNode) {
  if (-not [System.IO.Path]::IsPathRooted($nodeSetting)) { $nodeSetting = Join-Path $PSScriptRoot $nodeSetting }
  $candidates = @($nodeSetting)
} else {
  $candidates = @(Get-Command node -CommandType Application -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
}
$selectedNode = $null
foreach ($candidate in $candidates) {
  $savedOptions = $env:NODE_OPTIONS
  try {
    $env:NODE_OPTIONS = ''
    $probe = & $candidate (Join-Path $PSScriptRoot 'start.cjs') --check-node 2>$null
    if ($LASTEXITCODE -eq 0 -and $probe) { $selectedNode = [string]($probe | Select-Object -Last 1); break }
  } catch {
    if ($explicitNode) { throw }
  } finally { $env:NODE_OPTIONS = $savedOptions }
}
if (-not $selectedNode) { throw 'No compatible Node.js >=25 was found. Set SCWC_NODE_PATH in the adjacent .env file.' }
& $selectedNode (Join-Path $PSScriptRoot 'start.cjs') @args
exit $LASTEXITCODE
