using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

// Test-only Windows host launcher. The launcher owns the only job handle.
internal static class B16WindowsJob
{
    private const uint KillOnJobClose = 0x2000;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint CreateNoWindow = 0x08000000;
    private const int UseStdHandles = 0x100;
    private const int HandleList = 0x00020002;
    private const int JobList = 0x0002000D;
    private const int BasicAccountingInformation = 1;
    private const int ExtendedLimitInformation = 9;
    private const uint DuplicateSameAccess = 2;

    public static int Main(string[] args)
    {
        try
        {
            using (SafeFileHandle job = CreateJobObject(IntPtr.Zero, null))
            {
                Require(!job.IsInvalid, "CreateJobObject");
                EnableKillOnClose(job);
                return Run(job, args);
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("B16 Windows job launcher: " + error.Message);
            return 125;
        }
    }

    private static int Run(SafeFileHandle job, string[] args)
    {
        using (SafeFileHandle input = CreateFile("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero))
        {
            Require(!input.IsInvalid, "open NUL");
            using (SafeFileHandle childInput = InheritableCopy(input.DangerousGetHandle()))
            using (SafeFileHandle childOutput = InheritableCopy(GetStdHandle(-11)))
            using (SafeFileHandle childError = InheritableCopy(GetStdHandle(-12)))
            {
                var startup = new StartupInfoEx();
                startup.Info.Size = Marshal.SizeOf(typeof(StartupInfoEx));
                startup.Info.Flags = UseStdHandles;
                startup.Info.StdInput = childInput.DangerousGetHandle();
                startup.Info.StdOutput = childOutput.DangerousGetHandle();
                startup.Info.StdError = childError.DangerousGetHandle();

                ProcessInformation process;
                using (var attributes = new ProcessAttributes())
                {
                    attributes.Set(HandleList, startup.Info.StdInput, startup.Info.StdOutput, startup.Info.StdError);
                    // The kernel associates the host with the job as part of CreateProcess.
                    attributes.Set(JobList, job.DangerousGetHandle());
                    startup.Attributes = attributes.List;
                    var commandLine = new StringBuilder(String.Join(" ", args.Select(QuoteArgument)));
                    Require(CreateProcess(args[0], commandLine, IntPtr.Zero, IntPtr.Zero, true,
                        ExtendedStartupInfoPresent | CreateNoWindow, IntPtr.Zero, null, ref startup, out process),
                        "CreateProcess in job");
                }
                CloseHandle(process.Thread);
                using (var hostExited = new EventWaitHandle(false, EventResetMode.ManualReset))
                using (var stopRequested = new EventWaitHandle(false, EventResetMode.ManualReset))
                {
                    hostExited.SafeWaitHandle = new SafeWaitHandle(process.Process, true);
                    var control = new Thread(delegate()
                    {
                        // A byte requests cleanup. EOF also cleans up if the harness exits.
                        try { Console.OpenStandardInput().ReadByte(); }
                        catch (IOException) { /* A broken control pipe also requests cleanup. */ }
                        try { stopRequested.Set(); }
                        catch (ObjectDisposedException) { /* The host exited and cleanup already finished. */ }
                    });
                    control.IsBackground = true;
                    control.Start();

                    int signaled = WaitHandle.WaitAny(new WaitHandle[] { hostExited, stopRequested });
                    uint code = 0;
                    if (signaled == 0)
                        Require(GetExitCodeProcess(hostExited.SafeWaitHandle, out code), "GetExitCodeProcess");
                    StopJob(job);
                    return unchecked((int)code);
                }
            }
        }
    }

    private static SafeFileHandle InheritableCopy(IntPtr handle)
    {
        IntPtr currentProcess = GetCurrentProcess();
        SafeFileHandle copy;
        Require(DuplicateHandle(currentProcess, handle, currentProcess, out copy, 0, true, DuplicateSameAccess),
            "DuplicateHandle for stdio");
        return copy;
    }

    private static void EnableKillOnClose(SafeFileHandle job)
    {
        var limits = new JobLimits();
        limits.Basic.Flags = KillOnJobClose;
        Require(SetInformationJobObject(job, ExtendedLimitInformation, ref limits,
            Marshal.SizeOf(typeof(JobLimits))), "SetInformationJobObject");
    }

    private static void StopJob(SafeFileHandle job)
    {
        Require(TerminateJobObject(job, 1), "TerminateJobObject");
        var elapsed = Stopwatch.StartNew();
        while (elapsed.ElapsedMilliseconds < 5000)
        {
            JobAccounting accounting;
            Require(QueryInformationJobObject(job, BasicAccountingInformation, out accounting,
                Marshal.SizeOf(typeof(JobAccounting)), IntPtr.Zero), "QueryInformationJobObject");
            if (accounting.ActiveProcesses == 0) return;
            Thread.Sleep(10);
        }
        throw new TimeoutException("Job still has active processes after termination");
    }

    // Quote each argument using the Windows C runtime backslash and quote rules.
    private static string QuoteArgument(string value)
    {
        var quoted = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                slashes++;
                continue;
            }
            quoted.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
            quoted.Append(character);
            slashes = 0;
        }
        return quoted.Append('\\', slashes * 2).Append('"').ToString();
    }

    private static void Require(bool succeeded, string operation)
    {
        if (succeeded) return;
        int code = Marshal.GetLastWin32Error();
        throw new Win32Exception(code, operation + " failed (" + code + "): " + new Win32Exception(code).Message);
    }

    private sealed class ProcessAttributes : IDisposable
    {
        private IntPtr handles;
        private IntPtr job;
        public readonly IntPtr List;

        public ProcessAttributes()
        {
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            List = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(List, 2, 0, ref size))
            {
                int code = Marshal.GetLastWin32Error();
                Marshal.FreeHGlobal(List);
                throw new Win32Exception(code, "InitializeProcThreadAttributeList failed");
            }
        }

        public void Set(int attribute, params IntPtr[] values)
        {
            int length = IntPtr.Size * values.Length;
            IntPtr buffer = Marshal.AllocHGlobal(length);
            if (attribute == HandleList) handles = buffer;
            else job = buffer;
            Marshal.Copy(values, 0, buffer, values.Length);
            Require(UpdateProcThreadAttribute(List, 0, new IntPtr(attribute), buffer, new IntPtr(length),
                IntPtr.Zero, IntPtr.Zero), "UpdateProcThreadAttribute");
        }

        public void Dispose()
        {
            DeleteProcThreadAttributeList(List);
            Marshal.FreeHGlobal(List);
            Marshal.FreeHGlobal(handles);
            Marshal.FreeHGlobal(job);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfo
    {
        public int Size;
        public IntPtr Reserved, Desktop, Title;
        public int X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public short Show, ReservedLength;
        public IntPtr ReservedBytes, StdInput, StdOutput, StdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx
    {
        public StartupInfo Info;
        public IntPtr Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Process, Thread;
        public uint ProcessId, ThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobLimits
    {
        public BasicLimits Basic;
        public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemory, PeakJobMemory;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobAccounting
    {
        public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern SafeFileHandle CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(SafeFileHandle job, int type, ref JobLimits info, int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(SafeFileHandle job, int type, out JobAccounting info, int size, IntPtr returned);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(SafeFileHandle job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value,
        IntPtr size, IntPtr previous, IntPtr returnedSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr list);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory,
        ref StartupInfoEx startup, out ProcessInformation process);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr attributes,
        uint creation, uint flags, IntPtr template);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int handle);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess,
        out SafeFileHandle target, uint access, bool inherit, uint options);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(SafeWaitHandle process, out uint code);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
}
