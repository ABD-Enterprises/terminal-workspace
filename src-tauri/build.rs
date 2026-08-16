// #170: this was `fn main() {}`, so the tauri-build step declared in Cargo.toml
// never ran. Tauri 2 needs it to generate gen/schemas, to compile and validate
// capabilities/default.json against those schemas, and to feed the context that
// generate_context! reads in main.rs. Without it the capability grants shipped
// unvalidated — a malformed or over-broad permission was a runtime surprise
// rather than a build failure.
fn main() {
    tauri_build::build()
}
