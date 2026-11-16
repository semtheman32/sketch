' Opens Sketch in its own window. Starts the dev server in the background if it isn't running yet.
' The desktop shortcut points here (see scripts/make-shortcut.ps1).
Option Explicit

Const URL = "http://localhost:5173"
Dim sh, fso, root, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

Function ServerUp()
  Dim http
  ServerUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP")
  http.setTimeouts 1000, 1000, 1000, 1000
  http.open "GET", URL, False
  http.send
  If Err.Number = 0 Then ServerUp = (http.status = 200)
  On Error GoTo 0
End Function

If Not ServerUp() Then
  sh.CurrentDirectory = root
  sh.Run "cmd /c npm run dev", 0, False
  For i = 1 To 60
    WScript.Sleep 500
    If ServerUp() Then Exit For
  Next
  If Not ServerUp() Then
    MsgBox "Sketch could not start. Open a terminal in" & vbCrLf & root & vbCrLf & "and run: npm run dev", vbExclamation, "Sketch"
    WScript.Quit 1
  End If
End If

' App mode gives a clean window with no tabs or address bar. Use Chrome or Edge if installed,
' otherwise the default browser.
Function AppPath(exe)
  Dim p
  AppPath = ""
  On Error Resume Next
  p = sh.RegRead("HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" & exe & "\")
  If p = "" Then p = sh.RegRead("HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" & exe & "\")
  On Error GoTo 0
  If p <> "" Then If fso.FileExists(p) Then AppPath = p
End Function

Dim browser
browser = AppPath("chrome.exe")
If browser = "" Then browser = AppPath("msedge.exe")
If browser <> "" Then
  sh.Run """" & browser & """ --app=" & URL, 1, False
Else
  sh.Run URL
End If
