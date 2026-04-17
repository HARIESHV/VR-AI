/* ===================================================
   VR AI – Intelligent Call Assistant
   Full frontend logic: Dialer, Incoming, Outgoing,
   Active Call (transcript + waveform + AI), Summary
   =================================================== */

'use strict';

// ── Constants & State ──────────────────────────────
const API_BASE = window.location.origin.includes('localhost') ? 'http://localhost:8000' : window.location.origin;

const authState = {
  token: localStorage.getItem('vrai-token') || null,
  isLoggedIn: !!localStorage.getItem('vrai-token'),
};

const state = {
  screen: 'home',           // home | incoming | outgoing | active | summary
  callerName: '',
  callerNumber: '',
  callDirection: 'incoming',// incoming | outgoing
  callStartTime: null,
  callDuration: 0,
  isMuted: false,
  isSpeaker: false,
  isAIAssist: true,
  isRecording: false,
  transcript: [],           // [{speaker, text}]
  aiScreening: false,
  timerInterval: null,
  recognition: null,        // SpeechRecognition instance
  synth: window.speechSynthesis,
  audioCtx: null,
  analyser: null,
  micStream: null,
  animFrame: null,
  wakeLock: null,
  settings: {
    aiScreening: true,
    aiAssist: true,
    autoTranscript: true,
    voiceDial: true,
  },
  contacts: [],
};

// ── Wake Lock (Always Active) ──────────────────────
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake Lock is active');
    }
  } catch (err) {
    console.warn(`Wake Lock error: ${err.name}, ${err.message}`);
  }
}
async function releaseWakeLock() {
  if (state.wakeLock !== null) {
    await state.wakeLock.release();
    state.wakeLock = null;
    console.log('Wake Lock released');
  }
}

// ── DOM Helpers ────────────────────────────────────
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// ── Screen Navigation ──────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`screen-${name}`);
  if (target) {
    target.classList.add('active');
    state.screen = name;
  }
}

// ── Toast ──────────────────────────────────────────
let toastTimer;
function showToast(msg, duration = 3000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── Dialer ─────────────────────────────────────────
const dialerInput = $('dialer-input');

$('dialer-keypad').addEventListener('click', e => {
  const btn = e.target.closest('.key-btn');
  if (!btn) return;
  const digit = btn.dataset.digit;
  dialerInput.value += digit;
  // Haptic feedback on mobile
  if (navigator.vibrate) navigator.vibrate(10);
});

$('backspace-btn').addEventListener('click', () => {
  dialerInput.value = dialerInput.value.slice(0, -1);
});

// ── Make Outgoing Call ─────────────────────────────
$('call-btn').addEventListener('click', () => {
  const num = dialerInput.value.trim();
  if (!num) { showToast('Enter a number to call'); return; }
  initiateOutgoingCall(num);
});

function initiateOutgoingCall(number, name) {
  state.callerNumber = number;
  
  // Try to find contact name if not provided
  if (!name) {
    const contact = state.contacts.find(c => c.phone_number === number);
    state.callerName = contact ? contact.name : formatNumber(number);
  } else {
    state.callerName = name;
  }
  
  state.callDirection = 'outgoing';

  // Update outgoing screen
  $('outgoing-caller-name').textContent   = state.callerName;
  $('outgoing-caller-number').textContent = state.callerNumber;
  $('outgoing-avatar-letter').textContent = (state.callerName[0] || '?').toUpperCase();

  showScreen('outgoing');

  // Simulate ringing → connect after 3 s
  setTimeout(() => {
    if (state.screen === 'outgoing') startActiveCall();
  }, 3000);
}

$('end-outgoing-btn').addEventListener('click', () => {
  showScreen('home');
  showToast('Call cancelled');
});

// ── Simulate Incoming Call ─────────────────────────
$('simulate-incoming-btn').addEventListener('click', () => {
  const contacts = [
    { name: 'Alex Johnson', number: '+1 (555) 234-5678' },
    { name: 'Sarah Lee',    number: '+1 (555) 876-4321' },
    { name: 'Unknown',      number: '+91 98765 43210'   },
    { name: 'Mom',          number: '+1 (555) 111-2222' },
  ];
  const c = contacts[Math.floor(Math.random() * contacts.length)];
  triggerIncomingCall(c.name, c.number);
});

async function triggerIncomingCall(name, number) {
  state.callerName   = name;
  state.callerNumber = number;
  state.callDirection = 'incoming';

  $('incoming-caller-name').textContent   = name;
  $('incoming-caller-number').textContent = number;
  $('incoming-avatar-letter').textContent = (name[0] || '?').toUpperCase();

  // AI Name Suggestion for Unknown
  if (name === 'Unknown') {
     try {
       const res = await apiRequest(`/ai/suggest-name?phone_number=${number}`);
       if (res.name !== 'Unknown Caller') {
         $('incoming-caller-name').innerHTML = `${name} <span style="font-size:12px; color:var(--primary-2); display:block; margin-top:4px">AI Hint: ${res.name}</span>`;
       }
     } catch {}
  }

  // AI Screening transcript reset
  $('screening-transcript').textContent = '"Hello, who\'s calling please?"';
  state.aiScreening = false;

  showScreen('incoming');

  // If auto-screening enabled, start after 1.5 s
  if (state.settings.aiScreening) {
    setTimeout(() => {
      if (state.screen === 'incoming') startAIScreening();
    }, 1500);
  }

  // Vibrate ringtone pattern
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
}

// ── AI Call Screening ──────────────────────────────
const screeningPhrases = [
  '"Hello, who\'s calling please?"',
  '"May I ask what this call is regarding?"',
  '"Are you a real person or an automated call?"',
  '"Hold on, let me connect you to the owner."',
];

function startAIScreening() {
  if (state.aiScreening) return;
  state.aiScreening = true;
  let idx = 1;
  $('ai-screen-btn').classList.add('active-ctrl');

  const interval = setInterval(() => {
    if (state.screen !== 'incoming' || !state.aiScreening) {
      clearInterval(interval);
      return;
    }
    if (idx < screeningPhrases.length) {
      $('screening-transcript').textContent = screeningPhrases[idx++];
    } else {
      clearInterval(interval);
    }
  }, 3500);
}

// ── Incoming Call Actions ──────────────────────────
$('accept-btn').addEventListener('click', () => {
  if (navigator.vibrate) navigator.vibrate(0);
  startActiveCall();
});

$('decline-btn').addEventListener('click', () => {
  if (navigator.vibrate) navigator.vibrate(0);
  state.aiScreening = false;
  showScreen('home');
  addRecentCall(state.callerName, state.callerNumber, 'missed', 0);
  showToast('Call declined');
});

$('ai-screen-btn').addEventListener('click', () => {
  startAIScreening();
  showToast('VR AI is screening this call…');
});

// ── Active Call ────────────────────────────────────
async function startActiveCall() {
  state.callStartTime = Date.now();
  state.transcript = [];
  state.isMuted    = false;
  state.isSpeaker  = false;
  state.isRecording = false;
  state.aiScreening = false;
  if (navigator.vibrate) navigator.vibrate(0);

  // Update header
  $('active-caller-name').textContent   = state.callerName;
  $('active-avatar-letter').textContent = (state.callerName[0] || '?').toUpperCase();
  $('active-avatar').style.background   = randomGradient(state.callerName);
  $('active-call-status').innerHTML     = `Connected · <span id="call-timer">00:00</span>`;
  $('speaker-name').textContent         = 'You';

  // Clear transcript UI
  const scroll = $('transcript-scroll');
  scroll.innerHTML = `<div class="transcript-placeholder">
    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    </svg>
    <p>Transcript will appear here…</p>
  </div>`;

  // Hide AI response box
  $('ai-response-box').classList.remove('visible');
  $('ai-thinking').classList.remove('visible');

  // Reset controls
  updateCtrlBtn('mute-btn', false);
  updateCtrlBtn('speaker-btn', false);
  updateCtrlBtn('ai-assist-btn', true);
  updateCtrlBtn('record-btn', false);

  showScreen('active');

  // Start timer
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(updateTimer, 1000);

  // Start waveform + mic
  await startAudio();

  // Start transcript if setting enabled
  if (state.settings.autoTranscript) {
    startSpeechRecognition();
  }

  // Keep website ALWAYS ACTIVE
  await requestWakeLock();
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - state.callStartTime) / 1000);
  state.callDuration = elapsed;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const timerEl = $('call-timer');
  if (timerEl) timerEl.textContent = `${mm}:${ss}`;
}

// ── Waveform & Audio ───────────────────────────────
async function startAudio() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.micStream = stream;
    state.audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
    state.analyser  = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 256;

    const src = state.audioCtx.createMediaStreamSource(stream);
    src.connect(state.analyser);

    drawWaveform();
  } catch {
    // Mic not available – draw animated fake waveform
    drawFakeWaveform();
  }
}

function stopAudio() {
  cancelAnimationFrame(state.animFrame);
  if (state.micStream) {
    state.micStream.getTracks().forEach(t => t.stop());
    state.micStream = null;
  }
  if (state.audioCtx) {
    state.audioCtx.close().catch(() => {});
    state.audioCtx = null;
  }
  state.analyser = null;
}

function drawWaveform() {
  const canvas = $('waveform-canvas');
  if (!canvas || !state.analyser) return;
  const ctx    = canvas.getContext('2d');
  const W      = canvas.offsetWidth;
  const H      = canvas.offsetHeight;
  canvas.width  = W * window.devicePixelRatio;
  canvas.height = H * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const bufferLen = state.analyser.frequencyBinCount;
  const dataArr   = new Uint8Array(bufferLen);

  function draw() {
    state.animFrame = requestAnimationFrame(draw);
    state.analyser.getByteTimeDomainData(dataArr);

    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#7C3AED');
    grad.addColorStop(1, '#06B6D4');
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 2.5;
    ctx.beginPath();

    const sliceW = W / bufferLen;
    let x = 0;
    for (let i = 0; i < bufferLen; i++) {
      const v = dataArr[i] / 128.0;
      const y = (v * H) / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sliceW;
    }
    ctx.lineTo(W, H / 2);
    ctx.stroke();
  }
  draw();
}

function drawFakeWaveform() {
  const canvas = $('waveform-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W   = canvas.offsetWidth;
  const H   = canvas.offsetHeight;
  canvas.width  = W * window.devicePixelRatio;
  canvas.height = H * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  let t = 0;
  function draw() {
    state.animFrame = requestAnimationFrame(draw);
    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#7C3AED');
    grad.addColorStop(1, '#06B6D4');
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      const y = H / 2 +
        Math.sin((x / W) * Math.PI * 6 + t) * 14 +
        Math.sin((x / W) * Math.PI * 12 + t * 1.3) * 7;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    t += 0.06;
  }
  draw();
}

// ── Speech Recognition (Live Transcript) ──────────
function startSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    // Simulate transcript for demo
    simulateTranscript();
    return;
  }

  const recog = new SR();
  recog.continuous    = true;
  recog.interimResults = true;
  recog.lang          = 'en-US';
  state.recognition   = recog;

  let interimId = null;

  recog.onresult = e => {
    let interim = '';
    let final   = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    if (final) {
      addTranscriptLine('You', final.trim());
      if (state.settings.aiAssist && state.isAIAssist) {
        generateAIReply(final.trim());
      }
    }
  };


  recog.onerror = (event) => {
    console.warn('Speech recognition error:', event.error);
    if (event.error === 'not-allowed') {
      showToast('Microphone access denied! Please allow mic permissions.');
    } else if (event.error === 'no-speech') {
      // Ignore silence timeout
    } else {
      simulateTranscript();
    }
  };
  
  recog.onend   = () => {
    // Restart if call still active
    if (state.screen === 'active') {
      try { recog.start(); } catch {}
    }
  };

  try { recog.start(); } catch {}
}

function stopSpeechRecognition() {
  if (state.recognition) {
    try { state.recognition.stop(); } catch {}
    state.recognition = null;
  }
}

// Simulated transcript for demo / browsers without SR
const demoTranscriptLines = [
  { speaker: 'Caller', text: 'Hey, how are you doing today?' },
  { speaker: 'You',    text: 'I\'m doing great, thanks for calling!' },
  { speaker: 'Caller', text: 'I was calling about the meeting tomorrow.' },
  { speaker: 'AI',     text: '📝 Reminder: Meeting scheduled for tomorrow at 10 AM.' },
  { speaker: 'You',    text: 'Yes, I\'ll be there. What time exactly?' },
  { speaker: 'Caller', text: 'Around 10 in the morning. Does that work for you?' },
  { speaker: 'You',    text: 'That works perfectly, see you then!' },
  { speaker: 'Caller', text: 'Great, talk to you later. Bye!' },
];

function simulateTranscript() {
  let idx = 0;
  const interval = setInterval(() => {
    if (state.screen !== 'active') { clearInterval(interval); return; }
    if (idx >= demoTranscriptLines.length) { clearInterval(interval); return; }
    const line = demoTranscriptLines[idx++];
    addTranscriptLine(line.speaker, line.text);
    if (line.speaker === 'You' && state.isAIAssist) {
      setTimeout(() => generateAIReply(line.text), 800);
    }
  }, 3500);
}

function addTranscriptLine(speaker, text) {
  const scroll = $('transcript-scroll');

  // Remove placeholder if present
  const placeholder = scroll.querySelector('.transcript-placeholder');
  if (placeholder) placeholder.remove();

  const speakerClass = speaker.toLowerCase() === 'you' ? 'you' :
                       speaker.toLowerCase() === 'ai'  ? 'ai' : 'caller';

  const row = el('div', 'transcript-line');
  const sp  = el('span', `transcript-speaker ${speakerClass}`, speaker);
  const bub = el('div', 'transcript-bubble', text);
  row.append(sp, bub);
  scroll.appendChild(row);
  scroll.scrollTop = scroll.scrollHeight;

  state.transcript.push({ speaker, text });

  // Update speaker label
  $('speaker-name').textContent = speaker;
}

// ── AI Reply Generation ────────────────────────────
const aiReplies = {
  'meeting'    : 'Sounds good! I\'ll make sure to prepare the agenda beforehand.',
  'time'       : 'That time works perfectly for me. I\'ll set a reminder.',
  'tomorrow'   : 'I\'ll have everything ready for tomorrow. No worries!',
  'call'       : 'Of course, I\'m happy to discuss this further.',
  'help'       : 'I\'d be happy to help you with that.',
  'problem'    : 'Let\'s work through this together and find a solution.',
  'price'      : 'I can check the current pricing and get back to you shortly.',
  'schedule'   : 'Let me pull up the calendar. What date works best for you?',
  'sorry'      : 'No worries at all! These things happen.',
  'great'      : 'That\'s wonderful to hear! Is there anything else I can help with?',
  'bye'        : 'It was great talking with you! Have a wonderful day.',
  'thanks'     : 'You\'re very welcome! Happy to help anytime.',
};

const defaultReplies = [
  'That\'s an interesting point. Could you tell me more?',
  'I understand. Let me think about the best way to respond.',
  'Thanks for sharing that. I\'ll keep it in mind.',
  'That makes sense. What would you suggest as the next step?',
  'Absolutely, I\'ll take care of that right away.',
];

async function generateAIReply(userText) {
  $('ai-thinking').classList.add('visible');
  $('ai-response-box').classList.remove('visible');

  await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));

  if (state.screen !== 'active') return;

  // Try backend first, fallback to local
  let reply = null;
  try {
    const res = await fetch(`${API_BASE}/ai/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: userText }),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      reply = data.reply;
    }
  } catch {}

  if (!reply) {
    const lc = userText.toLowerCase();
    for (const [key, val] of Object.entries(aiReplies)) {
      if (lc.includes(key)) { reply = val; break; }
    }
    if (!reply) reply = defaultReplies[Math.floor(Math.random() * defaultReplies.length)];
  }

  $('ai-thinking').classList.remove('visible');
  $('ai-response-text').textContent = reply;
  $('ai-response-box').classList.add('visible');
}

// ── Speak Reply (TTS) ──────────────────────────────
$('speak-reply-btn').addEventListener('click', () => {
  const text = $('ai-response-text').textContent;
  if (!text || !state.synth) return;
  state.synth.cancel();
  const utt   = new SpeechSynthesisUtterance(text);
  utt.rate    = 1.05;
  utt.pitch   = 1;
  utt.volume  = 1;
  // Pick a natural voice
  const voices = state.synth.getVoices();
  const en     = voices.find(v => v.lang.startsWith('en') && v.name.includes('Female')) ||
                 voices.find(v => v.lang.startsWith('en')) || voices[0];
  if (en) utt.voice = en;
  state.synth.speak(utt);
  showToast('VR AI speaking…');
});

// ── Call Controls ──────────────────────────────────
$('mute-btn').addEventListener('click', () => {
  state.isMuted = !state.isMuted;
  updateCtrlBtn('mute-btn', state.isMuted);
  showToast(state.isMuted ? 'Microphone muted' : 'Microphone on');
  if (state.micStream) {
    state.micStream.getTracks().forEach(t => t.enabled = !state.isMuted);
  }
});

$('speaker-btn').addEventListener('click', () => {
  state.isSpeaker = !state.isSpeaker;
  updateCtrlBtn('speaker-btn', state.isSpeaker);
  showToast(state.isSpeaker ? 'Speaker on' : 'Speaker off');
});

$('ai-assist-btn').addEventListener('click', () => {
  state.isAIAssist = !state.isAIAssist;
  updateCtrlBtn('ai-assist-btn', state.isAIAssist);
  showToast(state.isAIAssist ? 'AI Assist enabled' : 'AI Assist paused');
  if (!state.isAIAssist) {
    $('ai-response-box').classList.remove('visible');
    $('ai-thinking').classList.remove('visible');
  }
});

$('record-btn').addEventListener('click', () => {
  state.isRecording = !state.isRecording;
  updateCtrlBtn('record-btn', state.isRecording);
  showToast(state.isRecording ? '🔴 Recording started' : 'Recording stopped');
});

function updateCtrlBtn(id, active) {
  const btn = $(id);
  if (!btn) return;
  btn.classList.toggle('active-ctrl', active);
}

// ── End Call ───────────────────────────────────────
$('end-call-btn').addEventListener('click', endCall);

function endCall() {
  clearInterval(state.timerInterval);
  stopSpeechRecognition();
  stopAudio();
  releaseWakeLock();
  state.synth && state.synth.cancel();

  const duration = state.callDuration;
  addRecentCall(state.callerName, state.callerNumber, state.callDirection, duration);
  showSummary(duration);
}

// ── Call Summary ───────────────────────────────────
async function showSummary(duration) {
  const mm = String(Math.floor(duration / 60)).padStart(2, '0');
  const ss = String(duration % 60).padStart(2, '0');
  $('summary-duration').textContent = `${mm}:${ss}`;

  // Build transcript text
  const transcriptText = state.transcript
    .map(l => `${l.speaker}: ${l.text}`)
    .join('\n');
  $('summary-transcript-text').textContent = transcriptText || 'No transcript recorded.';

  // AI Summary
  $('summary-ai-text').textContent = 'Generating summary…';
  showScreen('summary');

  try {
    let summary = null;
    const res = await fetch(`${API_BASE}/ai/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: transcriptText, duration }),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      summary = data.summary;
    }
    if (!summary) throw new Error('fallback');
    $('summary-ai-text').textContent = summary;
  } catch {
    $('summary-ai-text').textContent = generateLocalSummary(duration);
  }
}

function generateLocalSummary(duration) {
  const dir  = state.callDirection;
  const name = state.callerName;
  const lines = state.transcript.length;
  const mm   = Math.floor(duration / 60);
  const ss   = duration % 60;

  if (duration < 10) {
    return `Brief ${dir} call ${dir === 'outgoing' ? 'to' : 'from'} ${name}. No significant conversation recorded.`;
  }
  return `${dir === 'outgoing' ? 'Outgoing call to' : 'Incoming call from'} ${name} lasting ${mm}m ${ss}s. ` +
    `${lines > 0 ? `${lines} exchanges were transcribed. ` : ''}` +
    `VR AI assisted with real-time transcription and suggested replies during the call.`;
}

// ── Share Summary ──────────────────────────────────
$('share-summary-btn').addEventListener('click', async () => {
  const text = `VR AI Call Summary\n` +
    `Contact: ${state.callerName}\n` +
    `Duration: ${$('summary-duration').textContent}\n\n` +
    `Summary: ${$('summary-ai-text').textContent}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'VR AI Call Summary', text });
    } else {
      await navigator.clipboard.writeText(text);
      showToast('Summary copied to clipboard');
    }
  } catch { showToast('Could not share summary'); }
});

$('done-btn').addEventListener('click', () => {
  dialerInput.value = '';
  showScreen('home');
});

// ── Voice Dial ─────────────────────────────────────
$('voice-dial-btn').addEventListener('click', () => {
  if (!state.settings.voiceDial) { showToast('Voice dial is disabled in settings'); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showToast('Voice recognition not supported'); return; }

  showToast('Listening… say a name or number');
  const r   = new SR();
  r.lang    = 'en-US';
  r.maxAlternatives = 1;
  r.onresult = e => {
    const spoken = e.results[0][0].transcript;
    // Check if it looks like a number
    const digits = spoken.replace(/\D/g, '');
    if (digits.length >= 5) {
      dialerInput.value = digits;
    } else {
      dialerInput.value = spoken;
    }
    showToast(`Dialing: ${spoken}`);
    setTimeout(() => initiateOutgoingCall(dialerInput.value, spoken), 800);
  };
  r.onerror = () => showToast('Could not recognise, please try again');
  r.start();
});

// ── Settings Modal ─────────────────────────────────
function buildSettingsModal() {
  if ($('settings-modal')) return;

  const overlay = document.createElement('div');
  overlay.id        = 'settings-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <h2 class="modal-title">VR AI Settings</h2>

      <div class="modal-row">
        <div>
          <div class="modal-row-label">AI Call Screening</div>
          <div class="modal-row-sub">Automatically screen incoming calls</div>
        </div>
        <button class="toggle ${state.settings.aiScreening ? 'on' : ''}" id="toggle-screening"></button>
      </div>

      <div class="modal-row">
        <div>
          <div class="modal-row-label">AI Assist During Call</div>
          <div class="modal-row-sub">Suggest smart replies in real-time</div>
        </div>
        <button class="toggle ${state.settings.aiAssist ? 'on' : ''}" id="toggle-assist"></button>
      </div>

      <div class="modal-row">
        <div>
          <div class="modal-row-label">Auto Transcript</div>
          <div class="modal-row-sub">Live speech-to-text during calls</div>
        </div>
        <button class="toggle ${state.settings.autoTranscript ? 'on' : ''}" id="toggle-transcript"></button>
      </div>

      <div class="modal-row">
        <div>
          <div class="modal-row-label">Voice Dial</div>
          <div class="modal-row-sub">Dial contacts by speaking their name</div>
        </div>
        <button class="toggle ${state.settings.voiceDial ? 'on' : ''}" id="toggle-voice"></button>
      </div>

      <button class="modal-close-btn" id="settings-close-btn">Done</button>
    </div>
  `;

  document.body.appendChild(overlay);

  // Toggle handlers
  const toggles = [
    ['toggle-screening',   'aiScreening'],
    ['toggle-assist',      'aiAssist'],
    ['toggle-transcript',  'autoTranscript'],
    ['toggle-voice',       'voiceDial'],
  ];
  toggles.forEach(([id, key]) => {
    $(id).addEventListener('click', function() {
      state.settings[key] = !state.settings[key];
      this.classList.toggle('on', state.settings[key]);
      saveSettings();
    });
  });

  $('settings-close-btn').addEventListener('click', closeSettings);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeSettings();
  });
}

function openSettings() {
  buildSettingsModal();
  requestAnimationFrame(() => $('settings-modal').classList.add('open'));
}
function closeSettings() {
  const m = $('settings-modal');
  if (m) m.classList.remove('open');
}

$('settings-btn').addEventListener('click', openSettings);

// ── Persist Settings ───────────────────────────────
function saveSettings() {
  localStorage.setItem('vrai-settings', JSON.stringify(state.settings));
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('vrai-settings'));
    if (s) Object.assign(state.settings, s);
  } catch {}
}

// ── Recent Calls ───────────────────────────────────
let recentCalls = JSON.parse(localStorage.getItem('vrai-recent') || '[]');

async function addRecentCall(name, number, direction, duration) {
  const now  = new Date();
  const entry = { name, number, direction, duration, time: now.toISOString() };
  
  // Save to local storage
  recentCalls.unshift(entry);
  if (recentCalls.length > 50) recentCalls.pop();
  localStorage.setItem('vrai-recent', JSON.stringify(recentCalls));
  
  // Save to DB if logged in
  if (authState.isLoggedIn) {
    try {
      await apiRequest('/call-logs', 'POST', {
        phone_number: number,
        direction,
        duration_seconds: duration,
        call_time: now.toISOString(),
        source: 'vr-ai-web'
      });
    } catch (err) { console.warn('Failed to save call log to DB:', err); }
  }
  
  refreshRecentList();
}

function refreshRecentList() {
  const list = $('recent-calls-list');
  if (!list || recentCalls.length === 0) return;

  list.innerHTML = '';
  recentCalls.slice(0, 5).forEach(c => {
    const div  = el('div', 'recent-item');
    const av   = el('div', 'recent-avatar', (c.name[0] || '?').toUpperCase());
    av.style.background = randomGradient(c.name);

    const info = el('div', 'recent-info');
    const nm   = el('span', 'recent-name', c.name);
    const meta = el('span', `recent-meta ${c.direction}`,
      `${c.direction === 'incoming' ? '↙' : c.direction === 'outgoing' ? '↗' : '↙⛔'} ` +
      `${capitalize(c.direction)} · ${formatDuration(c.duration)}`);
    info.append(nm, meta);

    const time = el('span', 'recent-time', formatRelativeTime(c.time));
    div.append(av, info, time);

    div.addEventListener('click', () => {
      dialerInput.value = c.number;
      initiateOutgoingCall(c.number, c.name);
    });

    list.appendChild(div);
  });
}

// ── Utils ──────────────────────────────────────────
function formatNumber(num) {
  return num.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3') || num;
}

function formatDuration(sec) {
  if (!sec || sec === 0) return 'Missed';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatRelativeTime(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hrs < 24)   return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(isoStr).toLocaleDateString('en-US', { weekday: 'short' });
}

function capitalize(str) {
  return str ? str[0].toUpperCase() + str.slice(1) : '';
}

function randomGradient(seed) {
  const gradients = [
    'linear-gradient(135deg,#7C3AED,#06B6D4)',
    'linear-gradient(135deg,#F59E0B,#EF4444)',
    'linear-gradient(135deg,#10B981,#06B6D4)',
    'linear-gradient(135deg,#EC4899,#7C3AED)',
    'linear-gradient(135deg,#3B82F6,#10B981)',
    'linear-gradient(135deg,#F97316,#EF4444)',
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash ^= seed.charCodeAt(i);
  return gradients[Math.abs(hash) % gradients.length];
}

// ── Screen 2 & 3 full-screen button fix ───────────
$('screen-incoming').style.zIndex = 10;
$('screen-outgoing').style.zIndex = 10;

// ── Service Worker ─────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ── Initialise ─────────────────────────────────────
async function init() {
  loadSettings();
  if (authState.isLoggedIn) {
    showScreen('home');
    refreshAppData();
  } else {
    showScreen('auth');
  }
  
  // Pre-load voices
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
}

async function refreshAppData() {
  await fetchContacts();
  refreshRecentList();
}

// ── Tab Navigation (Bottom Nav) ────────────────────
document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const tabName = btn.dataset.tab;
    // Update active button
    document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
    btn.classList.add('active');

    // Update active tab content
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');

    if(navigator.vibrate) navigator.vibrate(10);
  });
});

// ── Authentication Handlers ────────────────────────
let isSignUp = false;
$('auth-toggle').addEventListener('click', (e) => {
  e.preventDefault();
  isSignUp = !isSignUp;
  $('auth-title').textContent = isSignUp ? 'Create Account' : 'Welcome Back';
  $('auth-subtitle').textContent = isSignUp ? 'Start your AI journey today' : 'Sign in to your intelligent assistant';
  $('auth-submit-btn').textContent = isSignUp ? 'Sign Up' : 'Sign In';
  $('auth-toggle-text').innerHTML = isSignUp ? 
    'Already have an account? <a href="#" id="auth-toggle">Sign In</a>' :
    "Don't have an account? <a href=\"#\" id=\"auth-toggle\">Sign Up</a>";
  // Re-bind since we replaced HTML
  $('auth-toggle').addEventListener('click', (ev) => {
    ev.preventDefault();
    $('auth-toggle').click(); // recursive trigger trick or just re-run this logic
  });
});

$('auth-submit-btn').addEventListener('click', async () => {
  const email = $('auth-email').value;
  const password = $('auth-password').value;
  if (!email || !password) return showToast('Please fill in all fields');

  const endpoint = isSignUp ? '/auth/register' : '/auth/login';
  try {
    const res = await apiRequest(endpoint, 'POST', { email, password });
    authState.token = res.access_token;
    authState.isLoggedIn = true;
    localStorage.setItem('vrai-token', res.access_token);
    showToast('Signed in successfully!');
    showScreen('home');
    refreshAppData();
  } catch (err) {
    showToast(err.message || 'Authentication failed');
  }
});

// Generic API helper
async function apiRequest(path, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (authState.token) headers['Authorization'] = `Bearer ${authState.token}`;
  
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

// ── Contact Management ──────────────────────────────
async function fetchContacts() {
  try {
    const data = await apiRequest('/contacts');
    state.contacts = data.items;
    renderContacts();
  } catch {}
}

function renderContacts() {
  const list = $('contacts-list');
  if (!list) return;
  list.innerHTML = '';

  const grouped = {};
  state.contacts.forEach(c => {
    const char = c.name[0].toUpperCase();
    if (!grouped[char]) grouped[char] = [];
    grouped[char].push(c);
  });

  Object.keys(grouped).sort().forEach(char => {
    const group = el('div', 'contact-group');
    const letter = el('div', 'contact-letter', char);
    group.appendChild(letter);
    
    grouped[char].forEach(c => {
      const item = el('div', 'contact-item');
      const avatar = el('div', 'contact-avatar', char);
      avatar.style.background = randomGradient(c.name);
      
      const info = el('div', 'contact-info');
      const name = el('span', 'contact-name', c.name);
      if (c.tag && c.tag !== 'none') {
        const tag = el('span', `contact-tag-badge tag-${c.tag}`, c.tag);
        name.appendChild(tag);
      }
      const num = el('span', 'contact-number', c.phone_number);
      info.append(name, num);
      item.append(avatar, info);
      
      item.addEventListener('click', () => {
        openContactModal(c);
      });
      group.appendChild(item);
    });
    list.appendChild(group);
  });
}

const contactModal = $('contact-modal');
let editingContactId = null;

function openContactModal(contact = null) {
  editingContactId = contact ? contact.phone_number : null;
  $('contact-modal-title').textContent = contact ? 'Edit Contact' : 'New Contact';
  $('contact-name-input').value = contact ? contact.name : '';
  $('contact-phone-input').value = contact ? contact.phone_number : (dialerInput.value || '');
  $('contact-email-input').value = contact ? (contact.email || '') : '';
  $('contact-tag-input').value = contact ? (contact.tag || 'none') : 'none';
  $('delete-contact-btn').style.display = contact ? 'block' : 'none';
  
  contactModal.classList.add('open');
}

function closeContactModal() {
  contactModal.classList.remove('open');
}

$('contact-close-btn').addEventListener('click', closeContactModal);
document.querySelector('.add-contact-btn').addEventListener('click', () => openContactModal());

$('save-contact-btn').addEventListener('click', async () => {
  const name = $('contact-name-input').value;
  const num = $('contact-phone-input').value;
  const email = $('contact-email-input').value;
  const tag = $('contact-tag-input').value;
  
  if (!name || !num) return showToast('Name and Number are required');
  
  try {
    await apiRequest('/contacts', 'POST', { name, phone_number: num, email, tag });
    showToast('Contact saved');
    fetchContacts();
    closeContactModal();
  } catch (err) {
    showToast(err.message);
  }
});

$('delete-contact-btn').addEventListener('click', async () => {
  if (!editingContactId) return;
  if (!confirm('Are you sure you want to delete this contact?')) return;
  
  try {
    await apiRequest(`/contacts/${editingContactId}`, 'DELETE');
    showToast('Contact deleted');
    fetchContacts();
    closeContactModal();
  } catch (err) {
    showToast(err.message);
  }
});

// Search functionality
$('contact-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('.contact-item').forEach(item => {
    const name = item.querySelector('.contact-name').textContent.toLowerCase();
    const num = item.querySelector('.contact-number').textContent.toLowerCase();
    item.style.display = (name.includes(q) || num.includes(q)) ? 'flex' : 'none';
  });
  // Hide empty groups
  document.querySelectorAll('.contact-group').forEach(group => {
    const hasVisible = [...group.querySelectorAll('.contact-item')].some(ti => ti.style.display !== 'none');
    group.style.display = hasVisible ? 'block' : 'none';
  });
});

init();

