; VICIMUS Serial Station - extra installer steps (electron-builder NSIS include).
; The installer runs elevated (per-machine install), so these succeed without extra prompts.

!macro customInstall
  ; Let the app talk on the office network: one inbound rule for this program (HTTPS port 47820
  ; and mDNS discovery), on private and domain networks only.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="VICIMUS Serial Station"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="VICIMUS Serial Station" dir=in action=allow program="$INSTDIR\VICIMUS Serial Station.exe" enable=yes profile=private,domain'
  ; Windows often marks a new Wi-Fi as "Public", which blocks discovery between the computers.
  ; Only the networks this computer is connected to right now are changed, and only if Public.
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-NetConnectionProfile | Where-Object { $$_.NetworkCategory -eq $\'Public$\' } | Set-NetConnectionProfile -NetworkCategory Private"'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="VICIMUS Serial Station"'
!macroend
