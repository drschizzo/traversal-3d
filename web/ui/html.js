// Petits outils de mise en page HTML, partagés par les panneaux de l'interface
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// texte enrichi produit par coach/ : échappé, puis **gras** → <b>
export const rich = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
