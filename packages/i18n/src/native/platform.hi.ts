/** Native-only strings for the platform screens: tab names, the release gate, "Open on the web" (apps/native). Top-level keys become `native.<key>.*`. Keep en and hi identical in shape. */
export const platformHi = {
  tabs: {
    press: "प्रेस",
  },
  gate: {
    checking: "यह वर्जन जांच रहे हैं",
    blockedTitle: "orrn इस फोन पर नहीं खुल सकता",
    blocked: {
      below_min_build: "orrn का यह वर्जन बहुत पुराना है। नया वर्जन इंस्टॉल करें, फिर दोबारा खोलें।",
      revoked: "इस फोन को इस प्लांट के लिए बंद कर दिया गया है। एडमिन से इसे फिर चालू करने को कहें।",
      never_checked: "orrn इस वर्जन को जांच नहीं सका। इंटरनेट से जुड़ें और फिर जांचें।",
      grace_expired: "orrn 24 घंटे से ज्यादा समय से अपडेट नहीं जांच सका। इंटरनेट से जुड़ें और फिर जांचें।",
      last_blocked: "orrn का यह वर्जन नहीं खुल सकता। इंटरनेट से जुड़ें और फिर जांचें।",
    },
    latest: "नया वर्जन {version} है।",
    getLatest: "नया वर्जन लें",
    graceNote: "अपडेट नहीं जांच सके। यह वर्जन {time} तक खुल सकता है।",
  },
  web: {
    title: "वेब पर खोलें",
    hint: "ब्राउजर में खुलता है",
    team: "टीम",
    shifts: "शिफ्ट",
    standards: "स्टैंडर्ड",
    backup: "बैकअप",
  },
} as const;
