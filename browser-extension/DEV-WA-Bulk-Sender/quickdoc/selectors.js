// DEV WA Bulk Sender — Quick Doc: WhatsApp Web DOM selectors (EK HI JAGAH)
//
// WhatsApp apna DOM aksar badalta hai. Quick Doc ka DOM wala kaam (Attach Only
// mode aur fallback) kuch todne lage to SIRF yeh file update karo.
// Har entry me kai options hai (data-icon, aria-label, role, data-tab) — jo
// pehle mile wo use hota hai. Console me "[QuickDoc]" wale warnings dekho.
//
// Note: bulk sender (content.js) ke apne selectors abhi wahi file me hai.
var QD_SEL = {
  main: '#main',
  sidePane: '#side',
  // Open chat ka header (pehli line = contact/group ka naam)
  chatHeader: '#main header',

  // Neeche wala message box
  composeBox: [
    'footer div[contenteditable="true"]',
    '#main div[contenteditable="true"][data-tab="10"]',
    '#main [role="textbox"][contenteditable="true"]'
  ],

  // Attach (clip / plus) button — compose box ke left me  ⚠ sabse zyada badalta hai
  attachBtn: [
    '#main footer [data-icon="plus-rounded"]',
    '#main footer [data-icon="plus"]',
    '#main footer [data-icon="clip"]',
    '#main footer [data-icon="attach-menu-plus"]',
    '#main footer [aria-label="Attach" i]',
    '#main footer [title="Attach" i]',
    '#main [data-icon="plus-rounded"]',
    '#main [data-icon="plus"]',
    '#main [data-icon="clip"]'
  ],

  // Attach menu ke hidden <input type="file">. Document wale ka accept="*" hota hai,
  // Photos & videos wale me "image/…,video/…".  ⚠ badal sakta hai
  fileInput: 'input[type="file"]',
  docInputAccept: /^(\*|\*\/\*)?$/,
  mediaInputAccept: /image|video/i,

  // Preview screen (caption box / send button) ko "naye elements" se pehchanta hai
  editable: 'div[contenteditable="true"]',
  sendIcon: ['[data-icon*="send" i]'],
  sendLabel: /^(send|भेजें|भेजे|મોકલો|મોકલવું)$/i,

  // Preview band karne ka X button  ⚠
  closeBtn: [
    '[data-icon="x"]',
    '[data-icon="x-alt"]',
    '[data-icon="close"]',
    '[data-icon="ic-close"]',
    '[aria-label="Close" i]',
    '[aria-label="Cancel" i]'
  ],
  dialog: ['div[role="dialog"]', '[data-animate-modal-popup="true"]'],
  discardLabel: /^(discard|हटाएं|हटाएँ|रद्द करें|કાઢી નાખો)$/i,
  invalidText: /invalid|isn.t on whatsapp|not on whatsapp/i,

  // Drag & drop fallback yahan girta hai
  dropZone: ['#main'],

  // Chat me apne bheje hue messages (send confirm ke liye)  ⚠
  outgoingMsg: '#main .message-out',
  pendingIcon: '#main [data-icon="msg-time"]',
  loggedOut: 'canvas[aria-label*="Scan" i], div[data-ref] canvas'
};
