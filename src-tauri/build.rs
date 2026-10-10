fn main() {
    let mut attributes = tauri_build::Attributes::new();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // Tauri's resource compilation embeds the manifest only in app binaries.
        // Unit tests also need Common Controls v6, otherwise the Windows loader
        // can exit with STATUS_ENTRYPOINT_NOT_FOUND before running any test.
        // https://github.com/tauri-apps/tauri/issues/13419
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        let manifest = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        // Use the same manifest for the app and test executables. A tests-only
        // link argument does not cover the lib's unit-test executable.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
    tauri_build::try_build(attributes).expect("failed to build Tauri resources");
    // Native icons are embedded at compile time, independently of Vite assets.
    println!("cargo:rerun-if-changed=icons");
}
