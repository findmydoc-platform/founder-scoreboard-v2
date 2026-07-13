param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("read", "set", "set-clipboard", "status", "delete")]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$Target
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class WinCred {
    private const int Generic = 1;
    private const int PersistLocalMachine = 2;
    private const int ErrorNotFound = 1168;

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime {
        public uint Low;
        public uint High;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public FileTime LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref Credential credential, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredFree")]
    private static extern void CredFree(IntPtr credential);

    private static IntPtr Find(string target) {
        IntPtr pointer;
        if (CredRead(target, Generic, 0, out pointer)) return pointer;
        int error = Marshal.GetLastWin32Error();
        if (error == ErrorNotFound) return IntPtr.Zero;
        throw new Win32Exception(error);
    }

    public static bool Exists(string target) {
        IntPtr pointer = Find(target);
        if (pointer == IntPtr.Zero) return false;
        CredFree(pointer);
        return true;
    }

    public static string Read(string target) {
        IntPtr pointer = Find(target);
        if (pointer == IntPtr.Zero) return null;
        byte[] blob = null;
        try {
            Credential credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
            blob = new byte[(int)credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, blob, 0, blob.Length);
            return Encoding.Unicode.GetString(blob);
        } finally {
            if (blob != null) Array.Clear(blob, 0, blob.Length);
            CredFree(pointer);
        }
    }

    public static void Write(string target, string secret) {
        byte[] blob = Encoding.Unicode.GetBytes(secret);
        IntPtr blobPointer = Marshal.AllocHGlobal(blob.Length);
        try {
            Marshal.Copy(blob, 0, blobPointer, blob.Length);
            Credential credential = new Credential {
                Type = Generic,
                TargetName = target,
                Comment = "FounderOps Team Task Intake Token",
                CredentialBlobSize = (uint)blob.Length,
                CredentialBlob = blobPointer,
                Persist = PersistLocalMachine,
                UserName = "FounderOps"
            };
            if (!CredWrite(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            Array.Clear(blob, 0, blob.Length);
            for (int index = 0; index < blob.Length; index++) Marshal.WriteByte(blobPointer, index, 0);
            Marshal.FreeHGlobal(blobPointer);
        }
    }

    public static bool Delete(string target) {
        if (CredDelete(target, Generic, 0)) return true;
        int error = Marshal.GetLastWin32Error();
        if (error == ErrorNotFound) return false;
        throw new Win32Exception(error);
    }
}
'@

function Assert-FounderOpsToken([string]$Token) {
  $normalized = $Token.Trim()
  if (-not $normalized.StartsWith("fmd_ti_")) {
    throw "The credential is not a FounderOps Team Task Intake token."
  }
  return $normalized
}

try {
  switch ($Action) {
    "read" {
      $token = [WinCred]::Read($Target)
      if ($null -eq $token) { exit 3 }
      [Console]::Out.Write((Assert-FounderOpsToken $token))
    }
    "set" {
      $secureToken = Read-Host "Paste the FounderOps Team Task Intake token" -AsSecureString
      $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
      try {
        $token = Assert-FounderOpsToken ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
        [WinCred]::Write($Target, $token)
      } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
      }
    }
    "set-clipboard" {
      $token = Assert-FounderOpsToken (Get-Clipboard -Raw)
      [WinCred]::Write($Target, $token)
    }
    "status" {
      if (-not [WinCred]::Exists($Target)) { exit 3 }
    }
    "delete" {
      if (-not [WinCred]::Delete($Target)) { exit 3 }
    }
  }
} catch {
  [Console]::Error.WriteLine("FounderOps credential operation failed.")
  exit 1
} finally {
  $token = $null
  $secureToken = $null
}

