use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=LUFTIFY_SETUP_PAYLOAD");
    println!("cargo:rerun-if-env-changed=LUFTIFY_SETUP_VERSION");
    let payload = env::var("LUFTIFY_SETUP_PAYLOAD").unwrap_or_default();
    let code = if payload.is_empty() {
        "pub static PAYLOAD: &[u8] = &[];".to_string()
    } else {
        println!("cargo:rerun-if-changed={payload}");
        format!("pub static PAYLOAD: &[u8] = include_bytes!(r\"{payload}\");")
    };
    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("payload.rs");
    fs::write(out, code).expect("payload.rs");
    println!(
        "cargo:rustc-env=LUFTIFY_SETUP_VERSION={}",
        env::var("LUFTIFY_SETUP_VERSION").unwrap_or_default()
    );
    tauri_build::build();
}
