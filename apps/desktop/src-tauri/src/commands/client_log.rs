//! Errors that happen only in the page land in the app log (and so in
//! problem reports). Short and without control characters.

#[tauri::command]
pub fn client_log(scope: String, message: String) {
    let scope: String = scope.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '.').take(40).collect();
    let message: String = message.chars().filter(|c| !c.is_control()).take(300).collect();
    tracing::warn!(target: "client", scope = %scope, message = %message, "page error");
}
