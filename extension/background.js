const API_ENDPOINT = 'http://localhost:3000/shop-frame';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message?.type);
  
  if (!message || message.type !== 'shopFrame') {
    return false;
  }

  console.log('[Background] Processing shopFrame request...');
  console.log('[Background] imageBase64 length:', message.imageBase64?.length);

  handleShopFrame(message)
    .then((data) => {
      console.log('[Background] Success! Sending response back...');
      console.log('[Background] Response data keys:', Object.keys(data || {}));
      console.log('[Background] Response results count:', data?.results?.length);
      sendResponse({ ok: true, data });
    })
    .catch((error) => {
      console.error('[Background] Error:', error);
      sendResponse({ ok: false, error: error.message || 'Request failed' });
    });

  return true;
});

async function handleShopFrame(message) {
  // Convert base64 back to blob
  const binaryString = atob(message.imageBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: message.mimeType || 'image/jpeg' });
  
  const formData = new FormData();
  formData.append('frame', blob, message.filename || 'frame.jpg');

  console.log('[Background] Sending request to backend...');

  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[Background] Server error:', response.status, text);
    throw new Error(`Server error: ${response.status}`);
  }

  const data = await response.json();
  console.log('[Background] Received response:', JSON.stringify(data).slice(0, 500));
  return data;
}
