/**
 * Sharing Module
 * Handles court link sharing with platform-specific behaviors
 * Desktop: Copy to clipboard + toast notification
 * Mobile: Use native share API (Android/iOS)
 * Score Details: Share as image render
 */

export function initSharing() {
  const TOAST_DURATION_MS = 3000;

  function isMobileDevice() {
    const ua = navigator.userAgent.toLowerCase();
    return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(ua);
  }

  function isDesktopDevice() {
    return !isMobileDevice();
  }

  function getOS() {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    if (/windows/i.test(ua)) return 'windows';
    if (/mac/i.test(ua)) return 'macos';
    if (/linux/i.test(ua)) return 'linux';
    return 'unknown';
  }

  function supportsNativeShare() {
    return navigator.share !== undefined;
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textArea);
        return success;
      }
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      return false;
    }
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.remove(), TOAST_DURATION_MS);
  }

  async function shareCourtLink(courtId, courtName, mode = 'spectate') {
    const url = `${window.location.origin}/app/${mode}/${courtId}`;
    const shareTitle = `Join ${courtName} on Padel Push`;
    const shareText = `Watch the match: ${courtName}`;

    if (isDesktopDevice()) {
      // Desktop: Copy to clipboard
      const success = await copyToClipboard(url);
      if (success) {
        showToast('Link copied to clipboard!', 'success');
      } else {
        showToast('Failed to copy link', 'error');
      }
    } else {
      // Mobile: Use native share if available
      if (supportsNativeShare()) {
        try {
          await navigator.share({
            title: shareTitle,
            text: shareText,
            url: url
          });
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.error('Share failed:', err);
            // Fallback to clipboard
            const success = await copyToClipboard(url);
            if (success) {
              showToast('Link copied to clipboard!', 'success');
            }
          }
        }
      } else {
        // Fallback: Copy to clipboard
        const success = await copyToClipboard(url);
        if (success) {
          showToast('Link copied to clipboard!', 'success');
        } else {
          showToast('Failed to copy link', 'error');
        }
      }
    }
  }

  async function captureElementAsImage(element) {
    try {
      // Dynamically import html2canvas if not already loaded
      if (!window.html2canvas) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      const canvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: 2
      });
      return canvas.toBlob();
    } catch (err) {
      console.error('Failed to capture element as image:', err);
      return null;
    }
  }

  async function shareScoreDetailsImage(element, courtName) {
    try {
      const blob = await captureElementAsImage(element);
      if (!blob) {
        showToast('Failed to generate image', 'error');
        return;
      }

      const shareTitle = `Match Details - ${courtName}`;
      const shareText = `Check out this padel match on Padel Push!`;

      if (supportsNativeShare() && isMobileDevice()) {
        // Create a file from blob for native sharing
        const file = new File([blob], 'match-details.png', { type: 'image/png' });

        try {
          await navigator.share({
            title: shareTitle,
            text: shareText,
            files: [file]
          });
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.error('Share failed:', err);
            // Fallback: Offer download
            downloadImageBlob(blob, 'match-details.png');
          }
        }
      } else {
        // Desktop or no native share: Offer download
        downloadImageBlob(blob, 'match-details.png');
      }
    } catch (err) {
      console.error('Error sharing score details:', err);
      showToast('Failed to share image', 'error');
    }
  }

  function downloadImageBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Image downloaded!', 'success');
  }

  return {
    shareCourtLink,
    shareScoreDetailsImage,
    isMobileDevice,
    isDesktopDevice,
    getOS,
    supportsNativeShare,
    copyToClipboard,
    showToast
  };
}

export default initSharing;