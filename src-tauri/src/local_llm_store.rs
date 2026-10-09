use crate::integrations::{atomic_write, secure_path};
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAGIC: &[u8; 8] = b"OIALLM01";
const LIMIT: usize = 1024 * 1024;

fn read_file(path: &Path, limit: usize) -> Result<Option<Vec<u8>>, String> {
    secure_path(path).map_err(|_| "本地密钥路径不能包含符号链接")?;
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取本地 LLM 配置，请检查应用数据目录权限".into()),
    };
    if !file
        .metadata()
        .map_err(|_| "无法读取本地配置属性")?
        .is_file()
    {
        return Err("本地 LLM 配置路径不是文件".into());
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取本地 LLM 配置失败")?;
    if bytes.len() > limit {
        return Err("本地 LLM 配置大小异常".into());
    }
    Ok(Some(bytes))
}

fn directory(app_dir: &Path) -> Result<PathBuf, String> {
    let path = app_dir.join("secrets");
    secure_path(&path).map_err(|_| "本地密钥路径不能包含符号链接")?;
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .recursive(true)
        .create(&path)
        .map_err(|_| "无法创建本地密钥目录")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法设置本地密钥目录权限")?;
    }
    Ok(path)
}

fn encryption_key(app_dir: &Path, create: bool) -> Result<aead::LessSafeKey, String> {
    let path = app_dir.join("secrets/llm.key");
    let bytes = match read_file(&path, 32)? {
        Some(bytes) => bytes,
        None if create => {
            let dir = directory(app_dir)?;
            let mut key = [0_u8; 32];
            SystemRandom::new()
                .fill(&mut key)
                .map_err(|_| "无法生成本地加密密钥")?;
            // Publish a complete key atomically; a second instance must use the same key.
            let mut temp =
                tempfile::NamedTempFile::new_in(&dir).map_err(|_| "无法保存本地加密密钥")?;
            temp.write_all(&key).map_err(|_| "无法保存本地加密密钥")?;
            temp.as_file()
                .sync_all()
                .map_err(|_| "无法保存本地加密密钥")?;
            match temp.persist_noclobber(&path) {
                Ok(_) => key.to_vec(),
                Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => {
                    read_file(&path, 32)?.ok_or("本地加密密钥不存在")?
                }
                Err(_) => return Err("无法保存本地加密密钥".into()),
            }
        }
        None => return Err("本地加密密钥丢失，请重新填写并保存 LLM 配置".into()),
    };
    let unbound = aead::UnboundKey::new(&aead::AES_256_GCM, &bytes)
        .map_err(|_| "本地加密密钥损坏，请备份并移除 secrets 目录后重新配置")?;
    Ok(aead::LessSafeKey::new(unbound))
}

pub fn load(app_dir: &Path) -> Result<Option<Vec<u8>>, String> {
    let Some(bytes) = read_file(&app_dir.join("secrets/llm.enc"), LIMIT + 36)? else {
        return Ok(None);
    };
    if bytes.len() < 36 || &bytes[..8] != MAGIC {
        return Err("本地 LLM 配置损坏，请重新填写并保存".into());
    }
    let key = encryption_key(app_dir, false)?;
    let nonce = aead::Nonce::try_assume_unique_for_key(&bytes[8..20])
        .map_err(|_| "本地 LLM 配置格式无效")?;
    let mut ciphertext = bytes[20..].to_vec();
    let plaintext = key
        .open_in_place(nonce, aead::Aad::from(MAGIC), &mut ciphertext)
        .map_err(|_| "本地 LLM 配置校验失败，请重新填写并保存")?;
    Ok(Some(plaintext.to_vec()))
}

pub fn save(app_dir: &Path, plaintext: &[u8]) -> Result<(), String> {
    if plaintext.len() > LIMIT {
        return Err("LLM 配置过大".into());
    }
    let dir = directory(app_dir)?;
    let key = encryption_key(app_dir, true)?;
    let mut nonce_bytes = [0_u8; 12];
    SystemRandom::new()
        .fill(&mut nonce_bytes)
        .map_err(|_| "无法生成加密随机数")?;
    let mut ciphertext = plaintext.to_vec();
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce_bytes),
        aead::Aad::from(MAGIC),
        &mut ciphertext,
    )
    .map_err(|_| "LLM 配置加密失败")?;
    let mut bytes = MAGIC.to_vec();
    bytes.extend_from_slice(&nonce_bytes);
    bytes.extend(ciphertext);
    // NamedTempFile is owner-only on Unix; only ciphertext is ever written to disk.
    atomic_write(&dir.join("llm.enc"), &bytes)
        .map_err(|_| "无法保存本地 LLM 配置，原配置未更改".into())
}

pub fn clear(app_dir: &Path) -> Result<(), String> {
    let path = app_dir.join("secrets/llm.enc");
    secure_path(&path).map_err(|_| "本地密钥路径不能包含符号链接")?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("无法移除本地 LLM 配置，请检查应用数据目录权限".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypts_with_unique_nonces_and_rejects_tampering() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().canonicalize().unwrap();
        assert!(load(&dir).unwrap().is_none());
        save(&dir, b"test-only-secret").unwrap();
        let first = fs::read(dir.join("secrets/llm.enc")).unwrap();
        assert!(!first.windows(16).any(|w| w == b"test-only-secret"));
        assert_eq!(load(&dir).unwrap().unwrap(), b"test-only-secret");
        save(&dir, b"test-only-secret").unwrap();
        let mut second = fs::read(dir.join("secrets/llm.enc")).unwrap();
        assert_ne!(&first[8..20], &second[8..20]);
        second[20] ^= 1;
        fs::write(dir.join("secrets/llm.enc"), second).unwrap();
        assert!(load(&dir).unwrap_err().contains("校验失败"));
        clear(&dir).unwrap();
        assert!(load(&dir).unwrap().is_none());
    }
    #[cfg(unix)]
    #[test]
    fn files_are_private_and_symlink_targets_are_never_changed() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().canonicalize().unwrap();
        save(&dir, b"secret").unwrap();
        for file in ["secrets/llm.key", "secrets/llm.enc"] {
            assert_eq!(
                fs::metadata(dir.join(file)).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert_eq!(
            fs::metadata(dir.join("secrets"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        fs::remove_file(dir.join("secrets/llm.enc")).unwrap();
        let target = dir.join("external");
        fs::write(&target, b"untouched").unwrap();
        symlink(&target, dir.join("secrets/llm.enc")).unwrap();
        assert!(save(&dir, b"new-secret").is_err());
        assert!(load(&dir).is_err());
        assert_eq!(fs::read(target).unwrap(), b"untouched");
    }
}
