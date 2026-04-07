let data = [];
let index = 0;
let scanning = false;
let tagMap = {}; // Maps URL -> Tag UID
let draggedItemIndex = null;
let currentMode = "write";
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function init() {
    const saved = localStorage.getItem("padel_push_accessible_v1");
    if (saved) {
        const s = JSON.parse(saved);
        data = s.data || [];
        index = s.index || 0;
        tagMap = s.tagMap || {};
    }
    if (localStorage.getItem("dark") === "1") document.body.classList.add("dark");
    render();
}

function save() {
    localStorage.setItem("padel_push_accessible_v1", JSON.stringify({
        data, index, tagMap
    }));
}

document.getElementById("file").onchange = e => {
    const r = new FileReader();
    r.onload = () => {
        data = r.result.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        index = 0;
        save(); render();
    };
    r.readAsText(e.target.files[0]);
};

function setFocus(i) {
    index = i;
    save(); render();
}

async function start() {
    if (!("NDEFReader" in window)) return document.getElementById("status").innerText = "Phone Not Compatible";
    await audioCtx.resume();
    
    try {
        const reader = new NDEFReader();
        await reader.scan();
        scanning = true;
        document.getElementById("status").innerText = `MODE: ${currentMode.toUpperCase()}`;
        document.getElementById("pulseIndicator").classList.add("active");
        document.getElementById("startBtn").innerText = "SCANNER ON";
        
        reader.onreading = async ({ message, serialNumber }) => { 
            if (!scanning) return;

            try {
                // Helper to get text from the first record
                const decoder = new TextDecoder();
                const record = message.records[0];
                const tagContent = record ? decoder.decode(record.data) : "";

                if (currentMode === "write") {
                    await reader.write({ records: [{ recordType: "url", data: data[index] }] });
                    tagMap[data[index]] = serialNumber || "N/A";
                    playFeedback(true);
                    index++; 
                  if (index >= data.length) {
                      document.getElementById("status").innerText = "BATCH COMPLETE! 🎉";
                      navigator.vibrate([100, 50, 100, 50, 100]); 
                      playBeep(1200, 0.3); 
                      scanning = false;
                      stop(); 
                  }
                } 
                else if (currentMode === "verify") {
                    const isMatch = tagContent.includes(data[index]);
                    playFeedback(isMatch);
                    document.getElementById("status").innerText = isMatch ? "MATCH!" : "WRONG TAG";
                }
                else if (currentMode === "locate") {
                    const foundIndex = data.indexOf(tagContent);
                    if (foundIndex !== -1) {
                        index = foundIndex; 
                        playFeedback(true);
                        document.getElementById("status").innerText = `FOUND ITEM #${index + 1}`;
                    } else {
                        playFeedback(false);
                        document.getElementById("status").innerText = "TAG NOT IN LIST";
                    }
                }
                else if (currentMode === "write_missing") {
                  if (tagMap[data[index]]) {
                    while (index < data.length && tagMap[data[index]]) {
                      index++;
                    }

                    if (index >= data.length) {
                      document.getElementById("status").innerText = "BATCH COMPLETE! 🎉";
                      navigator.vibrate([100, 50, 100, 50, 100]); 
                      playBeep(1200, 0.3); 
                      scanning = false;
                      stop();
                    } else {
                      document.getElementById("status").innerText = "SKIPPED: SEEKING NEXT...";
                      await reader.write({ records: [{ recordType: "url", data: data[index] }] });
                      tagMap[data[index]] = serialNumber || "N/A";
                      playFeedback(true);
                      index++;
                    }
                  } else {
                      await reader.write({ records: [{ recordType: "url", data: data[index] }] });
                      tagMap[data[index]] = serialNumber || "N/A";
                      playFeedback(true);
                      index++;
                  }
              }
                
              save(); 
              render();
            } catch (err) {
                playFeedback(false);
                console.error("NFC Operation Failed:", err);
            }
        };
    } catch (err) { 
        document.getElementById("status").innerText = "NFC Off"; 
    }
}

function stop() { 
    scanning = false; 
    document.getElementById("pulseIndicator").classList.remove("active");
    document.getElementById("startBtn").innerText = "START SCANNING";
    document.getElementById("status").innerText = "System Ready";
}

function toggleMode() {
    const modes = ["write", "verify", "locate", "write_missing"];
    let mode = document.getElementById("modeLabel").innerText.toLowerCase().replace(" ", "_");
    let next = modes[(modes.indexOf(mode) + 1) % modes.length];
    document.getElementById("modeLabel").innerText = next.charAt(0).toUpperCase() + next.slice(1).replace("_", " ");
}

function del(i) { data.splice(i, 1); if(index > i) index--; save(); render(); }
function prev() { index = Math.max(0, index - 1); render(); save(); }
function next() { index = Math.min(data.length - 1, index + 1); render(); save(); }
function clearData() { if(confirm("Delete list?")) { data=[]; index=0; tagMap={}; save(); render(); } }
function resetProgress() { index = 0; save(); render(); }
function toggleDark() { document.body.classList.toggle("dark"); localStorage.setItem("dark", document.body.classList.contains("dark") ? "1" : "0"); }

// Updated Mode Switching
function setMode(mode, el) {
    currentMode = mode;
    
    // UI Update for Segmented Control
    document.querySelectorAll('.seg-btn').forEach(btn => btn.classList.remove('active'));
    el.classList.add('active');
    
    // Play feedback sound
    playBeep(500, 0.05);
    
    // Logic can branching here based on currentMode
    console.log("System Mode changed to:", currentMode);
}

// Logic to handle Drag and Drop remains consistent, 
// ensuring the list renders within the scrollable container.
function render() {
    const list = document.getElementById("list");
    list.innerHTML = "";

    data.forEach((val, i) => {
      const div = document.createElement("div");
      div.className = `item ${i === index ? 'active-target' : ''}`;
      div.draggable = true;

      div.innerHTML = `
            <span style="font-size:18px; opacity:0.3; cursor:grab;">☰</span>
            <input value="${val}" readonly />
            <button class="focus-btn" onclick="setFocus(${i})">FOCUS</button>
            <button style="border:none; background:none; cursor:pointer; opacity:0.5;" onclick="del(${i})">✕</button>
        `;

      div.ondragstart = () => draggedItemIndex = i;
      div.ondragover = e => e.preventDefault();
      div.ondrop = e => {
        e.preventDefault();
        const targetIndex = i;
        const wasFocused = (draggedItemIndex === index);
        const item = data.splice(draggedItemIndex, 1)[0];
        data.splice(targetIndex, 0, item);
        if (wasFocused) index = targetIndex;
        else if (draggedItemIndex < index && targetIndex >= index) index--;
        else if (draggedItemIndex > index && targetIndex <= index) index++;
        save(); render();
      };
      list.appendChild(div);
      
      if (i === index) {
        div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    const progress = data.length ? (index/data.length)*100 : 0;
    document.getElementById("progressFill").style.width = progress + "%";
    document.getElementById("counter").innerText = `${index} / ${data.length}`;
    document.getElementById("percentLabel").innerText = Math.round(progress) + "%";
}

// 1. Add the feedback trigger function
function playFeedback(success) {
    playBeep(success ? 880 : 220, 0.2); // High beep for win, low for fail
    if (navigator.vibrate) {
        navigator.vibrate(success ? 100 : [200, 100, 200]); // Short pulse vs double pulse
    }
}

// 2. Add the actual sound generator
function playBeep(freq, duration) {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.frequency.value = freq;
    g.gain.setTargetAtTime(0.1, audioCtx.currentTime, 0.05);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function exportCSV() {
    if (data.length === 0) return alert("No data to export.");

    let csvContent = "data:text/csv;charset=utf-8,Index,URL,Status,Tag UID\n";

    data.forEach((val, i) => {
        const uid = tagMap[val];
        const status = uid ? "Written" : "Pending";
        csvContent += `${i + 1},"${val}",${status},${uid || "N/A"}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `nfc_batch_ledger_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);

    link.click();
    document.body.removeChild(link);
}
// Initialize on Load
init();