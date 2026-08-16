// #170: this was `fn main() {}`, so the tauri-build step declared in Cargo.toml
// never ran. Tauri 2 needs it to generate gen/schemas, to compile and validate
// capabilities/default.json against those schemas, and to feed the context that
// generate_context! reads in main.rs.
//
// What this does and does not catch: it rejects malformed capability structures
// and permission identifiers that do not exist, and it checks the tauri crate
// features against the tauri.conf.json allowlist. It does NOT judge breadth — a
// valid but over-broad grant still compiles clean. Narrowing the grants is #236.
fn main() {
    tauri_build::build()
}
