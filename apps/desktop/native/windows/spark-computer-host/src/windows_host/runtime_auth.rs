use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use thiserror::Error;
use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, HWND, STILL_ACTIVE};
use windows::Win32::Security::Cryptography::{
    CERT_QUERY_ENCODING_TYPE, CertCompareCertificateName, PKCS_7_ASN_ENCODING, X509_ASN_ENCODING,
};
use windows::Win32::Security::WinTrust::{
    WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO,
    WTD_CACHE_ONLY_URL_RETRIEVAL, WTD_CHOICE_FILE, WTD_REVOKE_WHOLECHAIN, WTD_SAFER_FLAG,
    WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE, WTHelperGetProvCertFromChain,
    WTHelperGetProvSignerFromChain, WTHelperProvDataFromStateData, WinVerifyTrust,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::core::{PCWSTR, PWSTR};

use crate::parent_auth::{
    ParentIdentity, ParentTrustPolicy, ReleaseBinaryIdentity, ReleaseBinaryTrustPolicy,
    allows_pinned_self_signed_chain_failure,
};

#[derive(Debug, Error)]
pub enum RuntimeAuthorizationError {
    #[error("release signer identity is not embedded")]
    MissingReleaseIdentity,
    #[error("parent process lookup failed")]
    ParentLookupFailed,
    #[error("parent process image failed Authenticode validation")]
    AuthenticodeInvalid,
    #[error("parent signer certificate did not match the release identity")]
    PublisherMismatch,
    #[error("parent trust policy rejected the process")]
    PolicyRejected,
}

pub fn authorize_parent() -> Result<(), RuntimeAuthorizationError> {
    let expected_thumbprint = option_env!("SPARK_WINDOWS_PUBLISHER_THUMBPRINT");
    if expected_thumbprint.is_none() {
        #[cfg(any(debug_assertions, feature = "local-trust"))]
        if std::env::var_os("SPARK_COMPUTER_DEBUG_ALLOW_UNSIGNED_PARENT").as_deref()
            == Some(std::ffi::OsStr::new("1"))
            || std::env::var_os("SPARK_COMPUTER_LOCAL_TRUST").as_deref()
                == Some(std::ffi::OsStr::new("1"))
        {
            return Ok(());
        }
        return Err(RuntimeAuthorizationError::MissingReleaseIdentity);
    }
    let expected_thumbprint = expected_thumbprint.unwrap();
    let host_image =
        std::env::current_exe().map_err(|_| RuntimeAuthorizationError::AuthenticodeInvalid)?;
    let host_signer = verified_signer_thumbprint(&host_image)?;
    let host_publisher_matches = host_signer == normalize_thumbprint(expected_thumbprint);
    ReleaseBinaryTrustPolicy::validate(
        &ReleaseBinaryIdentity {
            publisher_thumbprint: if host_publisher_matches {
                expected_thumbprint.to_owned()
            } else {
                String::new()
            },
            signed: true,
        },
        expected_thumbprint,
    )
    .map_err(|_| RuntimeAuthorizationError::PublisherMismatch)?;
    let process_id_before = parent_process_id()?;
    let parent = ParentProcess::open(process_id_before)?;
    let creation_time_before = parent.creation_time()?;
    let image_path = parent.image_path()?;
    let parent_signer = verified_signer_thumbprint(&image_path)?;
    if parent_signer != normalize_thumbprint(expected_thumbprint) {
        return Err(RuntimeAuthorizationError::PublisherMismatch);
    }
    let process_id_after = parent_process_id()?;
    let creation_time_after = parent.creation_time()?;
    if !parent.is_active()? {
        return Err(RuntimeAuthorizationError::ParentLookupFailed);
    }
    let product_name = image_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_owned();
    ParentTrustPolicy::validate(
        &ParentIdentity {
            product_name,
            publisher_thumbprint: expected_thumbprint.to_owned(),
            image_path: image_path.to_string_lossy().into_owned(),
            signed: true,
            process_id_before,
            process_id_after,
            creation_time_before,
            creation_time_after,
        },
        expected_thumbprint,
    )
    .map_err(|_| RuntimeAuthorizationError::PolicyRejected)
}

fn parent_process_id() -> Result<u32, RuntimeAuthorizationError> {
    let current = unsafe { GetCurrentProcessId() };
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
        .map_err(|_| RuntimeAuthorizationError::ParentLookupFailed)?;
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..PROCESSENTRY32W::default()
    };
    let result = (|| {
        unsafe { Process32FirstW(snapshot, &mut entry) }
            .map_err(|_| RuntimeAuthorizationError::ParentLookupFailed)?;
        loop {
            if entry.th32ProcessID == current {
                return (entry.th32ParentProcessID > 1)
                    .then_some(entry.th32ParentProcessID)
                    .ok_or(RuntimeAuthorizationError::ParentLookupFailed);
            }
            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
        Err(RuntimeAuthorizationError::ParentLookupFailed)
    })();
    let _ = unsafe { CloseHandle(snapshot) };
    result
}

struct ParentProcess {
    handle: HANDLE,
}

impl ParentProcess {
    fn open(process_id: u32) -> Result<Self, RuntimeAuthorizationError> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }
            .map_err(|_| RuntimeAuthorizationError::ParentLookupFailed)?;
        Ok(Self { handle })
    }

    fn image_path(&self) -> Result<PathBuf, RuntimeAuthorizationError> {
        let mut buffer = vec![0_u16; 32_768];
        let mut length = buffer.len() as u32;
        unsafe {
            QueryFullProcessImageNameW(
                self.handle,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut length,
            )
        }
        .map_err(|_| RuntimeAuthorizationError::ParentLookupFailed)?;
        String::from_utf16(&buffer[..length as usize])
            .map(PathBuf::from)
            .map_err(|_| RuntimeAuthorizationError::ParentLookupFailed)
    }

    fn creation_time(&self) -> Result<u64, RuntimeAuthorizationError> {
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        unsafe {
            GetProcessTimes(
                self.handle,
                &mut creation,
                &mut exit,
                &mut kernel,
                &mut user,
            )
        }
        .map_err(|_| RuntimeAuthorizationError::ParentLookupFailed)?;
        Ok((u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime))
    }

    fn is_active(&self) -> Result<bool, RuntimeAuthorizationError> {
        let mut exit_code = 0_u32;
        unsafe { GetExitCodeProcess(self.handle, &mut exit_code) }
            .map_err(|_| RuntimeAuthorizationError::ParentLookupFailed)?;
        Ok(exit_code == STILL_ACTIVE.0 as u32)
    }
}

impl Drop for ParentProcess {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.handle) };
    }
}

fn verified_signer_thumbprint(path: &Path) -> Result<String, RuntimeAuthorizationError> {
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut file_info = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: PCWSTR(wide.as_ptr()),
        hFile: HANDLE::default(),
        pgKnownSubject: std::ptr::null_mut(),
    };
    let mut trust_data = WINTRUST_DATA {
        cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_WHOLECHAIN,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 {
            pFile: &mut file_info,
        },
        dwStateAction: WTD_STATEACTION_VERIFY,
        // Parent authorization is a local startup boundary and must not depend on
        // revocation endpoints being reachable. Keep whole-chain verification, but
        // constrain URL retrieval to the Windows cache; the verified leaf is still
        // pinned to the release publisher SHA-256 thumbprint below.
        dwProvFlags: WTD_SAFER_FLAG | WTD_CACHE_ONLY_URL_RETRIEVAL,
        ..WINTRUST_DATA::default()
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    let status = unsafe {
        WinVerifyTrust(
            HWND::default(),
            &mut action,
            &mut trust_data as *mut WINTRUST_DATA as *mut c_void,
        )
    };
    let result = if status == 0 {
        // Use the leaf certificate from WinVerifyTrust's verified signer chain. Never
        // scan the unauthenticated PKCS#7 certificate bag: an attacker can append a
        // public Spark certificate while signing the executable with another key.
        verified_leaf_thumbprint(trust_data.hWVTStateData, false)
    } else if allows_pinned_self_signed_chain_failure(status) {
        // A self-signed Spark development publisher is cryptographically valid but
        // intentionally absent from another machine's root store. Hosted release
        // runners can also be unable to reach timestamp-chain revocation endpoints.
        // Accept only those chain-availability statuses and a self-issued leaf; its
        // SHA-256 fingerprint is still matched to the embedded release identity.
        verified_leaf_thumbprint(trust_data.hWVTStateData, true)
    } else {
        Err(RuntimeAuthorizationError::AuthenticodeInvalid)
    };
    trust_data.dwStateAction = WTD_STATEACTION_CLOSE;
    let _ = unsafe {
        WinVerifyTrust(
            HWND::default(),
            &mut action,
            &mut trust_data as *mut WINTRUST_DATA as *mut c_void,
        )
    };
    result
}

fn verified_leaf_thumbprint(
    state: HANDLE,
    require_self_signed: bool,
) -> Result<String, RuntimeAuthorizationError> {
    let provider = unsafe { WTHelperProvDataFromStateData(state) };
    if provider.is_null() {
        return Err(RuntimeAuthorizationError::AuthenticodeInvalid);
    }
    let signer = unsafe { WTHelperGetProvSignerFromChain(provider, 0, false, 0) };
    if signer.is_null() {
        return Err(RuntimeAuthorizationError::AuthenticodeInvalid);
    }
    let provider_certificate = unsafe { WTHelperGetProvCertFromChain(signer, 0) };
    if provider_certificate.is_null() {
        return Err(RuntimeAuthorizationError::AuthenticodeInvalid);
    }
    let certificate = unsafe { (*provider_certificate).pCert };
    if certificate.is_null() {
        return Err(RuntimeAuthorizationError::AuthenticodeInvalid);
    }
    let certificate_info = unsafe { (*certificate).pCertInfo };
    if certificate_info.is_null() {
        return Err(RuntimeAuthorizationError::AuthenticodeInvalid);
    }
    if require_self_signed {
        let encoding = CERT_QUERY_ENCODING_TYPE(X509_ASN_ENCODING.0 | PKCS_7_ASN_ENCODING.0);
        let self_signed = unsafe {
            CertCompareCertificateName(
                encoding,
                &raw const (*certificate_info).Subject,
                &raw const (*certificate_info).Issuer,
            )
        };
        if !self_signed.as_bool() {
            return Err(RuntimeAuthorizationError::AuthenticodeInvalid);
        }
    }
    let encoded = unsafe {
        std::slice::from_raw_parts(
            (*certificate).pbCertEncoded,
            (*certificate).cbCertEncoded as usize,
        )
    };
    if encoded.is_empty() {
        return Err(RuntimeAuthorizationError::AuthenticodeInvalid);
    }
    Ok(hex::encode_upper(Sha256::digest(encoded)))
}

fn normalize_thumbprint(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_ascii_whitespace() && *character != ':')
        .flat_map(char::to_uppercase)
        .collect()
}
