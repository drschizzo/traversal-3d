#!/bin/sh
# Compile le moteur en WebAssembly et le copie à côté du jeu (engine/traversal.wasm).
# Prérequis : rustup target add wasm32-unknown-unknown
set -e
cd "$(dirname "$0")"
cargo build --release --lib --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/traversal_engine.wasm traversal.wasm
ls -l traversal.wasm
