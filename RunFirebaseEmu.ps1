$env:PATH = "$HOME\tools\jdk21_extract\jdk-21.0.12+8\bin;" + $env:PATH
Set-Location $PSScriptRoot\..
firebase emulators:start --only firestore,functions,hosting --project punto-8888-staging