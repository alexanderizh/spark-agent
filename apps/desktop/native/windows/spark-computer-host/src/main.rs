#[cfg(windows)]
fn main() -> std::process::ExitCode {
    spark_computer_host::windows_host::run()
}

#[cfg(not(windows))]
fn main() -> std::process::ExitCode {
    eprintln!("[spark-computer-host] Windows Native Host cannot run on this platform");
    std::process::ExitCode::FAILURE
}
