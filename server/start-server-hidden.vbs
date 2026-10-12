' Start the AI Archive server with no visible window.
' Double-click this file, or put a shortcut to it in shell:startup
' Keep this file ASCII-only and CRLF.

Option Explicit

Dim fso, sh, here, serverJs, nodeExe

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

here     = fso.GetParentFolderName(WScript.ScriptFullName)
serverJs = here & "\server.mjs"

If Not fso.FileExists(serverJs) Then
  MsgBox "server.mjs was not found next to this script.", 16, "AI Archive"
  WScript.Quit 1
End If

nodeExe = FindExe("node.exe")
If nodeExe = "" Then
  MsgBox "Node.js was not found. Install it from https://nodejs.org/ and try again.", 16, "AI Archive"
  WScript.Quit 1
End If

sh.Run """" & nodeExe & """ """ & serverJs & """", 0, False

Function FindExe(name)
  Dim paths, i, p, candidate, fallbacks
  FindExe = ""

  paths = Split(sh.ExpandEnvironmentStrings("%PATH%"), ";")
  For i = 0 To UBound(paths)
    p = Trim(paths(i))
    If Len(p) > 1 Then
      candidate = p
      If Right(candidate, 1) = "\" Then candidate = Left(candidate, Len(candidate) - 1)
      If fso.FileExists(candidate & "\" & name) Then
        FindExe = candidate & "\" & name
        Exit Function
      End If
    End If
  Next

  fallbacks = Array( _
    sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe"), _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\nodejs\node.exe"), _
    sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\nodejs\node.exe") _
  )
  For i = 0 To UBound(fallbacks)
    If fso.FileExists(fallbacks(i)) Then
      FindExe = fallbacks(i)
      Exit Function
    End If
  Next
End Function
