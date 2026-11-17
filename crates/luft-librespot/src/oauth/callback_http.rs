//! The loopback HTTP boundary, kept independently testable from Spotify/browser login.
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

pub(super) async fn receive(
    listener: &TcpListener,
    path: &str,
    state: &str,
) -> Result<String, String> {
    loop {
        let (mut socket, _) = listener
            .accept()
            .await
            .map_err(|_| "Login-Antwort konnte nicht empfangen werden.")?;
        let headers = tokio::time::timeout(Duration::from_secs(3), read_headers(&mut socket)).await;
        let Ok(Ok(Some(headers))) = headers else {
            continue;
        };
        let first = headers.lines().next().unwrap_or("");
        let target = first
            .strip_prefix("GET ")
            .and_then(|line| line.split_whitespace().next());
        let result = target.and_then(|target| super::callback(target, path, state));
        let accepted = result.is_some();
        let body = if accepted {
            "Luftify: Antwort empfangen. Bitte zur App zurueckkehren."
        } else {
            "Ungueltige Login-Antwort."
        };
        let response = format!(
            "HTTP/1.1 {}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
            if accepted {
                "200 OK"
            } else {
                "400 Bad Request"
            },
            body.len(),
            body
        );
        let _ = tokio::time::timeout(
            Duration::from_secs(2),
            socket.write_all(response.as_bytes()),
        )
        .await;
        if let Some(result) = result {
            return result;
        }
    }
}

async fn read_headers(socket: &mut TcpStream) -> std::io::Result<Option<String>> {
    const LIMIT: usize = 8192;
    let mut bytes = Vec::new();
    let mut chunk = [0; 1024];
    while bytes.len() < LIMIT {
        let remaining = chunk.len().min(LIMIT - bytes.len());
        let count = socket.read(&mut chunk[..remaining]).await?;
        if count == 0 {
            return Ok(None);
        }
        bytes.extend_from_slice(&chunk[..count]);
        if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            return Ok(String::from_utf8(bytes).ok());
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn oauth_http_accepts_browser_crlf_without_waiting_for_connection_close() {
        tokio::time::timeout(Duration::from_secs(5), async {
            let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
            let address = listener.local_addr().unwrap();
            let server =
                tokio::spawn(async move { receive(&listener, "/login", "expected").await });
            // An unrelated request must not consume the listener.
            let mut wrong = TcpStream::connect(address).await.unwrap();
            wrong
                .write_all(b"GET /login?state=wrong&code=no HTTP/1.1\r\nHost: localhost\r\n\r\n")
                .await
                .unwrap();
            let mut rejected = Vec::new();
            wrong.read_to_end(&mut rejected).await.unwrap();
            assert!(rejected.starts_with(b"HTTP/1.1 400 Bad Request\r\n"));
            let mut browser = TcpStream::connect(address).await.unwrap();
            browser
                .write_all(b"GET /login?state=expected&code=ok HTTP/1.1\r\nHost: localhost\r\n")
                .await
                .unwrap();
            browser.write_all(b"\r\n").await.unwrap();
            // The browser keeps its write side open until a response arrives.
            let mut response = Vec::new();
            browser.read_to_end(&mut response).await.unwrap();
            assert!(response.starts_with(b"HTTP/1.1 200 OK\r\n"));
            assert!(response.windows(4).any(|part| part == b"\r\n\r\n"));
            assert_eq!(server.await.unwrap().unwrap(), "ok");
        })
        .await
        .expect("The HTTP callback must respond without waiting for EOF");
    }
}
