use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

const CREDENTIAL_ERROR: &str = "friends.error.credentialsUnavailable";

// Deliberately no Debug: credentials must not become logs or diagnostics.
#[derive(Serialize, Deserialize)]
pub(super) struct Credential {
    pub endpoint: String,
    pub profile_id: Option<String>,
    pub token: String,
    /// The recovery code, kept so it can be shown again (recovery.rs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<String>,
}

impl Drop for Credential {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.token.zeroize();
        if let Some(code) = &mut self.recovery {
            code.zeroize();
        }
    }
}

pub(super) struct CredentialStore {
    directory: PathBuf,
}

impl CredentialStore {
    pub fn new(data: &Path) -> Self {
        Self {
            directory: data.join("Friends"),
        }
    }

    fn path(&self, endpoint: &str) -> PathBuf {
        self.directory
            .join(format!("{:x}.dpapi", Sha256::digest(endpoint.as_bytes())))
    }

    pub async fn load(&self, endpoint: &str) -> Result<Option<Credential>, String> {
        let bytes = match tokio::fs::read(self.path(endpoint)).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if self.path(endpoint).with_extension("profile").exists() {
                    return Err(CREDENTIAL_ERROR.into());
                }
                return Ok(None);
            }
            Err(_) => return Err(CREDENTIAL_ERROR.into()),
        };
        if bytes.is_empty() || bytes.len() > 16_384 {
            return Err(CREDENTIAL_ERROR.into());
        }
        let plain = decrypt(&bytes)?;
        let credential: Credential =
            serde_json::from_slice(&plain).map_err(|_| CREDENTIAL_ERROR)?;
        if credential.endpoint != endpoint
            || credential.profile_id.as_ref().is_some_and(String::is_empty)
            || credential.token.len() < 32
            || credential.token.len() > 512
            || !credential
                .token
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
        {
            return Err(CREDENTIAL_ERROR.into());
        }
        Ok(Some(credential))
    }

    pub async fn save(&self, credential: &Credential) -> Result<(), String> {
        tokio::fs::create_dir_all(&self.directory)
            .await
            .map_err(|_| CREDENTIAL_ERROR)?;
        let plain = Zeroizing::new(serde_json::to_vec(credential).map_err(|_| CREDENTIAL_ERROR)?);
        let encrypted = encrypt(&plain)?;
        let target = self.path(&credential.endpoint);
        let temporary = target.with_extension("pending");
        tokio::fs::write(&temporary, encrypted)
            .await
            .map_err(|_| CREDENTIAL_ERROR)?;
        let file = tokio::fs::OpenOptions::new()
            .write(true)
            .open(&temporary)
            .await
            .map_err(|_| CREDENTIAL_ERROR)?;
        file.sync_all().await.map_err(|_| CREDENTIAL_ERROR)?;
        drop(file);
        tokio::fs::rename(&temporary, &target)
            .await
            .map_err(|_| CREDENTIAL_ERROR)?;
        // This non-secret marker prevents silently replacing a profile if its credential is lost.
        tokio::fs::write(
            target.with_extension("profile"),
            b"Luftify social identity v1",
        )
        .await
        .map_err(|_| CREDENTIAL_ERROR)?;
        Ok(())
    }
}

#[cfg(windows)]
fn crypt(bytes: &[u8], protect: bool) -> Result<Zeroizing<Vec<u8>>, String> {
    use windows::{
        Win32::{
            Foundation::{HLOCAL, LocalFree},
            Security::Cryptography::{
                CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
            },
        },
        core::PCWSTR,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let result = unsafe {
        if protect {
            CryptProtectData(
                &input,
                PCWSTR::null(),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    result.map_err(|_| CREDENTIAL_ERROR)?;
    let plain = Zeroizing::new(
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec(),
    );
    if !protect {
        unsafe {
            std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
        }
    }
    unsafe {
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
    }
    Ok(plain)
}

#[cfg(windows)]
fn encrypt(bytes: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    crypt(bytes, true)
}
#[cfg(windows)]
fn decrypt(bytes: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    crypt(bytes, false)
}
#[cfg(not(windows))]
fn encrypt(_: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    Err(CREDENTIAL_ERROR.into())
}
#[cfg(not(windows))]
fn decrypt(_: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    Err(CREDENTIAL_ERROR.into())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn protects_credentials_and_rejects_corrupt_data() {
        let secret = b"private-token-never-written-as-plaintext";
        let encrypted = encrypt(secret).unwrap();
        assert!(!encrypted.windows(secret.len()).any(|part| part == secret));
        assert_eq!(decrypt(&encrypted).unwrap().as_slice(), secret);
        assert!(decrypt(b"invalid").is_err());
    }

    #[tokio::test]
    async fn pending_identity_survives_retries_and_servers_cannot_share_credentials() {
        let data =
            std::env::temp_dir().join(format!("luftify-friends-test-{}", uuid::Uuid::new_v4()));
        let store = CredentialStore::new(&data);
        let endpoint = "https://one.example/social/v1/";
        let mut credential = Credential {
            endpoint: endpoint.into(),
            profile_id: None,
            token: "a".repeat(64),
            recovery: None,
        };
        store.save(&credential).await.unwrap();
        let pending = store.load(endpoint).await.unwrap().unwrap();
        assert!(pending.profile_id.is_none());
        assert_eq!(pending.token, credential.token);
        assert!(
            store
                .load("https://two.example/social/v1/")
                .await
                .unwrap()
                .is_none()
        );
        credential.profile_id = Some("profile-one".into());
        store.save(&credential).await.unwrap();
        assert_eq!(
            store
                .load(endpoint)
                .await
                .unwrap()
                .unwrap()
                .profile_id
                .as_deref(),
            Some("profile-one")
        );
        tokio::fs::write(store.path(endpoint), b"corrupt")
            .await
            .unwrap();
        assert!(store.load(endpoint).await.is_err());
        tokio::fs::remove_file(store.path(endpoint)).await.unwrap();
        assert!(store.load(endpoint).await.is_err());
        tokio::fs::remove_file(store.path(endpoint).with_extension("profile"))
            .await
            .unwrap();
        tokio::fs::remove_dir(&store.directory).await.unwrap();
        tokio::fs::remove_dir(data).await.unwrap();
    }
}
