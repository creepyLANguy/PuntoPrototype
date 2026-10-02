// Mock of https://esm.sh/html-to-image@1.11.13

// Every call is recorded so tests can inspect the node and options the app
// hands to the real library, which is otherwise invisible from the DOM.
export const toBlobCalls = [];

let gate = null;

export function resetToBlobCalls() {
  toBlobCalls.length = 0;
}

// Holds every toBlob() call until the returned release function is called, so
// tests can observe the app while a capture is still in flight.
export function holdToBlob() {
  let release;
  gate = new Promise((resolve) => {
    release = resolve;
  });
  return () => {
    gate = null;
    release();
  };
}

export async function toBlob(node, options) {
  toBlobCalls.push({ node, options });
  if (gate) await gate;
  return new Blob(["mock-image"], { type: "image/png" });
}
