//! Connessione diretta tra i PC, senza passare dal tunnel.
//!
//! Il tunnel (bore.pub) è negli Stati Uniti: ogni pacchetto fa Europa → USA → Europa e il gioco
//! va a scatti (colpi in ritardo, chunk che arrivano piano). Chi apre il mondo pubblica quindi
//! anche gli indirizzi diretti: quello in rete locale e, se il router lo permette (UPnP),
//! quello pubblico con la porta aperta in automatico. Chi entra prova questi indirizzi con una
//! connessione veloce e usa il tunnel solo se nessuno risponde.

use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket},
    sync::Mutex,
    time::{Duration, Instant},
};

use igd_next::{aio::tokio::Tokio, aio::Gateway, PortMappingProtocol, SearchOptions};

const LEASE_SECS: u32 = 2 * 3600;
const RENEW_EVERY: Duration = Duration::from_secs(3600);
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);
const PROBE_CACHE: Duration = Duration::from_secs(45);

/// IPv4 di questo PC verso `target` (nessun pacchetto viene inviato: serve solo il routing).
fn local_ipv4_towards(target: SocketAddr) -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect(target).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

/// Indirizzo in rete locale per questa porta (per gli amici sulla stessa rete).
pub fn lan_candidate(port: u16) -> Option<String> {
    local_ipv4_towards("1.1.1.1:80".parse().unwrap()).map(|ip| format!("{ip}:{port}"))
}

/// IPv4 raggiungibile da internet (non privato, non CGNAT 100.64/10).
fn is_public(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    !(ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() || (a == 100 && (64..128).contains(&b)))
}

/// Porta aperta sul router con UPnP: tolta quando il mondo viene chiuso.
pub struct Mapping {
    gateway: Gateway<Tokio>,
    pub external_port: u16,
    pub address: String,
    renew: tokio::task::JoinHandle<()>,
}

/// Apre la porta sul router (UPnP). `None` se il router non lo supporta o se il PC è dietro
/// un NAT del provider (CGNAT): in quel caso resta la rete locale o il tunnel.
pub async fn open_mapping(port: u16) -> Option<Mapping> {
    let options = SearchOptions { timeout: Some(Duration::from_secs(3)), ..Default::default() };
    let gateway = igd_next::aio::tokio::search_gateway(options).await.ok()?;
    let IpAddr::V4(external) = gateway.get_external_ip().await.ok()? else { return None };
    if !is_public(external) {
        return None;
    }
    let local = SocketAddr::new(IpAddr::V4(local_ipv4_towards(gateway.addr)?), port);
    let description = "Nexus Launcher (mondo aperto agli amici)";
    let external_port = match gateway.add_port(PortMappingProtocol::TCP, port, local, LEASE_SECS, description).await {
        Ok(()) => port,
        // alcuni router accettano solo mappature permanenti o scelgono loro la porta
        Err(_) => match gateway.add_port(PortMappingProtocol::TCP, port, local, 0, description).await {
            Ok(()) => port,
            Err(_) => gateway.add_any_port(PortMappingProtocol::TCP, local, LEASE_SECS, description).await.ok()?,
        },
    };
    let renew = {
        let gateway = gateway.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(RENEW_EVERY).await;
                let _ = gateway.add_port(PortMappingProtocol::TCP, external_port, local, LEASE_SECS, description).await;
            }
        })
    };
    Some(Mapping { gateway, external_port, address: format!("{external}:{external_port}"), renew })
}

pub async fn close_mapping(mapping: Mapping) {
    mapping.renew.abort();
    let _ = mapping.gateway.remove_port(PortMappingProtocol::TCP, mapping.external_port).await;
}

/// Risultati recenti delle prove (indirizzi diretti → il primo raggiungibile).
static PROBES: Mutex<Option<HashMap<String, (Instant, Option<String>)>>> = Mutex::new(None);

async fn reachable(address: &str) -> bool {
    matches!(tokio::time::timeout(PROBE_TIMEOUT, tokio::net::TcpStream::connect(address)).await, Ok(Ok(_)))
}

/// Il primo indirizzo diretto che risponde (in ordine di preferenza), provandoli tutti insieme.
/// `direct` è la lista separata da spazi pubblicata da chi ospita.
pub async fn best(direct: &str) -> Option<String> {
    if direct.trim().is_empty() {
        return None;
    }
    if let Some((at, result)) = PROBES.lock().unwrap().get_or_insert_with(HashMap::new).get(direct) {
        if at.elapsed() < PROBE_CACHE {
            return result.clone();
        }
    }
    let candidates: Vec<&str> = direct.split_whitespace().take(4).collect();
    let results = futures::future::join_all(candidates.iter().map(|a| reachable(a))).await;
    let result = candidates.iter().zip(results).find(|(_, ok)| *ok).map(|(a, _)| a.to_string());
    PROBES.lock().unwrap().get_or_insert_with(HashMap::new).insert(direct.to_string(), (Instant::now(), result.clone()));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_addresses() {
        assert!(is_public("93.40.1.2".parse().unwrap()));
        assert!(!is_public("192.168.1.1".parse().unwrap()));
        assert!(!is_public("10.0.0.1".parse().unwrap()));
        assert!(!is_public("100.72.3.4".parse().unwrap()));
    }

    /// Prova UPnP sul router di questo PC: `cargo test upnp -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn upnp() {
        println!("lan: {:?}", lan_candidate(25565));
        let g = igd_next::aio::tokio::search_gateway(SearchOptions { timeout: Some(Duration::from_secs(5)), ..Default::default() }).await;
        match &g {
            Ok(g) => println!("gateway: {} ip {:?}", g.addr, g.get_external_ip().await),
            Err(e) => println!("gateway: {e}"),
        }
        match open_mapping(45678).await {
            Some(m) => {
                println!("upnp: {}", m.address);
                close_mapping(m).await;
            }
            None => println!("upnp: non disponibile"),
        }
    }
}
