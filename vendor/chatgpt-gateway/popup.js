// Popup status check
async function checkStatus() {
  const serverDot = document.getElementById("serverDot");
  const serverStatus = document.getElementById("serverStatus");
  const chatgptDot = document.getElementById("chatgptDot");
  const chatgptStatus = document.getElementById("chatgptStatus");

  // Check gateway server
  try {
    const res = await fetch("http://127.0.0.1:18790/health");
    if (!res.ok) throw new Error(`Gateway health returned HTTP ${res.status}`);
    const data = await res.json();
    serverDot.className = "dot green";
    serverStatus.textContent = data.extensionConnected
      ? "Gateway server running, extension connected"
      : "Gateway server running, extension not connected";
    if (!data.extensionConnected) serverDot.className = "dot yellow";
  } catch {
    serverDot.className = "dot red";
    serverStatus.textContent = "Gateway server not running";
  }

  // Check ChatGPT tab
  try {
    const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
    if (tabs.length > 0) {
      chatgptDot.className = "dot green";
      chatgptStatus.textContent = `ChatGPT open (${tabs.length} tab${tabs.length > 1 ? "s" : ""})`;
    } else {
      chatgptDot.className = "dot red";
      chatgptStatus.textContent = "No ChatGPT tab — open chatgpt.com";
    }
  } catch {
    chatgptDot.className = "dot red";
    chatgptStatus.textContent = "Cannot check tabs";
  }
}

document.getElementById("testBtn").addEventListener("click", async () => {
  const result = document.getElementById("result");
  result.textContent = "Pinging content script...";

  try {
    const { tab, response } = await GatewayTabs.selectReady();
    result.textContent = `Content script ready on tab ${tab.id}\n${response.url || tab.url || "ChatGPT"}\n${JSON.stringify(response.diagnostics || {}, null, 2)}`;

  } catch (err) {
    result.textContent = `Error: ${err.message}\nTry refreshing chatgpt.com`;
  }
});

checkStatus();
