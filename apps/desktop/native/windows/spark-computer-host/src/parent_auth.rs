use thiserror::Error;

pub const EXPECTED_PARENT_PRODUCT_NAME: &str = "SparkWork";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParentIdentity {
    pub product_name: String,
    pub publisher_thumbprint: String,
    pub image_path: String,
    pub signed: bool,
    pub process_id_before: u32,
    pub process_id_after: u32,
    pub creation_time_before: u64,
    pub creation_time_after: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReleaseBinaryIdentity {
    pub publisher_thumbprint: String,
    pub signed: bool,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum ParentTrustError {
    #[error("parent process changed during authorization")]
    ProcessChanged,
    #[error("parent image is not Authenticode signed")]
    Unsigned,
    #[error("unexpected parent product")]
    UnexpectedProduct,
    #[error("publisher thumbprint mismatch")]
    PublisherMismatch,
    #[error("invalid parent image path")]
    InvalidImagePath,
}

pub struct ParentTrustPolicy;

pub struct ReleaseBinaryTrustPolicy;

impl ReleaseBinaryTrustPolicy {
    pub fn validate(
        identity: &ReleaseBinaryIdentity,
        expected_publisher_thumbprint: &str,
    ) -> Result<(), ParentTrustError> {
        if !identity.signed {
            return Err(ParentTrustError::Unsigned);
        }
        let expected = normalize_thumbprint(expected_publisher_thumbprint);
        if expected.len() != 64 || normalize_thumbprint(&identity.publisher_thumbprint) != expected
        {
            return Err(ParentTrustError::PublisherMismatch);
        }
        Ok(())
    }
}

impl ParentTrustPolicy {
    pub fn validate(
        identity: &ParentIdentity,
        expected_publisher_thumbprint: &str,
    ) -> Result<(), ParentTrustError> {
        if identity.process_id_before == 0
            || identity.process_id_before != identity.process_id_after
            || identity.creation_time_before == 0
            || identity.creation_time_before != identity.creation_time_after
        {
            return Err(ParentTrustError::ProcessChanged);
        }
        if !identity.signed {
            return Err(ParentTrustError::Unsigned);
        }
        if identity.product_name != EXPECTED_PARENT_PRODUCT_NAME {
            return Err(ParentTrustError::UnexpectedProduct);
        }
        let expected = normalize_thumbprint(expected_publisher_thumbprint);
        if expected.len() != 64 || normalize_thumbprint(&identity.publisher_thumbprint) != expected
        {
            return Err(ParentTrustError::PublisherMismatch);
        }
        if identity.image_path.trim().is_empty()
            || !identity
                .image_path
                .to_ascii_lowercase()
                .ends_with("sparkwork.exe")
        {
            return Err(ParentTrustError::InvalidImagePath);
        }
        Ok(())
    }
}

fn normalize_thumbprint(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_ascii_whitespace() && *character != ':')
        .flat_map(char::to_uppercase)
        .collect()
}
