param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$GhArgs
)

$env:GH_CONFIG_DIR = Join-Path $env:USERPROFILE ".config\gh-findmydoc"
$env:NO_PROXY = "localhost,127.0.0.1,::1,github.com,api.github.com,objects.githubusercontent.com,codeload.github.com"
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""
$env:GIT_HTTP_PROXY = ""
$env:GIT_HTTPS_PROXY = ""

& gh @GhArgs
exit $LASTEXITCODE
