// sqlx::migrate! embeds the migrations at compile time; without this a new
// migration file alone would not trigger a rebuild and would be missing.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
