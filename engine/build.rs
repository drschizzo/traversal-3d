// Contrat de l'interface WebAssembly : les positions du tampon partagé sont définies une seule fois,
// dans layout.json, lu ici pour le moteur et importé tel quel par le jeu (web/bot/wasm-bridge.js).
use std::{env, fs, path::Path};

fn main() {
    println!("cargo:rerun-if-changed=layout.json");
    let json = fs::read_to_string("layout.json").expect("layout.json");
    let mut out = String::from("// généré par build.rs depuis layout.json\n");
    for line in json.lines() {
        let line = line.trim().trim_end_matches(',');
        if let Some((k, v)) = line.split_once(':') {
            let (k, v) = (k.trim().trim_matches('"'), v.trim());
            let v: usize = v.parse().unwrap_or_else(|_| panic!("layout.json : valeur entière attendue pour {k}"));
            out += &format!("pub const {k}: usize = {v};\n");
        }
    }
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("layout.rs"), out).unwrap();
}
