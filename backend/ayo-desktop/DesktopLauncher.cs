using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class AqlDesktop
{
    private const string Site = "https://aql-os-orcin.vercel.app/";

    [STAThread]
    private static int Main()
    {
        string error = "يلزم تثبيت Google Chrome أو Microsoft Edge لفتح عقل.";
        foreach (string browser in new[] { @"Google\Chrome\Application\chrome.exe", @"Microsoft\Edge\Application\msedge.exe" })
        {
            foreach (Environment.SpecialFolder root in new[] { Environment.SpecialFolder.ProgramFiles,
                Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.LocalApplicationData })
            {
                string directory = Environment.GetFolderPath(root);
                if (String.IsNullOrEmpty(directory)) continue;
                string exe = Path.Combine(directory, browser);
                if (!File.Exists(exe)) continue;
                try
                {
                    Process.Start(new ProcessStartInfo(exe, "--app=" + Site) { UseShellExecute = false });
                    return 0;
                }
                catch (Win32Exception failure) { error = failure.Message; }
            }
        }
        MessageBox.Show(error, "عقل | AQL", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return 1;
    }
}
