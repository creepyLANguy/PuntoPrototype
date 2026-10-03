// Screen wake lock held while a court is open.
let wakeLock = null;

export async function requestWakeLock()
{
  try
  {
    wakeLock = await navigator.wakeLock.request("screen");
    //console.log("Wake lock acquired - device will stay awake.");

    // Re-acquire lock if user interacts with device
    wakeLock.addEventListener("release", () =>
    {
      //console.warn("Wake lock released.");
    });
  }
  catch (error)
  {
    console.warn("Wake lock not supported or denied:", error);
  }
}

export async function releaseWakeLock()
{
  if (wakeLock)
  {
    try
    {
      await wakeLock.release();
      wakeLock = null;
      //console.log("Wake lock released.");
    }
    catch (error)
    {
      console.error("Error releasing wake lock:", error);
    }
  }
}
