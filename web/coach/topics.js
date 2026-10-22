// Thèmes de jeu : chaque raison d'un coup, et chaque faute, se rattache à un principe du guide de stratégie
import { GUIDE_URL } from '../config.js';

export const TOPICS = {
  race: { label: 'Course des Sentinelles', icon: '🏃', guide: '#2-la-course-des-sentinelles',
    principle: 'Comptez les tours, pas les cases : un tour d’avance de Sentinelle vaut une pièce entière.' },
  safety: { label: 'Sécurité des pièces', icon: '🛡️', guide: '#5-se-défendre',
    principle: 'Avant chaque coup, regardez quelles pièces adverses pourront entrer sur votre case au tour suivant, hauteur et voisins compris.' },
  capture: { label: 'Captures', icon: '⚔️', guide: '#4-le-combat',
    principle: 'Le camp qui gagne le bilan des captures l’emporte trois fois sur quatre : cherchez les attaques depuis la hauteur ou avec la charge de l’Avant-garde.' },
  exit: { label: 'Sorties', icon: '🏁', guide: '#qui-sort-en-premier-et-ce-que-ça-rapporte',
    principle: 'Ne sortez pas un Explorateur en premier, sauf si une seconde pièce suit aussitôt ; sortir une Avant-garde en premier est un pari.' },
  height: { label: 'Hauteur', icon: '⛰️', guide: '#4-le-combat',
    principle: 'La hauteur est la meilleure arme : la moitié des captures se font depuis une case plus haute.' },
  group: { label: 'Cohésion', icon: '🤝', guide: '#5-se-défendre',
    principle: 'Avancez par paires : une pièce collée à deux alliés est capturée trois fois moins souvent qu’une pièce isolée.' },
  progress: { label: 'Progression', icon: '➡️', guide: '#6-la-géographie-du-plateau',
    principle: 'Les Sentinelles courent sur les flancs, les Explorateurs tiennent le centre ; un chemin plat est souvent plus rapide qu’une ligne droite en montagne.' },
};
export const guideUrl = th => GUIDE_URL + TOPICS[th].guide;

