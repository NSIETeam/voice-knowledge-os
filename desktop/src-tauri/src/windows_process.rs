//! Keep the desktop and all descendants in one kernel-managed lifetime.
//! PyInstaller --onefile has both a bootloader and a Python worker process.
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::sync::OnceLock;
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::GetCurrentProcess;

static PROCESS_JOB: OnceLock<OwnedHandle> = OnceLock::new();

pub fn contain_process_tree() {
    PROCESS_JOB.get_or_init(|| {
        // The unnamed handle is not inheritable. Static storage deliberately keeps
        // it open until OS process teardown, including forced termination. Closing
        // it earlier would terminate this process as well as its descendants.
        unsafe {
            let raw = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            assert!(
                !raw.is_null(),
                "CreateJobObjectW: {}",
                std::io::Error::last_os_error()
            );
            let job = OwnedHandle::from_raw_handle(raw);
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            assert_ne!(
                SetInformationJobObject(
                    job.as_raw_handle(),
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const _,
                    std::mem::size_of_val(&limits) as u32,
                ),
                0,
                "SetInformationJobObject: {}",
                std::io::Error::last_os_error()
            );
            assert_ne!(
                AssignProcessToJobObject(job.as_raw_handle(), GetCurrentProcess()),
                0,
                "AssignProcessToJobObject: {}",
                std::io::Error::last_os_error()
            );
            job
        }
    });
}
