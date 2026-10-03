// Sharing: Web Share API (with files, then text), clipboard fallback and the last-
// resort prompt, plus the share buttons that trigger it.
import { TOAST_TYPES } from "../config/constants.js";
import { shareCardState } from "./shareCardState.js";
import { getSharePayload } from "./sharePayload.js";
import { session } from "../state/sessionState.js";
import { elements } from "../ui/dom.js";
import { showToast } from "../ui/toast.js";

async function share(context)
{
  if (context === "details" && shareCardState.shareableScoreCardPromise)
  {
    try
    {
      await shareCardState.shareableScoreCardPromise;
    }
    catch (error)
    {
      console.warn("Share card capture was not ready:", error);
    }
  }

  const share_payload = getSharePayload(context);

  let result = { done: false, method: "unavailable" };

  try
  {      
    // 1. Try native sharing with files
    if (navigator.share)
    {
      if
        (
        result.done === false &&
        share_payload.files?.length > 0 &&
        navigator.canShare &&
        navigator.canShare(share_payload)
      )
      {
        try
        {
          await navigator.share({
            title: share_payload.title,
            text: share_payload.text,
            files: share_payload.files
          });
          result = { done: true, method: "native", files: true };
        }
        catch (error)
        {
          if (error?.name === "AbortError")
          {
            result = { done: true, method: "cancelled" };              
          }

          console.warn("Native file share failed:", error);
        }
      }

      // 2. Try native text/URL sharing
      if (result.done === false)
      {
        try
        {
          await navigator.share({
            title: share_payload.title,
            text: share_payload.text,
          });

          result = { done: true, method: "native", files: false };
        }
        catch (error)
        {
          if (error?.name === "AbortError")
          {
            result = { done: true, method: "cancelled" };
          }

          console.warn("Native text share failed:", error);
        }
      }        
    }

    // 3. Clipboard fallback
    if (result.done === false && navigator.clipboard?.writeText)
    {
      try
      {
        await navigator.clipboard.writeText(share_payload.text);
        result = { done: true, method: "clipboard" };
      }
      catch (error)
      {
        console.warn("Clipboard share fallback failed:", error);
      }
    }

    // 4. Last-resort prompt
    if (result.done === false && window.prompt("Copy this share text:", share_payload.text) !== null) 
    {
      result = { done: true, method: "prompt" };
    }

    //Toast based on the result of the share attempts
    if (result.method === "native")
    {
      showToast("Shared.", TOAST_TYPES.SUCCESS);
      return;
    }
    if (result.method === "clipboard")
    {
      showToast("Share text copied.", TOAST_TYPES.SUCCESS);
      return;
    }
    if (result.method === "prompt")
    {
      return;
    }
    if (result.method !== "cancelled")
    {
      showToast("Sharing was cancelled.", TOAST_TYPES.ERROR);
    }
    if (result.method === "unavailable")
    {
      showToast("Sharing is unavailable on this device.", TOAST_TYPES.ERROR);
    }
  }
  catch (error)
  {
    console.warn("Share failed:", error);
    showToast("Sharing failed.", TOAST_TYPES.ERROR);
  }
}

export function registerShareButtons()
{
  if (elements.shareDetailsBtn)
  {
    const detailsShareLabel = navigator.share ? "Share match details" : "Copy match details link";
    elements.shareDetailsBtn.setAttribute("aria-label", detailsShareLabel);
    elements.shareDetailsBtn.title = detailsShareLabel;
    elements.shareDetailsBtn.addEventListener("click", () =>
    {
      if (!session.currentCourtId)
      {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      elements.shareDetailsBtn.classList.add("engagement-animation-disabled");
      void share("details");
    });
  }

  if (elements.shareCourtBtn)
  {
    const courtShareLabel = navigator.share ? "Share court" : "Copy court link";
    elements.shareCourtBtn.setAttribute("aria-label", courtShareLabel);
    elements.shareCourtBtn.title = courtShareLabel;
    elements.shareCourtBtn.addEventListener("click", () =>
    {
      if (!session.currentCourtId)
      {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      void share("scoreboard");
    });
  }
}
