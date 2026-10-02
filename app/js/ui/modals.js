// Modal primitives: the generic confirm modal (#confirmModal) and closing the
// history-managed modals.
import { elements } from "./dom.js";

export function closeManagedModals()
{
  elements.settingsModal.classList.add("hidden");
  elements.detailsModal.classList.add("hidden");
  elements.resetModal.classList.add("hidden");
  elements.confirmModal.classList.add("hidden");
  elements.playerNamesModal.classList.add("hidden");
}

export function showConfirm(message)
{
  return new Promise((resolve) =>
  {
    elements.confirmMessage.innerHTML = message.replace(/\n/g, "<br>");
    elements.confirmModal.classList.remove("hidden");

    const cleanup = (result) =>
    {
      elements.confirmOkBtn.onclick = null;
      elements.confirmCancelBtn.onclick = null;
      elements.confirmModal.classList.add("hidden");
      resolve(result);
    };

    elements.confirmOkBtn.onclick = () => cleanup(true);
    elements.confirmCancelBtn.onclick = () => cleanup(false);

    // Support dismissing by clicking outside
    elements.confirmModal.onclick = (e) =>
    {
      if (e.target === elements.confirmModal) cleanup(false);
    };
  });
}
