// Evita la console aggiuntiva su Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nexus_launcher_lib::run()
}
