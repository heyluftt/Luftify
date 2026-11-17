use std::{
    collections::VecDeque,
    future::Future,
    io,
    net::SocketAddr,
    time::Duration,
};

use futures_util::{StreamExt, stream::FuturesUnordered};
use tokio::net::TcpStream;
use url::Url;

use crate::proxytunnel;

/// Luftify: how long one address may stay unanswered before the next one is
/// tried alongside it (Happy Eyeballs, RFC 8305).
const ATTEMPT_DELAY: Duration = Duration::from_millis(250);

pub async fn connect(host: &str, port: u16, proxy: Option<&Url>) -> io::Result<TcpStream> {
    let socket = if let Some(proxy_url) = proxy {
        info!("Using proxy \"{proxy_url}\"");

        let socket_addr = proxy_url.socket_addrs(|| None).and_then(|addrs| {
            addrs.into_iter().next().ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    "Can't resolve proxy server address",
                )
            })
        })?;
        let socket = TcpStream::connect(&socket_addr).await?;

        proxytunnel::proxy_connect(socket, host, &port.to_string()).await?
    } else {
        // Luftify: upstream connected to the first address only. Where that
        // one is unreachable (IPv6 outside a VPN tunnel, broken IPv6 at home)
        // the dealer and access point hung until their deadline, although
        // the other address family worked (see LUFTIFY.md).
        let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port)).await?.collect();
        if addrs.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Can't resolve access point address",
            ));
        }
        connect_staggered(interleave_families(addrs), TcpStream::connect).await?
    };
    Ok(socket)
}

/// Starts with the first address and adds the next one whenever the pending
/// ones stay silent for `ATTEMPT_DELAY` or all of them failed; the first
/// connection wins, the others are dropped.
async fn connect_staggered<F, Fut, T>(addrs: Vec<SocketAddr>, connect: F) -> io::Result<T>
where
    F: Fn(SocketAddr) -> Fut,
    Fut: Future<Output = io::Result<T>>,
{
    let mut waiting = addrs.into_iter();
    let mut attempts = FuturesUnordered::new();
    let mut last_error = None;
    loop {
        if attempts.is_empty() {
            match waiting.next() {
                Some(addr) => attempts.push(connect(addr)),
                None => break,
            }
        }
        tokio::select! {
            Some(result) = attempts.next() => match result {
                Ok(stream) => return Ok(stream),
                Err(e) => {
                    debug!("Connection attempt failed: {e}");
                    last_error = Some(e);
                }
            },
            _ = tokio::time::sleep(ATTEMPT_DELAY), if waiting.len() > 0 => {
                if let Some(addr) = waiting.next() {
                    attempts.push(connect(addr));
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| io::Error::new(io::ErrorKind::NotFound, "No address to connect to")))
}

/// Alternates the address families, starting with the one the system prefers.
fn interleave_families(addrs: Vec<SocketAddr>) -> Vec<SocketAddr> {
    let Some(prefers_v6) = addrs.first().map(SocketAddr::is_ipv6) else {
        return addrs;
    };
    let (mut preferred, mut other): (VecDeque<_>, VecDeque<_>) =
        addrs.into_iter().partition(|addr| addr.is_ipv6() == prefers_v6);
    let mut ordered = Vec::with_capacity(preferred.len() + other.len());
    while !preferred.is_empty() || !other.is_empty() {
        ordered.extend(preferred.pop_front());
        ordered.extend(other.pop_front());
    }
    ordered
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use super::*;

    fn v6(last: u16) -> SocketAddr {
        SocketAddr::from(([0x2600, 0, 0, 0, 0, 0, 0, last], 443))
    }

    fn v4(last: u8) -> SocketAddr {
        SocketAddr::from(([35, 186, 224, last], 443))
    }

    #[test]
    fn families_alternate_from_the_preferred_one() {
        assert_eq!(interleave_families(vec![v6(1), v6(2), v4(1)]), vec![v6(1), v4(1), v6(2)]);
        assert_eq!(interleave_families(vec![v4(1), v6(1)]), vec![v4(1), v6(1)]);
    }

    #[tokio::test]
    async fn a_silent_address_does_not_block_the_next_one() {
        let started = Instant::now();
        let reached = connect_staggered(vec![v6(1), v4(1)], |addr| async move {
            if addr.is_ipv6() {
                std::future::pending::<io::Result<SocketAddr>>().await
            } else {
                Ok(addr)
            }
        })
        .await;
        assert_eq!(reached.unwrap(), v4(1));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn the_last_error_is_returned_when_every_address_fails() {
        let result = connect_staggered(vec![v6(1), v4(1)], |addr| async move {
            Err::<(), _>(io::Error::other(addr.to_string()))
        })
        .await;
        assert_eq!(result.unwrap_err().to_string(), v4(1).to_string());
    }
}
