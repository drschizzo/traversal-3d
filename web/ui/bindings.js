// Le contrat entre la session et l'interface, en un seul endroit : à chaque annonce de session/view.js,
// ce que l'interface en fait. C'est le seul module qui les connaît toutes ; ailleurs, ui/ ne s'abonne à rien.
import { onAll } from '../session/view.js';
import { setStatus, updateHUD, setNames, toast } from './hud.js';
import { updateControls } from './controls.js';
import { setCoach, renderCoach, showPlan, clearPlan } from './coach-panel.js';
import { select, clearSelection } from './input.js';
import { syncMenu, enterView, leaveView, openMenu } from './menu.js';
import { showGameOver, hideGameOver, updateRematchButton } from './game-over.js';
import { showLobby } from './lobby.js';
import { showFeedbackPanel } from './feedback.js';
import { showReviewPanel } from './review-panel.js';

export function initBindings() {
  onAll({
    status: ({ text, side, thinking }) => setStatus(text, side, thinking),
    refresh: () => { updateHUD(); updateControls(); },
    coach: renderCoach,
    coachOpen: setCoach,
    plan: items => (items ? showPlan(items) : clearPlan()),
    select: pi => (pi >= 0 ? select(pi) : clearSelection()),
    toast,
    names: setNames,
    menu: joinCode => syncMenu(joinCode),
    enter: enterView,
    leave: leaveView,
    openMenu,
    over: show => (show === false ? hideGameOver() : showGameOver()),
    rematch: updateRematchButton,
    lobby: showLobby,
    feedback: showFeedbackPanel,
    review: showReviewPanel,
  });
}
