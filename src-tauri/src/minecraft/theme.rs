//! Generatore e installatore del Resource Pack "Nexus Material 3 Expressive" per Minecraft.
//! Modifica l'interfaccia di gioco e il menu principale di Minecraft con lo stile Material 3 Expressive.

use std::{fs, path::Path};
use serde_json::json;
use tauri::State;

use crate::{
    error::{msg, Result},
    state::AppState,
};

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| msg(format!("PNG header error: {e}")))?;
        writer.write_image_data(rgba).map_err(|e| msg(format!("PNG write error: {e}")))?;
    }
    Ok(buf)
}

/// Genera una texture per bottone Material 3 con bordi arrotondati.
fn generate_m3_button(width: u32, height: u32, bg: [u8; 4], border: [u8; 4]) -> Vec<u8> {
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    let r = 4.0f32; // raggio angolo

    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;

            // Distanza dal bordo arrotondato
            let dx = if (x as f32) < r {
                r - x as f32
            } else if (x as f32) > (width as f32 - 1.0 - r) {
                x as f32 - (width as f32 - 1.0 - r)
            } else {
                0.0
            };

            let dy = if (y as f32) < r {
                r - y as f32
            } else if (y as f32) > (height as f32 - 1.0 - r) {
                y as f32 - (height as f32 - 1.0 - r)
            } else {
                0.0
            };

            let dist = (dx * dx + dy * dy).sqrt();

            if dist > r + 0.5 {
                // Trasparente fuori dall'angolo
                rgba[idx..idx + 4].copy_from_slice(&[0, 0, 0, 0]);
            } else if dist > r - 0.75 || x == 0 || x == width - 1 || y == 0 || y == height - 1 {
                // Bordo
                rgba[idx..idx + 4].copy_from_slice(&border);
            } else {
                // Riempimento
                rgba[idx..idx + 4].copy_from_slice(&bg);
            }
        }
    }
    rgba
}

/// Genera lo sprite sheet widgets.png (256x256) per versioni legacy di Minecraft.
fn generate_legacy_widgets() -> Vec<u8> {
    let mut sheet = vec![0u8; 256 * 256 * 4];

    // Colori M3 Expressive
    let normal_bg = [40, 39, 46, 255];
    let normal_border = [74, 69, 78, 255];
    let hover_bg = [76, 175, 80, 255]; // Expressive Emerald green
    let hover_border = [166, 211, 136, 255];
    let disabled_bg = [28, 27, 31, 180];
    let disabled_border = [49, 48, 51, 180];

    let b_disabled = generate_m3_button(200, 20, disabled_bg, disabled_border);
    let b_normal = generate_m3_button(200, 20, normal_bg, normal_border);
    let b_hover = generate_m3_button(200, 20, hover_bg, hover_border);

    // In widgets.png:
    // y=46..66: disabled
    // y=66..86: normal
    // y=86..106: hover
    for y in 0..20 {
        let row_src = (y * 200 * 4) as usize;
        let row_src_end = row_src + 200 * 4;

        let row_dst_dis = (((46 + y) * 256) * 4) as usize;
        sheet[row_dst_dis..row_dst_dis + 200 * 4].copy_from_slice(&b_disabled[row_src..row_src_end]);

        let row_dst_norm = (((66 + y) * 256) * 4) as usize;
        sheet[row_dst_norm..row_dst_norm + 200 * 4].copy_from_slice(&b_normal[row_src..row_src_end]);

        let row_dst_hov = (((86 + y) * 256) * 4) as usize;
        sheet[row_dst_hov..row_dst_hov + 200 * 4].copy_from_slice(&b_hover[row_src..row_src_end]);
    }

    sheet
}

/// Genera il panorama scuro Material 3 Expressive (128x128).
fn generate_m3_panorama() -> Vec<u8> {
    let mut rgba = vec![0u8; 128 * 128 * 4];
    for y in 0..128 {
        for x in 0..128 {
            let idx = ((y * 128 + x) * 4) as usize;
            // Gradiente morbido dark theme
            let factor = ((x as f32 / 128.0) * 0.5 + (y as f32 / 128.0) * 0.5) * 20.0;
            let r = (19.0 + factor) as u8;
            let g = (19.0 + factor * 0.8) as u8;
            let b = (26.0 + factor * 1.2) as u8;
            rgba[idx..idx + 4].copy_from_slice(&[r, g, b, 255]);
        }
    }
    rgba
}

/// Genera un'icona pack.png con il logo Nexus M3 (64x64).
fn generate_pack_icon() -> Vec<u8> {
    let mut rgba = vec![0u8; 64 * 64 * 4];
    for y in 0..64 {
        for x in 0..64 {
            let idx = ((y * 64 + x) * 4) as usize;
            let cx = x as f32 - 32.0;
            let cy = y as f32 - 32.0;
            let dist = (cx * cx + cy * cy).sqrt();

            if dist < 26.0 {
                // Cerchio Material You
                rgba[idx..idx + 4].copy_from_slice(&[76, 175, 80, 255]);
                if dist < 12.0 || (cx.abs() < 4.0 && cy.abs() < 18.0) {
                    rgba[idx..idx + 4].copy_from_slice(&[255, 255, 255, 255]);
                }
            } else {
                rgba[idx..idx + 4].copy_from_slice(&[28, 27, 31, 255]);
            }
        }
    }
    rgba
}

pub fn create_material3_pack(game_dir: &Path) -> Result<()> {
    let pack_dir = game_dir.join("resourcepacks").join("Nexus-Material3-Expressive");
    fs::create_dir_all(&pack_dir)?;

    // 1. pack.mcmeta
    let mcmeta = json!({
        "pack": {
            "pack_format": 34,
            "supported_formats": { "min_inclusive": 15, "max_inclusive": 48 },
            "description": "§aNexus §fMaterial 3 Expressive §7— UI Moderna, Pill Buttons & Dark Menu"
        }
    });
    fs::write(pack_dir.join("pack.mcmeta"), serde_json::to_vec_pretty(&mcmeta)?)?;

    // 2. pack.png
    let icon_raw = generate_pack_icon();
    let icon_png = encode_png(64, 64, &icon_raw)?;
    fs::write(pack_dir.join("pack.png"), icon_png)?;

    // 3. Modern Sprites (Minecraft 1.20.2+)
    let sprites_dir = pack_dir
        .join("assets")
        .join("minecraft")
        .join("textures")
        .join("gui")
        .join("sprites")
        .join("widget");
    fs::create_dir_all(&sprites_dir)?;

    let btn_normal = generate_m3_button(200, 20, [40, 39, 46, 255], [74, 69, 78, 255]);
    let btn_highlighted = generate_m3_button(200, 20, [76, 175, 80, 255], [166, 211, 136, 255]);
    let btn_disabled = generate_m3_button(200, 20, [28, 27, 31, 180], [49, 48, 51, 180]);

    fs::write(sprites_dir.join("button.png"), encode_png(200, 20, &btn_normal)?)?;
    fs::write(sprites_dir.join("button_highlighted.png"), encode_png(200, 20, &btn_highlighted)?)?;
    fs::write(sprites_dir.join("button_disabled.png"), encode_png(200, 20, &btn_disabled)?)?;

    // Nine-slice: senza questi .mcmeta, Minecraft 1.20.2+ stira la texture 200x20 su ogni
    // pulsante deformando gli angoli arrotondati. `border` 5px preserva gli angoli Material 3.
    let nine_slice = json!({
        "gui": {
            "scaling": {
                "type": "nine_slice",
                "width": 200,
                "height": 20,
                "border": { "left": 5, "top": 5, "right": 5, "bottom": 5 }
            }
        }
    });
    let nine_slice_bytes = serde_json::to_vec_pretty(&nine_slice)?;
    for sprite in ["button.png.mcmeta", "button_highlighted.png.mcmeta", "button_disabled.png.mcmeta"] {
        fs::write(sprites_dir.join(sprite), &nine_slice_bytes)?;
    }

    // 4. Legacy widgets.png (Minecraft 1.13 - 1.20.1)
    let gui_dir = pack_dir
        .join("assets")
        .join("minecraft")
        .join("textures")
        .join("gui");
    fs::create_dir_all(&gui_dir)?;
    let legacy_widgets = generate_legacy_widgets();
    fs::write(gui_dir.join("widgets.png"), encode_png(256, 256, &legacy_widgets)?)?;

    // 5. Panorama background Material 3 per il menu iniziale
    let pano_dir = gui_dir.join("title").join("background");
    fs::create_dir_all(&pano_dir)?;
    let pano_raw = generate_m3_panorama();
    let pano_png = encode_png(128, 128, &pano_raw)?;
    for i in 0..6 {
        fs::write(pano_dir.join(format!("panorama_{i}.png")), &pano_png)?;
    }

    Ok(())
}

/// Attiva o disattiva il resource pack in options.txt dell'istanza.
pub fn set_resource_pack_active(game_dir: &Path, active: bool) -> Result<()> {
    let options_path = game_dir.join("options.txt");
    let content = fs::read_to_string(&options_path).unwrap_or_default();
    let pack_id = "\"file/Nexus-Material3-Expressive\"";

    let mut lines = Vec::new();
    let mut found = false;

    for line in content.lines() {
        if line.starts_with("resourcePacks:") {
            found = true;
            let val = line.strip_prefix("resourcePacks:").unwrap_or("[]").trim();
            let mut list: Vec<String> = serde_json::from_str(val).unwrap_or_else(|_| vec!["vanilla".to_string()]);
            if active {
                if !list.iter().any(|p| p == "file/Nexus-Material3-Expressive") {
                    list.push("file/Nexus-Material3-Expressive".to_string());
                }
            } else {
                list.retain(|p| p != "file/Nexus-Material3-Expressive");
            }
            let new_json = serde_json::to_string(&list).unwrap_or_else(|_| "[]".to_string());
            lines.push(format!("resourcePacks:{new_json}"));
        } else {
            lines.push(line.to_string());
        }
    }

    if !found && active {
        lines.push(format!("resourcePacks:[\"vanilla\",{pack_id}]"));
    }

    fs::write(options_path, lines.join("\n"))?;
    Ok(())
}

#[tauri::command]
pub async fn apply_material3_theme(state: State<'_, AppState>, instance_id: String, enabled: bool) -> Result<()> {
    let game_dir = state.paths.game_dir(&instance_id);
    if enabled {
        create_material3_pack(&game_dir)?;
        set_resource_pack_active(&game_dir, true)?;
    } else {
        set_resource_pack_active(&game_dir, false)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn is_material3_theme_enabled(state: State<'_, AppState>, instance_id: String) -> Result<bool> {
    let game_dir = state.paths.game_dir(&instance_id);
    let options_path = game_dir.join("options.txt");
    if !options_path.exists() {
        return Ok(false);
    }
    let content = fs::read_to_string(options_path).unwrap_or_default();
    Ok(content.contains("Nexus-Material3-Expressive"))
}
