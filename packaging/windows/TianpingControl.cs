using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace TianpingControl
{
    internal static class AppPaths
    {
        internal static readonly string InstallRoot =
            Path.GetFullPath(Path.Combine(Application.StartupPath, ".."));
        internal static readonly string AppRoot = Path.Combine(InstallRoot, "app");
        internal static readonly string RuntimeRoot = Path.Combine(InstallRoot, "runtime");
        internal static readonly string NodeExe = Path.Combine(RuntimeRoot, "node.exe");
        internal static readonly string FfmpegExe = Path.Combine(RuntimeRoot, "ffmpeg.exe");
        internal static readonly string FfprobeExe = Path.Combine(RuntimeRoot, "ffprobe.exe");
        internal static readonly string FontFile = Path.Combine(RuntimeRoot, "fonts", "NotoSansCJKsc-VF.ttf");
        internal static readonly string ServerFile = Path.Combine(AppRoot, "server.js");
        internal static readonly string DocumentationFile = Path.Combine(InstallRoot, "docs", "使用说明.html");
        internal static readonly string DataRoot = ResolveDataRoot();
        internal static readonly string SettingsFile = Path.Combine(DataRoot, "settings.ini");
        internal static readonly string PidFile = Path.Combine(DataRoot, "tianping.pid");
        internal static readonly string PasswordFile = Path.Combine(DataRoot, "initial-password.txt");
        internal static readonly string LogRoot = Path.Combine(DataRoot, "logs");
        internal static readonly string ControlLog = Path.Combine(LogRoot, "control.log");

        private static string ResolveDataRoot()
        {
            string overridePath = Environment.GetEnvironmentVariable("TIANPING_DATA_DIR");
            if (!String.IsNullOrEmpty(overridePath))
                return Path.GetFullPath(overridePath);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (String.IsNullOrEmpty(local))
                local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            if (String.IsNullOrEmpty(local))
                local = InstallRoot;
            return Path.Combine(local, "TianpingVideoVerificationData");
        }
    }

    internal sealed class Settings
    {
        private readonly Dictionary<string, string> values =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        internal Settings()
        {
            Directory.CreateDirectory(AppPaths.DataRoot);
            Directory.CreateDirectory(AppPaths.LogRoot);
            if (File.Exists(AppPaths.SettingsFile))
            {
                foreach (string raw in File.ReadAllLines(AppPaths.SettingsFile, Encoding.UTF8))
                {
                    string line = raw.Trim();
                    if (line.Length == 0 || line.StartsWith("#") || line.StartsWith(";"))
                        continue;
                    int split = line.IndexOf('=');
                    if (split <= 0) continue;
                    values[line.Substring(0, split).Trim()] = line.Substring(split + 1).Trim();
                }
            }
        }

        internal int Port
        {
            get
            {
                string value;
                int port;
                return values.TryGetValue("PORT", out value)
                    && Int32.TryParse(value, out port)
                    && port >= 1024 && port <= 65535
                    ? port
                    : 8080;
            }
            set { values["PORT"] = value.ToString(); }
        }

        internal string Host
        {
            get
            {
                string value;
                return values.TryGetValue("HOST", out value) && value.Length > 0
                    ? value
                    : "127.0.0.1";
            }
        }

        internal void Save()
        {
            Directory.CreateDirectory(AppPaths.DataRoot);
            if (!values.ContainsKey("HOST")) values["HOST"] = "127.0.0.1";
            StringBuilder text = new StringBuilder();
            foreach (KeyValuePair<string, string> item in values)
                text.Append(item.Key).Append('=').AppendLine(item.Value);
            File.WriteAllText(AppPaths.SettingsFile, text.ToString(), new UTF8Encoding(false));
        }
    }

    internal static class ServerManager
    {
        private const string ServiceMarker = "\"service\":\"tianping-video-verification\"";
        private static readonly object Sync = new object();

        internal static void Log(string message)
        {
            try
            {
                Directory.CreateDirectory(AppPaths.LogRoot);
                File.AppendAllText(
                    AppPaths.ControlLog,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + Environment.NewLine,
                    new UTF8Encoding(false));
            }
            catch
            {
                // Logging must never prevent the local service from starting.
            }
        }

        internal static StartResult EnsureStarted(Settings settings)
        {
            using (Mutex gate = new Mutex(false, @"Local\TianpingVideoVerificationStart"))
            {
                bool acquired = false;
                try
                {
                    try { acquired = gate.WaitOne(60000); }
                    catch (AbandonedMutexException) { acquired = true; }
                    if (!acquired)
                        throw new TimeoutException("另一个控制面板正在启动或停止服务，请稍后重试。");
                    lock (Sync)
                    {
                        int existing = FindRunningPort(settings);
                        if (existing > 0)
                            return new StartResult(existing, false, null);

                        TryStopStaleProcess();
                        ValidateRuntime();
                        int port = SelectPort(settings.Port, settings.Host);
                        settings.Port = port;
                        settings.Save();
                        StartNode(settings, port);

                        Stopwatch timer = Stopwatch.StartNew();
                        while (timer.Elapsed.TotalSeconds < 45)
                        {
                            if (IsOurService(port))
                                return new StartResult(port, true, null);
                            Process process = GetRecordedProcess();
                            if (process != null && process.HasExited)
                            {
                                int code = process.ExitCode;
                                DeletePidFile();
                                throw new InvalidOperationException(
                                    "服务进程启动后立即退出（代码 " + code + "）。请查看数据目录下的 logs 文件夹。");
                            }
                            Thread.Sleep(350);
                        }
                        throw new TimeoutException(
                            "服务在 45 秒内未完成启动。请检查安全软件是否拦截了 runtime\\node.exe。");
                    }
                }
                finally
                {
                    if (acquired) gate.ReleaseMutex();
                }
            }
        }

        internal static bool Stop()
        {
            using (Mutex gate = new Mutex(false, @"Local\TianpingVideoVerificationStart"))
            {
                bool acquired = false;
                try
                {
                    try { acquired = gate.WaitOne(15000); }
                    catch (AbandonedMutexException) { acquired = true; }
                    if (!acquired)
                        throw new TimeoutException("另一个控制面板正在启动或停止服务，请稍后重试。");
                    lock (Sync)
                    {
                        Process process = GetRecordedProcess();
                        if (process == null)
                        {
                            DeletePidFile();
                            return false;
                        }
                        try
                        {
                            process.Kill();
                            process.WaitForExit(8000);
                        }
                        catch (Exception error)
                        {
                            Log("停止服务失败：" + error.Message);
                            throw;
                        }
                        finally
                        {
                            DeletePidFile();
                        }
                        return true;
                    }
                }
                finally
                {
                    if (acquired) gate.ReleaseMutex();
                }
            }
        }

        internal static bool IsOurService(int port)
        {
            string body = ReadHealth(port);
            return body != null && body.IndexOf(ServiceMarker, StringComparison.Ordinal) >= 0;
        }

        internal static int FindRunningPort(Settings settings)
        {
            int saved = settings.Port;
            if (IsOurService(saved)) return saved;
            if (saved != 8080 && IsOurService(8080)) return 8080;
            for (int port = 18080; port <= 18120; port++)
                if (IsOurService(port)) return port;
            return 0;
        }

        internal static string ReadHealth(int port)
        {
            try
            {
                HttpWebRequest request =
                    (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/healthz");
                request.Proxy = null;
                request.Timeout = 1800;
                request.ReadWriteTimeout = 1800;
                request.KeepAlive = false;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    return reader.ReadToEnd();
            }
            catch (WebException error)
            {
                HttpWebResponse response = error.Response as HttpWebResponse;
                if (response == null) return null;
                using (response)
                using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    return reader.ReadToEnd();
            }
            catch
            {
                return null;
            }
        }

        internal static string ReadInitialPassword()
        {
            try
            {
                if (!File.Exists(AppPaths.PasswordFile)) return null;
                foreach (string line in File.ReadAllLines(AppPaths.PasswordFile, Encoding.UTF8))
                {
                    if (line.IndexOf("初始口令", StringComparison.Ordinal) < 0) continue;
                    int split = line.IndexOf('：');
                    if (split < 0) split = line.IndexOf(':');
                    if (split >= 0) return line.Substring(split + 1).Trim();
                }
            }
            catch (Exception error)
            {
                Log("读取首次口令失败：" + error.Message);
            }
            return null;
        }

        internal static string Diagnostics(Settings settings)
        {
            StringBuilder text = new StringBuilder();
            text.AppendLine("版本：" + GetVersion());
            text.AppendLine("安装目录：" + AppPaths.InstallRoot);
            text.AppendLine("数据目录：" + AppPaths.DataRoot);
            text.AppendLine("配置端口：" + settings.Port);
            text.AppendLine("Node：" + FileStatus(AppPaths.NodeExe));
            text.AppendLine("FFmpeg：" + FileStatus(AppPaths.FfmpegExe));
            text.AppendLine("FFprobe：" + FileStatus(AppPaths.FfprobeExe));
            text.AppendLine("中文字体：" + FileStatus(AppPaths.FontFile));
            int port = FindRunningPort(settings);
            text.AppendLine("服务状态：" + (port > 0 ? "运行于端口 " + port : "未运行"));
            if (port > 0) text.AppendLine("健康检查：" + (ReadHealth(port) ?? "无响应"));
            text.AppendLine("控制日志：" + AppPaths.ControlLog);
            return text.ToString();
        }

        internal static string GetVersion()
        {
            Version version = Assembly.GetExecutingAssembly().GetName().Version;
            return version == null ? "" : version.ToString(3);
        }

        internal static void OpenUrl(string url)
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }

        internal static void OpenFolder(string path)
        {
            Directory.CreateDirectory(path);
            Process.Start(new ProcessStartInfo("explorer.exe", "\"" + path + "\"") { UseShellExecute = true });
        }

        internal static void OpenDocumentation()
        {
            if (File.Exists(AppPaths.DocumentationFile))
                Process.Start(new ProcessStartInfo(AppPaths.DocumentationFile) { UseShellExecute = true });
            else
                MessageBox.Show("使用说明文件缺失，请重新安装本系统。", "提示",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        private static string FileStatus(string path)
        {
            if (!File.Exists(path)) return "缺失 " + path;
            FileInfo info = new FileInfo(path);
            return String.Format("正常（{0:N1} MB）", info.Length / 1024.0 / 1024.0);
        }

        private static void ValidateRuntime()
        {
            string missing = null;
            if (!File.Exists(AppPaths.NodeExe)) missing = AppPaths.NodeExe;
            else if (!File.Exists(AppPaths.ServerFile)) missing = AppPaths.ServerFile;
            else if (!File.Exists(AppPaths.FfmpegExe)) missing = AppPaths.FfmpegExe;
            else if (!File.Exists(AppPaths.FfprobeExe)) missing = AppPaths.FfprobeExe;
            else if (!File.Exists(AppPaths.FontFile)) missing = AppPaths.FontFile;
            if (missing != null)
                throw new FileNotFoundException("安装文件不完整：" + missing);
        }

        private static int SelectPort(int preferred, string host)
        {
            if (CanBind(preferred, host)) return preferred;
            if (preferred != 8080 && CanBind(8080, host)) return 8080;
            for (int port = 18080; port <= 18120; port++)
                if (CanBind(port, host)) return port;
            throw new InvalidOperationException("未找到可用的本机端口，请关闭占用端口的程序后重试。");
        }

        private static bool CanBind(int port, string host)
        {
            TcpListener listener = null;
            try
            {
                IPAddress address = host == "0.0.0.0" ? IPAddress.Any : IPAddress.Loopback;
                listener = new TcpListener(address, port);
                listener.ExclusiveAddressUse = true;
                listener.Start();
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                if (listener != null) listener.Stop();
            }
        }

        private static void StartNode(Settings settings, int port)
        {
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = AppPaths.NodeExe;
            info.Arguments = "\"" + AppPaths.ServerFile + "\"";
            info.WorkingDirectory = AppPaths.AppRoot;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            info.EnvironmentVariables["NODE_ENV"] = "production";
            info.EnvironmentVariables["NODE_NO_WARNINGS"] = "1";
            info.EnvironmentVariables["TZ"] = "Asia/Shanghai";
            info.EnvironmentVariables["HOST"] = settings.Host;
            info.EnvironmentVariables["PORT"] = port.ToString();
            info.EnvironmentVariables["DATA_DIR"] = AppPaths.DataRoot;
            info.EnvironmentVariables["FFMPEG_PATH"] = AppPaths.FfmpegExe;
            info.EnvironmentVariables["FFPROBE_PATH"] = AppPaths.FfprobeExe;
            info.EnvironmentVariables["PDF_FONT_PATH"] = AppPaths.FontFile;
            Process process = Process.Start(info);
            if (process == null) throw new InvalidOperationException("无法启动本地服务进程。");
            File.WriteAllText(AppPaths.PidFile, process.Id.ToString(), new UTF8Encoding(false));
            Log("已启动服务，PID=" + process.Id + "，端口=" + port);
        }

        private static Process GetRecordedProcess()
        {
            try
            {
                if (!File.Exists(AppPaths.PidFile)) return null;
                string text = File.ReadAllText(AppPaths.PidFile).Trim();
                int pid;
                if (!Int32.TryParse(text, out pid)) return null;
                Process process = Process.GetProcessById(pid);
                return process.HasExited ? null : process;
            }
            catch
            {
                return null;
            }
        }

        private static void TryStopStaleProcess()
        {
            Process process = GetRecordedProcess();
            if (process == null)
            {
                DeletePidFile();
                return;
            }
            try
            {
                process.Kill();
                process.WaitForExit(5000);
            }
            catch
            {
                // A new server will still be attempted; failed startup reports details.
            }
            DeletePidFile();
        }

        private static void DeletePidFile()
        {
            try { File.Delete(AppPaths.PidFile); }
            catch { }
        }
    }

    internal sealed class StartResult
    {
        internal readonly int Port;
        internal readonly bool StartedNow;
        internal readonly string Password;

        internal StartResult(int port, bool startedNow, string password)
        {
            Port = port;
            StartedNow = startedNow;
            Password = password;
        }
    }

    internal sealed class ControlForm : Form
    {
        private readonly Settings settings = new Settings();
        private readonly bool firstRun;
        private readonly Label statusLabel;
        private readonly Label addressLabel;
        private readonly TextBox credentialBox;
        private readonly Button openButton;
        private readonly Button stopButton;
        private readonly Button restartButton;
        private readonly System.Windows.Forms.Timer timer;
        private int currentPort;
        private bool busy;

        internal ControlForm(bool firstRun)
        {
            this.firstRun = firstRun;
            Text = "天平校验视频分析系统";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            ClientSize = new Size(760, 520);
            BackColor = Color.FromArgb(247, 249, 252);
            Font = new Font("Microsoft YaHei UI", 10F);
            Icon = SystemIcons.Application;

            Panel header = new Panel();
            header.BackColor = Color.FromArgb(25, 58, 96);
            header.Dock = DockStyle.Top;
            header.Height = 112;
            Controls.Add(header);

            Label title = new Label();
            title.Text = "天平校验视频分析系统";
            title.ForeColor = Color.White;
            title.Font = new Font("Microsoft YaHei UI", 21F, FontStyle.Bold);
            title.AutoSize = true;
            title.Location = new Point(30, 25);
            header.Controls.Add(title);

            Label subtitle = new Label();
            subtitle.Text = "全离线本机运行  ·  视频分析  ·  数据复核";
            subtitle.ForeColor = Color.FromArgb(196, 220, 244);
            subtitle.AutoSize = true;
            subtitle.Location = new Point(33, 72);
            header.Controls.Add(subtitle);

            Label version = new Label();
            version.Text = "版本 V" + ServerManager.GetVersion();
            version.ForeColor = Color.FromArgb(196, 220, 244);
            version.AutoSize = true;
            version.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            version.Location = new Point(638, 80);
            header.Controls.Add(version);

            Label statusTitle = new Label();
            statusTitle.Text = "运行状态";
            statusTitle.Font = new Font("Microsoft YaHei UI", 12F, FontStyle.Bold);
            statusTitle.ForeColor = Color.FromArgb(38, 55, 74);
            statusTitle.AutoSize = true;
            statusTitle.Location = new Point(32, 138);
            Controls.Add(statusTitle);

            statusLabel = new Label();
            statusLabel.Text = "正在检查服务...";
            statusLabel.Font = new Font("Microsoft YaHei UI", 14F, FontStyle.Bold);
            statusLabel.ForeColor = Color.FromArgb(53, 122, 75);
            statusLabel.AutoSize = true;
            statusLabel.Location = new Point(32, 174);
            Controls.Add(statusLabel);

            addressLabel = new Label();
            addressLabel.Text = "本机地址：正在准备";
            addressLabel.ForeColor = Color.FromArgb(80, 94, 109);
            addressLabel.AutoSize = true;
            addressLabel.Location = new Point(34, 211);
            Controls.Add(addressLabel);

            credentialBox = new TextBox();
            credentialBox.Multiline = true;
            credentialBox.ReadOnly = true;
            credentialBox.ScrollBars = ScrollBars.Vertical;
            credentialBox.BackColor = Color.White;
            credentialBox.BorderStyle = BorderStyle.FixedSingle;
            credentialBox.Location = new Point(34, 250);
            credentialBox.Size = new Size(691, 104);
            Controls.Add(credentialBox);

            openButton = MakeButton("打开系统", 34, 382, 148, Color.FromArgb(25, 96, 169), Color.White);
            openButton.Click += delegate { OpenSystem(); };
            Controls.Add(openButton);

            restartButton = MakeButton("重启服务", 194, 382, 148, Color.White, Color.FromArgb(25, 96, 169));
            restartButton.Click += delegate { RestartServer(); };
            Controls.Add(restartButton);

            stopButton = MakeButton("停止服务", 354, 382, 148, Color.White, Color.FromArgb(110, 119, 130));
            stopButton.Click += delegate { StopServer(); };
            Controls.Add(stopButton);

            Button dataButton = MakeButton("数据目录", 514, 382, 100, Color.White, Color.FromArgb(25, 96, 169));
            dataButton.Click += delegate { ServerManager.OpenFolder(AppPaths.DataRoot); };
            Controls.Add(dataButton);

            Button helpButton = MakeButton("使用说明", 626, 382, 100, Color.White, Color.FromArgb(25, 96, 169));
            helpButton.Click += delegate { ServerManager.OpenDocumentation(); };
            Controls.Add(helpButton);

            Button diagnosticButton = MakeButton("运行诊断", 34, 450, 120, Color.White, Color.FromArgb(110, 119, 130));
            diagnosticButton.Click += delegate
            {
                MessageBox.Show(this, ServerManager.Diagnostics(settings), "运行诊断",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
            };
            Controls.Add(diagnosticButton);

            Label hint = new Label();
            hint.Text = "关闭此窗口不会停止系统；数据目录中的内容不会被卸载程序删除。";
            hint.ForeColor = Color.FromArgb(112, 124, 138);
            hint.AutoSize = true;
            hint.Location = new Point(34, 492);
            Controls.Add(hint);

            timer = new System.Windows.Forms.Timer();
            timer.Interval = 3000;
            timer.Tick += delegate { RefreshStatus(); };
            timer.Start();
            Shown += delegate { BeginEnsure(); };
            FormClosing += delegate { timer.Stop(); };
        }

        private static Button MakeButton(string text, int x, int y, int width, Color back, Color fore)
        {
            Button button = new Button();
            button.Text = text;
            button.Location = new Point(x, y);
            button.Size = new Size(width, 46);
            button.BackColor = back;
            button.ForeColor = fore;
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderColor = Color.FromArgb(185, 197, 210);
            button.Cursor = Cursors.Hand;
            return button;
        }

        private void BeginEnsure()
        {
            if (busy) return;
            busy = true;
            SetButtons(false);
            statusLabel.Text = "正在启动本地服务...";
            statusLabel.ForeColor = Color.FromArgb(25, 96, 169);
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    StartResult result = ServerManager.EnsureStarted(settings);
                    BeginInvoke((MethodInvoker)delegate { ShowStarted(result); });
                }
                catch (Exception error)
                {
                    ServerManager.Log("启动失败：" + error);
                    BeginInvoke((MethodInvoker)delegate { ShowError(error); });
                }
            });
        }

        private void ShowStarted(StartResult result)
        {
            busy = false;
            currentPort = result.Port;
            SetButtons(true);
            string body = ServerManager.ReadHealth(result.Port);
            bool healthy = body != null && body.IndexOf("\"status\":\"ok\"", StringComparison.Ordinal) >= 0;
            statusLabel.Text = healthy ? "● 系统正在运行" : "● 服务已启动，但组件需要检查";
            statusLabel.ForeColor = healthy
                ? Color.FromArgb(39, 130, 76)
                : Color.FromArgb(190, 105, 20);
            addressLabel.Text = "本机地址：http://127.0.0.1:" + result.Port + "/";
            UpdateCredentials();
            OpenSystem();
        }

        private void ShowError(Exception error)
        {
            busy = false;
            SetButtons(true);
            statusLabel.Text = "● 系统启动失败";
            statusLabel.ForeColor = Color.FromArgb(181, 55, 55);
            addressLabel.Text = "请点击“运行诊断”查看缺失文件或端口问题";
            credentialBox.Text = error.Message + Environment.NewLine +
                "控制日志：" + AppPaths.ControlLog;
        }

        private void OpenSystem()
        {
            if (currentPort <= 0)
            {
                int port = ServerManager.FindRunningPort(settings);
                if (port > 0) currentPort = port;
            }
            if (currentPort > 0)
                ServerManager.OpenUrl("http://127.0.0.1:" + currentPort + "/");
            else
                BeginEnsure();
        }

        private void RestartServer()
        {
            if (busy) return;
            busy = true;
            SetButtons(false);
            statusLabel.Text = "正在重启服务...";
            statusLabel.ForeColor = Color.FromArgb(25, 96, 169);
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    ServerManager.Stop();
                    Thread.Sleep(500);
                    StartResult result = ServerManager.EnsureStarted(settings);
                    BeginInvoke((MethodInvoker)delegate { ShowStarted(result); });
                }
                catch (Exception error)
                {
                    BeginInvoke((MethodInvoker)delegate { ShowError(error); });
                }
            });
        }

        private void StopServer()
        {
            if (busy) return;
            try
            {
                bool stopped = ServerManager.Stop();
                currentPort = 0;
                statusLabel.Text = stopped ? "● 系统已停止" : "● 系统当前未运行";
                statusLabel.ForeColor = Color.FromArgb(110, 119, 130);
                addressLabel.Text = "点击“打开系统”可重新启动";
                openButton.Text = "打开系统";
            }
            catch (Exception error)
            {
                MessageBox.Show(this, "停止服务失败：" + error.Message, "错误",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void RefreshStatus()
        {
            if (busy) return;
            int port = ServerManager.FindRunningPort(settings);
            if (port > 0)
            {
                currentPort = port;
                string body = ServerManager.ReadHealth(port);
                bool healthy = body != null && body.IndexOf("\"status\":\"ok\"", StringComparison.Ordinal) >= 0;
                statusLabel.Text = healthy ? "● 系统正在运行" : "● 服务已启动，但组件需要检查";
                statusLabel.ForeColor = healthy
                    ? Color.FromArgb(39, 130, 76)
                    : Color.FromArgb(190, 105, 20);
                addressLabel.Text = "本机地址：http://127.0.0.1:" + port + "/";
                openButton.Text = "打开系统";
            }
            else if (currentPort == 0)
            {
                statusLabel.Text = "● 系统当前未运行";
                statusLabel.ForeColor = Color.FromArgb(110, 119, 130);
                addressLabel.Text = "点击“打开系统”启动系统";
                openButton.Text = "启动并打开";
            }
            UpdateCredentials();
        }

        private void UpdateCredentials()
        {
            if (File.Exists(Path.Combine(AppPaths.DataRoot, "tianping.db")))
            {
                credentialBox.Text =
                    "系统已完成初始化。" + Environment.NewLine +
                    "管理员首次登录账号：U000" + Environment.NewLine +
                    "如忘记管理员口令，请联系系统实施人员。";
                return;
            }
            string password = ServerManager.ReadInitialPassword();
            if (password == null)
            {
                credentialBox.Text = "首次启动后将生成一次性口令，请稍候...";
                return;
            }
            credentialBox.Text =
                "首次登录账号（三类用户共用此初始口令）：" + Environment.NewLine +
                "管理员：U000    检验人员：U001 / U002    复核人员：U003" + Environment.NewLine +
                "初始口令：" + password + Environment.NewLine +
                "首次登录后必须立即修改为私人口令。";
        }

        private void SetButtons(bool enabled)
        {
            openButton.Enabled = enabled;
            restartButton.Enabled = enabled;
            stopButton.Enabled = enabled;
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool stop = Array.IndexOf(args, "--stop") >= 0;
            bool autoStart = Array.IndexOf(args, "--autostart") >= 0;
            bool firstRun = Array.IndexOf(args, "--first-run") >= 0;
            Settings settings = new Settings();

            if (stop || autoStart)
            {
                try
                {
                    if (stop) ServerManager.Stop();
                    else ServerManager.EnsureStarted(settings);
                }
                catch (Exception error)
                {
                    ServerManager.Log((stop ? "停止失败：" : "自动启动失败：") + error);
                }
                return;
            }

            Application.Run(new ControlForm(firstRun));
        }
    }
}
