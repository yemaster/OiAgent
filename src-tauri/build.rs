fn main() {
    tauri_build::build();
    // Native icons are embedded at compile time, independently of Vite assets.
    println!("cargo:rerun-if-changed=icons");
}
