// Enter-to-submit behaviour for the app's forms and modal inputs.
import { elements } from "./dom.js";

function submitOnEnter(inputEl, buttonEl)
{
  if (!inputEl || !buttonEl) return;

  inputEl.addEventListener("keydown", (e) =>
  {
    if (e.key === "Enter")
    {
      e.preventDefault();
      buttonEl.click();
    }
  });
}

function submitFormOnEnter(formEl)
{
  if (!formEl) return;

  formEl.addEventListener("keydown", (e) =>
  {
    if (e.key !== "Enter") return;
    const target = e.target;
    if (target && (target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    const submitButton = formEl.querySelector("button[type='submit'], .primary-btn");
    if (submitButton)
    {
      e.preventDefault();
      submitButton.click();
    }
  });
}

export function registerEnterKeySubmit()
{
  // CREATE PAGE
  submitOnEnter(elements.courtName, elements.createCourtBtn);
  submitOnEnter(elements.courtPassword, elements.createCourtBtn);
  submitFormOnEnter(elements.createPage);

  // ADMIN AUTH PAGE
  submitOnEnter(elements.adminAuthPassword, elements.submitAdminAuthBtn);
  submitFormOnEnter(elements.adminAuthPage);

  // PLAY PAGE
  submitOnEnter(elements.playCourtPassword, elements.enterCourtBtn);
  submitFormOnEnter(elements.playPage);

  // SPECTATE PAGE
  submitFormOnEnter(elements.spectatePage);

  // RESET MODAL
  submitOnEnter(elements.resetCourtPassword, elements.confirmResetBtn);
  submitFormOnEnter(elements.resetModal);

  // ADD DEVICE PAGE
  submitOnEnter(elements.newDeviceId, elements.saveNewDeviceBtn);
  submitOnEnter(elements.newDeviceCourtIdManual, elements.saveNewDeviceBtn);
  submitOnEnter(elements.newDeviceCourtIdSelect, elements.saveNewDeviceBtn);
  submitFormOnEnter(elements.addDevicePage);

  // EDIT DEVICE PAGE
  submitOnEnter(elements.editDeviceCourtIdManual, elements.saveEditDeviceBtn);
  submitOnEnter(elements.editDeviceCourtIdSelect, elements.saveEditDeviceBtn);
  submitFormOnEnter(elements.editDevicePage);

  // EDIT COURT PAGE
  submitOnEnter(elements.editCourtName, elements.saveEditBtn);
  submitOnEnter(elements.editTeamAName, elements.saveEditBtn);
  submitOnEnter(elements.editTeamBName, elements.saveEditBtn);
  submitOnEnter(elements.editCourtPassword, elements.saveEditBtn);
  submitOnEnter(elements.editCourtStatus, elements.saveEditBtn);
  submitOnEnter(elements.editCourtScoringMode, elements.saveEditBtn);
  submitOnEnter(elements.editCourtDeuceMode, elements.saveEditBtn);
  submitOnEnter(elements.editCourtTiebreakMode, elements.saveEditBtn);
  submitFormOnEnter(elements.editCourtPage);
}
