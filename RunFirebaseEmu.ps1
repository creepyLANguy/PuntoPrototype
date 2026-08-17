$ErrorActionPreference = "Stop"

$jdkBin = Get-ChildItem "$HOME\tools\jdk21_extract" -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName "bin" } |
    Where-Object { Test-Path (Join-Path $_ "java.exe") } |
    Select-Object -First 1

if ($jdkBin) { $env:PATH = "$jdkBin;" + $env:PATH }

if (-not (Get-Command java -ErrorAction SilentlyContinue))
{
    throw "Java 21 not found. Extract a JDK into $HOME\tools\jdk21_extract, or add java to PATH."
}

Set-Location $PSScriptRoot
# Loading functions/index.js off OneDrive exceeds the 10s default discovery timeout.
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"
# Quoted: PowerShell would otherwise split the comma list into three separate arguments.
firebase emulators:start --only "firestore,functions,hosting" --project punto-8888-staging