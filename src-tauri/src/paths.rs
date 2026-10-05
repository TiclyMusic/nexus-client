use std::path::{Path, PathBuf};

/// Layout su disco:
///
/// ```text
/// <app_data>/
///   settings.json
///   accounts.enc              token cifrati (chiave AES nel portachiavi di sistema)
///   meta/                     condivisi fra le istanze (compatibile con gli installer Forge)
///     versions/<id>/<id>.json|.jar
///     libraries/…
///     assets/{indexes,objects,virtual}
///     runtimes/<component>/   Java runtime Mojang
///   instances/<id>/
///     instance.json
///     nexus-content.json      manifest dei contenuti installati da Modrinth
///     natives/
///     .minecraft/             game directory isolata
///   cache/
/// ```
#[derive(Debug, Clone)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn meta(&self) -> PathBuf {
        self.root.join("meta")
    }
    pub fn versions(&self) -> PathBuf {
        self.meta().join("versions")
    }
    pub fn version_json(&self, id: &str) -> PathBuf {
        self.versions().join(id).join(format!("{id}.json"))
    }
    pub fn version_jar(&self, id: &str) -> PathBuf {
        self.versions().join(id).join(format!("{id}.jar"))
    }
    pub fn libraries(&self) -> PathBuf {
        self.meta().join("libraries")
    }
    pub fn assets(&self) -> PathBuf {
        self.meta().join("assets")
    }
    pub fn runtimes(&self) -> PathBuf {
        self.meta().join("runtimes")
    }
    pub fn instances(&self) -> PathBuf {
        self.root.join("instances")
    }
    pub fn instance(&self, id: &str) -> PathBuf {
        self.instances().join(id)
    }
    pub fn instance_json(&self, id: &str) -> PathBuf {
        self.instance(id).join("instance.json")
    }
    pub fn game_dir(&self, id: &str) -> PathBuf {
        self.instance(id).join(".minecraft")
    }
    pub fn natives(&self, id: &str) -> PathBuf {
        self.instance(id).join("natives")
    }
    pub fn content_manifest(&self, id: &str) -> PathBuf {
        self.instance(id).join("nexus-content.json")
    }
    pub fn cache(&self) -> PathBuf {
        self.root.join("cache")
    }
    pub fn settings_file(&self) -> PathBuf {
        self.root.join("settings.json")
    }
    pub fn accounts_file(&self) -> PathBuf {
        self.root.join("accounts.enc")
    }
    pub fn friends_file(&self) -> PathBuf {
        self.root.join("friends.json")
    }
}

/// Accetta solo path relativi "sicuri" (niente `..`, niente assoluti): usato per mrpack e zip.
pub fn safe_join(base: &Path, relative: &str) -> Option<PathBuf> {
    let rel = Path::new(relative);
    if rel.is_absolute() {
        return None;
    }
    let mut out = base.to_path_buf();
    for comp in rel.components() {
        match comp {
            std::path::Component::Normal(c) => out.push(c),
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    Some(out)
}
