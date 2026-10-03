# Hindi review

For Lalubhai. Every Hindi string in orrn, next to the English it comes from.

This file is generated from `packages/i18n` by `bun run --cwd packages/i18n export-review`. Don't edit it by hand. Send corrections as "key: new Hindi" (for example `pack.new.saveBundle: Bundle सेव करो`) and we update `hi.ts` and regenerate.

What to check:

1. Would someone on the floor understand it on first read?
2. Is it the word the plant actually uses? (for example ग्राहक or पार्टी, रद्द or कैंसल)
3. Words kept in English on purpose: bundle, die, dispatch, PO, kg, kg/12ft, serial numbers, codes, numbers, orrn. Tell us if any of these should be Hindi, or if more words should stay English.

Counts: 752 screen strings in 25 groups, 10 guides with 182 strings.

## Screen strings

### common (57)

| Key | English | हिंदी |
|---|---|---|
| `appName` | orrn | orrn |
| `save` | Save | सेव करें |
| `saving` | Saving | सेव हो रहा है |
| `saved` | Saved | सेव हो गया |
| `cancel` | Cancel | रहने दें |
| `close` | Close | बंद करें |
| `back` | Back | वापस |
| `next` | Next | आगे |
| `done` | Done | हो गया |
| `edit` | Edit | बदलें |
| `remove` | Remove | हटाएं |
| `delete` | Delete | डिलीट करें |
| `add` | Add | जोड़ें |
| `create` | Create | बनाएं |
| `confirm` | Confirm | पक्का करें |
| `continue` | Continue | आगे बढ़ें |
| `search` | Search | खोजें |
| `filter` | Filter | फ़िल्टर |
| `sort` | Sort | क्रम से लगाएं |
| `sortMostKg` | Most kg | सबसे ज़्यादा kg |
| `sortAZ` | A to Z | A से Z |
| `all` | All | सभी |
| `loading` | Loading | लोड हो रहा है |
| `retry` | Try again | फिर से कोशिश करें |
| `more` | More | और |
| `moreActions` | More actions | और विकल्प |
| `howTo` | How to | कैसे करें |
| `optional` | Optional | ज़रूरी नहीं |
| `required` | Required | ज़रूरी |
| `yes` | Yes | हाँ |
| `no` | No | नहीं |
| `notes` | Notes | नोट |
| `details` | Details | जानकारी |
| `advanced` | Advanced | एडवांस |
| `print` | Print | प्रिंट करें |
| `download` | Download | डाउनलोड करें |
| `share` | Share | शेयर करें |
| `copy` | Copy | कॉपी करें |
| `copied` | Copied | कॉपी हो गया |
| `showMore` | Show more | और दिखाएं |
| `previousPage` | Previous page | पिछला पेज |
| `nextPage` | Next page | अगला पेज |
| `pageRange` | {from}-{to} of {total} | {total} में से {from}-{to} |
| `today` | Today | आज |
| `yesterday` | Yesterday | कल |
| `total` | Total | कुल |
| `language` | Language | भाषा |
| `english` | English | English |
| `hindi` | हिंदी | हिंदी |
| `theme` | Theme | थीम |
| `themeSystem` | Match device | डिवाइस के हिसाब से |
| `themeLight` | Light | लाइट |
| `themeDark` | Dark | डार्क |
| `openMenu` | Open menu | मेन्यू खोलें |
| `demoData` | Demo data | डेमो डेटा |
| `noResults` | Nothing matches "{query}" | "{query}" से कुछ नहीं मिला |
| `by` | by {name} | {name} द्वारा |

### units (10)

| Key | English | हिंदी |
|---|---|---|
| `kg` | kg | kg |
| `kgPer12ft` | kg/12ft | kg/12ft |
| `pcs` | pcs | pcs |
| `mm` | mm | mm |
| `inch` | in | in |
| `ft` | ft | ft |
| `bundles` | {count} {count:bundle\|bundles} | {count} bundle |
| `pieces` | {count} {count:piece\|pieces} | {count} पीस |
| `bundlesKg` | {bundles} {bundles:bundle\|bundles} · {kg} kg | {bundles} bundle · {kg} kg |
| `feetInches` | {ft} ft {in} in | {ft} ft {in} in |

### status (30)

| Key | English | हिंदी |
|---|---|---|
| `bundle.available` | In stock | स्टॉक में |
| `bundle.reserved` | Held | होल्ड पर |
| `bundle.dispatched` | Dispatched | Dispatch हो गया |
| `bundle.void` | Void | रद्द |
| `dispatch.draft` | Building | बन रहा है |
| `dispatch.reserved` | Held | होल्ड पर |
| `dispatch.completed` | Dispatched | Dispatch हो गया |
| `dispatch.cancelled` | Cancelled | कैंसल |
| `die.active` | Active | चालू |
| `die.archived` | Archived | बंद |
| `range.inRange` | In range | रेंज में |
| `range.below` | Below range | रेंज से कम |
| `range.above` | Above range | रेंज से ज़्यादा |
| `range.noRange` | No range set | रेंज नहीं डाली |
| `printJob.queued` | Waiting | इंतज़ार में |
| `printJob.sent` | Sent to printer | प्रिंटर को भेजा |
| `printJob.success` | Printed | प्रिंट हो गया |
| `printJob.failed` | Failed | फ़ेल |
| `printer.online` | Online | ऑनलाइन |
| `printer.offline` | Offline | ऑफ़लाइन |
| `printSetup.pending` | Waiting to connect | जुड़ने का इंतज़ार |
| `printSetup.active` | Connected | जुड़ा है |
| `printSetup.offline` | Not connected | जुड़ा नहीं है |
| `printSetup.revoked` | Turned off | बंद किया गया |
| `printSetup.none` | Not set up | सेट नहीं है |
| `request.pending` | Waiting | इंतज़ार में |
| `request.approved` | Approved | मंज़ूर |
| `request.rejected` | Rejected | नामंज़ूर |
| `company.active` | Active | चालू |
| `company.suspended` | Suspended | रोकी गई |

### roles (13)

| Key | English | हिंदी |
|---|---|---|
| `owner` | Owner | मालिक |
| `admin` | Admin | एडमिन |
| `manager` | Manager | मैनेजर |
| `office` | Office | ऑफ़िस |
| `accountant` | Accountant | अकाउंटेंट |
| `supervisor` | Supervisor | सुपरवाइज़र |
| `packer` | Packer | पैकर |
| `foundry` | Foundry | फाउंड्री |
| `press` | Press | प्रेस |
| `storekeeper` | Storekeeper | स्टोरकीपर |
| `die_room` | Die room | डाई रूम |
| `operator` | Operator | ऑपरेटर |
| `viewer` | Viewer | व्यूअर |

### platformRoles (3)

| Key | English | हिंदी |
|---|---|---|
| `super_admin` | Super admin | सुपर एडमिन |
| `admin` | Admin | एडमिन |
| `support` | Support | सपोर्ट |

### nav (36)

| Key | English | हिंदी |
|---|---|---|
| `main` | Main | मुख्य |
| `today` | Today | आज |
| `pack` | Pack | पैकिंग |
| `scan` | Scan | स्कैन |
| `stock` | Stock | स्टॉक |
| `dispatch` | Dispatch | Dispatch |
| `more` | More | और |
| `dies` | Dies | Die |
| `customers` | Customers | ग्राहक |
| `printing` | Printing | प्रिंटिंग |
| `guides` | Guides | गाइड |
| `settings` | Settings | सेटिंग्स |
| `account` | Account | अकाउंट |
| `signOut` | Sign out | साइन आउट |
| `skipToContent` | Skip to content | मुख्य हिस्से पर जाएं |
| `scanOrSearch` | Scan or search | स्कैन करें या खोजें |
| `paletteHint` | Type a serial, dispatch code, die or customer | Serial, dispatch कोड, die या ग्राहक लिखें |
| `palettePages` | Pages | पेज |
| `paletteBundles` | Bundles | Bundle |
| `paletteDispatches` | Dispatches | Dispatch |
| `paletteDies` | Dies | Die |
| `paletteCustomers` | Customers | ग्राहक |
| `signedInAs` | Signed in as {email} | {email} से साइन इन |
| `adminOverview` | Overview | सारांश |
| `adminCompanies` | Companies | कंपनियां |
| `adminRequests` | Access requests | एक्सेस रिक्वेस्ट |
| `adminRequestsShort` | Requests | रिक्वेस्ट |
| `adminStaff` | Staff | स्टाफ़ |
| `openAccount` | Account and more | अकाउंट और बाकी पेज |
| `home` | orrn home | orrn होम |
| `godseye` | Godseye | Godseye |
| `godseyeHome` | Godseye home | Godseye होम |
| `paletteOpenBundle` | Open bundle {serial} | Bundle {serial} खोलें |
| `paletteResults` | {count} {count:result\|results} | {count} {count:नतीजा\|नतीजे} |
| `paletteMove` | Move | ऊपर-नीचे जाएं |
| `paletteOpen` | Open | खोलें |

### auth (43)

| Key | English | हिंदी |
|---|---|---|
| `login.title` | Sign in | साइन इन करें |
| `login.subtitle` | Use your work email. | अपना काम का ईमेल डालें। |
| `login.email` | Email | ईमेल |
| `login.password` | Password | पासवर्ड |
| `login.submit` | Sign in | साइन इन करें |
| `login.submitting` | Signing in | साइन इन हो रहा है |
| `login.wrongCredentials` | Email or password is wrong. Check both and try again. | ईमेल या पासवर्ड गलत है। दोनों जांचें और फिर से कोशिश करें। |
| `login.newHere` | New to orrn? | orrn पर नए हैं? |
| `login.requestAccess` | Request access | एक्सेस मांगें |
| `totp.title` | Enter your code | अपना कोड डालें |
| `totp.body` | Open your authenticator app and type the 6-digit code for orrn. | अपना authenticator ऐप खोलें और orrn वाला 6 अंकों का कोड लिखें। |
| `totp.code` | 6-digit code | 6 अंकों का कोड |
| `totp.submit` | Verify | जांचें |
| `totp.wrongCode` | That code didn't work. Codes change every 30 seconds, so type the newest one. | यह कोड नहीं चला। कोड हर 30 सेकंड में बदलता है, इसलिए सबसे नया कोड डालें। |
| `requestAccess.title` | Request access | एक्सेस मांगें |
| `requestAccess.subtitle` | Tell us about your plant and we'll get in touch to set up your company. | अपने प्लांट के बारे में बताएं। आपकी कंपनी सेट करने के लिए हम संपर्क करेंगे। |
| `requestAccess.company` | Company name | कंपनी का नाम |
| `requestAccess.name` | Your name | आपका नाम |
| `requestAccess.workEmail` | Work email | काम का ईमेल |
| `requestAccess.lines` | Extrusion lines | एक्सट्रूज़न लाइनें |
| `requestAccess.preferredDate` | Preferred date | पसंद की तारीख |
| `requestAccess.preferredTime` | Preferred time | पसंद का समय |
| `requestAccess.notes` | Anything else we should know | और कुछ जो हमें पता होना चाहिए |
| `requestAccess.submit` | Send request | रिक्वेस्ट भेजें |
| `requestAccess.successTitle` | Request sent | रिक्वेस्ट भेज दी |
| `requestAccess.successBody` | We have your request. We'll reply to {email}. | आपकी रिक्वेस्ट मिल गई। हम {email} पर जवाब देंगे। |
| `requestAccess.backHome` | Back to home | होम पर वापस |
| `invite.title` | Join {company} | {company} से जुड़ें |
| `invite.subtitle` | You're joining as {role}. | आप {role} के रूप में जुड़ रहे हैं। |
| `invite.genericTitle` | Join your team on orrn | orrn पर अपनी टीम से जुड़ें |
| `invite.name` | Your name | आपका नाम |
| `invite.email` | Email | ईमेल |
| `invite.password` | Password | पासवर्ड |
| `invite.passwordHint` | At least 8 characters. | कम से कम 8 अक्षर। |
| `invite.submit` | Create account and join | अकाउंट बनाएं और जुड़ें |
| `invite.existingAccount` | This email already has an account. Sign in to join. | इस ईमेल का अकाउंट पहले से है। जुड़ने के लिए साइन इन करें। |
| `invite.expired` | This invite link has expired or was already used. Ask your admin for a new one. | यह इनवाइट लिंक पुराना हो गया है या पहले ही इस्तेमाल हो चुका है। अपने एडमिन से नया लिंक मांगें। |
| `noAccess.title` | Your account isn't in a company yet | आपका अकाउंट अभी किसी कंपनी में नहीं है |
| `noAccess.body` | You're signed in as {email}. | आप {email} से साइन इन हैं। |
| `noAccess.ask` | Ask your admin to invite this email. | अपने एडमिन से इस ईमेल को इनवाइट करने के लिए कहें। |
| `noAccess.switchAccount` | Sign out and use another account | साइन आउट करें और दूसरा अकाउंट इस्तेमाल करें |
| `sessionExpired` | Your session ended. Sign in again. | आपका सेशन खत्म हो गया। फिर से साइन इन करें। |
| `signOut` | Sign out | साइन आउट |

### welcome (31)

| Key | English | हिंदी |
|---|---|---|
| `title` | Welcome to orrn | orrn में आपका स्वागत है |
| `subtitle` | A few steps before you start. | शुरू करने से पहले कुछ कदम। |
| `steps.password` | Password | पासवर्ड |
| `steps.twoFactor` | Two-factor | टू-फ़ैक्टर |
| `steps.company` | Company details | कंपनी की जानकारी |
| `steps.done` | Done | हो गया |
| `password.title` | Set your password | अपना पासवर्ड बनाएं |
| `password.body` | You'll use this with your email to sign in. | साइन इन करने के लिए आप ईमेल के साथ यही पासवर्ड डालेंगे। |
| `password.newPassword` | New password | नया पासवर्ड |
| `password.confirmPassword` | Type it again | फिर से लिखें |
| `password.hint` | At least 8 characters. | कम से कम 8 अक्षर। |
| `password.mismatch` | The two passwords don't match. | दोनों पासवर्ड एक जैसे नहीं हैं। |
| `password.submit` | Save password | पासवर्ड सेव करें |
| `twoFactor.title` | Turn on two-factor | टू-फ़ैक्टर चालू करें |
| `twoFactor.body` | Scan this QR code with an authenticator app, then type the 6-digit code it shows. | इस QR कोड को authenticator ऐप से स्कैन करें, फिर ऐप में दिख रहा 6 अंकों का कोड लिखें। |
| `twoFactor.manualKey` | Can't scan it? Type this key in the app instead. | स्कैन नहीं हो रहा? यह key ऐप में लिख दें। |
| `twoFactor.code` | 6-digit code | 6 अंकों का कोड |
| `twoFactor.backupTitle` | Backup codes | बैकअप कोड |
| `twoFactor.backupBody` | Keep these somewhere safe. Each one works once if you lose your phone. | इन्हें संभाल कर रखें। फ़ोन खो जाए तो हर कोड एक बार काम करेगा। |
| `twoFactor.submit` | Turn on two-factor | टू-फ़ैक्टर चालू करें |
| `company.title` | Company details | कंपनी की जानकारी |
| `company.body` | Tell us where your plant is and how to reach you. | बताएं कि आपका प्लांट कहां है और आपसे कैसे संपर्क करें। |
| `company.location` | Location | जगह |
| `company.contact` | Contact phone | संपर्क फ़ोन |
| `company.timezone` | Time zone | टाइम ज़ोन |
| `company.presses` | Number of presses | प्रेस की संख्या |
| `company.terms` | I agree to the orrn terms of service | मुझे orrn की सेवा शर्तें मंज़ूर हैं |
| `company.submit` | Save and continue | सेव करें और आगे बढ़ें |
| `done.title` | You're set up | सब तैयार है |
| `done.body` | Your account is ready. | आपका अकाउंट तैयार है। |
| `done.go` | Go to Today | आज का पेज खोलें |

### today (29)

| Key | English | हिंदी |
|---|---|---|
| `title` | Today | आज |
| `greetingMorning` | Good morning, {name} | नमस्ते, {name} |
| `greetingAfternoon` | Good afternoon, {name} | नमस्ते, {name} |
| `greetingEvening` | Good evening, {name} | नमस्ते, {name} |
| `kgPacked` | kg packed today | आज पैक हुआ kg |
| `bundlesPacked` | Bundles packed today | आज पैक हुए bundle |
| `kgDispatched` | kg dispatched today | आज dispatch हुआ kg |
| `inStock` | In stock | स्टॉक में |
| `tiles.pack` | Pack | पैकिंग |
| `tiles.packHint` | Start a packing session | पैकिंग सेशन शुरू करें |
| `tiles.dispatch` | Dispatch | Dispatch |
| `tiles.dispatchHint` | {count} open | {count} {count:खुला\|खुले} |
| `tiles.stock` | Stock | स्टॉक |
| `tiles.stockHint` | Bundles by section | सेक्शन के हिसाब से bundle |
| `tiles.guides` | Guides | गाइड |
| `tiles.guidesHint` | How each job is done | हर काम कैसे करें |
| `openDispatches` | Open dispatches | खुले dispatch |
| `noOpenDispatches` | No open dispatches. | कोई dispatch खुला नहीं है। |
| `sessionsToday` | Packed today | आज की पैकिंग |
| `noSessionsToday` | Nothing packed yet today. | आज अभी कुछ पैक नहीं हुआ। |
| `printProblems` | Print problems | प्रिंट की दिक्कतें |
| `printProblemsCount` | {count} {count:label\|labels} didn't print | {count} लेबल प्रिंट नहीं {count:हुआ\|हुए} |
| `openPrinting` | Open printing | प्रिंटिंग खोलें |
| `startHere.title` | Start here | यहां से शुरू करें |
| `startHere.body` | Four things to set up before the floor starts using orrn. | फ़्लोर पर orrn चलाने से पहले ये चार काम कर लें। |
| `startHere.addDie` | Add a die | Die जोड़ें |
| `startHere.addCustomer` | Add a customer | ग्राहक जोड़ें |
| `startHere.packFirst` | Pack your first bundles | पहले bundle पैक करें |
| `startHere.connectPrinter` | Connect a label printer | लेबल प्रिंटर जोड़ें |

### pack (52)

| Key | English | हिंदी |
|---|---|---|
| `title` | Pack | पैकिंग |
| `newSession` | New packing session | नया पैकिंग सेशन |
| `columns.session` | Session | सेशन |
| `columns.die` | Die | Die |
| `columns.section` | Section | सेक्शन |
| `columns.bundles` | Bundles | Bundle |
| `columns.kg` | kg | kg |
| `columns.packedBy` | Packed by | किसने पैक किया |
| `columns.when` | When | कब |
| `empty` | No packing sessions yet. | अभी कोई पैकिंग सेशन नहीं है। |
| `emptyAction` | Start a packing session | पैकिंग सेशन शुरू करें |
| `new.title` | New packing session | नया पैकिंग सेशन |
| `new.steps.die` | Die and defaults | Die और कट लंबाई |
| `new.steps.bundles` | Bundles | Bundle |
| `new.steps.review` | Review and save | जांचें और सेव करें |
| `new.dieSearch` | Search die code or section | Die कोड या सेक्शन से खोजें |
| `new.recentDies` | Recent | हाल के |
| `new.dieRange` | Range {min} to {max} kg/12ft | रेंज {min} से {max} kg/12ft |
| `new.noDies` | No dies match. Check the code, or add the die first. | कोई die नहीं मिला। कोड जांचें, या पहले die जोड़ें। |
| `new.chooseDie` | Choose this die | यह die चुनें |
| `new.changeDie` | Change die | Die बदलें |
| `new.cutLength` | Cut length | कट लंबाई |
| `new.cutLengthFeet` | Feet | फ़ुट |
| `new.cutLengthInches` | Inches | इंच |
| `new.po` | PO | PO |
| `new.defaultsHint` | Every bundle in this session uses this cut length and PO unless you change it on that bundle. | इस सेशन के हर bundle में यही कट लंबाई और PO लगेगा, जब तक आप उस bundle पर इसे न बदलें। |
| `new.weight` | Weight (kg) | वज़न (kg) |
| `new.pieces` | Pieces | पीस |
| `new.saveBundle` | Save bundle | Bundle सेव करें |
| `new.differentLengthPo` | Different length or PO | अलग लंबाई या PO |
| `new.editBundle` | Edit bundle | Bundle बदलें |
| `new.removeBundle` | Remove bundle | Bundle हटाएं |
| `new.bundleNumber` | Bundle {n} | Bundle {n} |
| `new.review` | Review | जांचें |
| `new.totalBundles` | Bundles | Bundle |
| `new.totalPieces` | Pieces | पीस |
| `new.totalKg` | kg | kg |
| `new.saveAndPrint` | Save and print labels | सेव करें और लेबल प्रिंट करें |
| `new.saveOnly` | Save session | सेशन सेव करें |
| `new.saved` | Session saved | सेशन सेव हो गया |
| `new.printingProgress` | Printing {done} of {total} | प्रिंट: {total} में से {done} |
| `new.printFailed` | {count} {count:label\|labels} didn't print | {count} लेबल प्रिंट नहीं {count:हुआ\|हुए} |
| `new.retryFailed` | Retry failed labels | फ़ेल हुए लेबल फिर से प्रिंट करें |
| `new.draftKept` | Your unsaved bundles are still here. | आपके बिना सेव किए bundle अभी भी यहां हैं। |
| `new.discardDraft` | Discard unsaved bundles | बिना सेव किए bundle हटा दें |
| `detail.title` | Session {code} | सेशन {code} |
| `detail.packedBy` | Packed by {name} | {name} ने पैक किया |
| `detail.printAll` | Print all labels | सारे लेबल प्रिंट करें |
| `detail.reprint` | Reprint | फिर से प्रिंट करें |
| `detail.labelsSent` | Labels sent to printer | लेबल प्रिंटर को भेज दिए |
| `detail.labelSent` | Label sent to printer | लेबल प्रिंटर को भेज दिया |
| `detail.viewBundle` | Open bundle {serial} | Bundle {serial} खोलें |

### scan (37)

| Key | English | हिंदी |
|---|---|---|
| `title` | Scan | स्कैन |
| `manualLabel` | Serial or label link | Serial या लेबल लिंक |
| `manualHint` | Type it or use a barcode scanner, then press Enter. | लिखें या बारकोड स्कैनर से स्कैन करें, फिर Enter दबाएं। |
| `find` | Find | खोजें |
| `pointAtLabel` | Point the camera at the bundle label | कैमरा bundle के लेबल की तरफ़ रखें |
| `cameraTitle` | Use the camera to scan | स्कैन के लिए कैमरा चालू करें |
| `cameraBody` | orrn uses the camera only to read bundle labels. | orrn कैमरे से सिर्फ़ bundle के लेबल पढ़ता है। |
| `allowCamera` | Turn on camera | कैमरा चालू करें |
| `cameraBlocked` | The camera is blocked. Allow it in your browser or phone settings, or type the serial below. | कैमरा बंद है। ब्राउज़र या फ़ोन की सेटिंग में इसे चालू करें, या नीचे serial लिखें। |
| `noCamera` | No camera found. Type the serial below. | कैमरा नहीं मिला। नीचे serial लिखें। |
| `cameraStarting` | Starting the camera | कैमरा चालू हो रहा है |
| `cameraFailed` | The camera didn't start. Type the serial below, or try again. | कैमरा चालू नहीं हुआ। नीचे serial लिखें, या फिर से कोशिश करें। |
| `cameraOff` | Turn off camera | कैमरा बंद करें |
| `ambiguous` | More than one bundle has this number. Pick the right one. | इस नंबर के एक से ज़्यादा bundle हैं। सही वाला चुनें। |
| `madeIn` | Made in {year} | {year} में बना |
| `recent` | Recent scans | हाल के स्कैन |
| `torchOn` | Turn torch on | टॉर्च चालू करें |
| `torchOff` | Turn torch off | टॉर्च बंद करें |
| `notFound` | Not found in this company | इस कंपनी में नहीं मिला |
| `unrecognised` | That isn't a bundle serial or label link. Check it and try again. | यह bundle का serial या लेबल लिंक नहीं है। देखकर फिर से कोशिश करें। |
| `continuous.title` | Scanning into {code} | {code} में स्कैन हो रहा है |
| `continuous.added` | Added {serial} | {serial} जुड़ गया |
| `continuous.count` | {count} added | {count} {count:जुड़ा\|जुड़े} |
| `continuous.already` | Already in this dispatch | इस dispatch में पहले से है |
| `continuous.heldElsewhere` | Held for another dispatch | किसी दूसरे dispatch के लिए होल्ड पर है |
| `continuous.void` | This bundle is void | यह bundle रद्द है |
| `continuous.dispatched` | Already dispatched | पहले ही dispatch हो चुका है |
| `continuous.wrongStatus` | Can't add a bundle that is {status} | "{status}" वाला bundle नहीं जोड़ सकते |
| `continuous.heldBy` | Held for {code} | {code} के लिए होल्ड पर है |
| `continuous.adding` | Adding {serial} | {serial} जोड़ रहे हैं |
| `continuous.closed` | This dispatch can't take more bundles now. | इस dispatch में अब और bundle नहीं जुड़ सकते। |
| `continuous.empty` | Scan a bundle label to add it. | जोड़ने के लिए bundle का लेबल स्कैन करें। |
| `continuous.result.added` | Added | जुड़ा |
| `continuous.result.already` | Already added | पहले से जुड़ा |
| `continuous.result.rejected` | Not added | नहीं जुड़ा |
| `continuous.result.notFound` | Not found | नहीं मिला |
| `continuous.done` | Done scanning | स्कैन बंद करें |

### stock (23)

| Key | English | हिंदी |
|---|---|---|
| `title` | Stock | स्टॉक |
| `sections` | Sections | सेक्शन |
| `bundles` | Bundles | Bundle |
| `searchSections` | Search die or section | Die या सेक्शन खोजें |
| `totals` | {bundles} {bundles:bundle\|bundles} · {kg} kg in stock | स्टॉक में {bundles} bundle · {kg} kg |
| `heldChip` | {count} held | {count} होल्ड पर |
| `empty` | No stock yet. Bundles show up here after packing. | अभी स्टॉक नहीं है। पैकिंग के बाद bundle यहां दिखेंगे। |
| `emptyAction` | Start a packing session | पैकिंग सेशन शुरू करें |
| `section.title` | Section {code} | सेक्शन {code} |
| `section.empty` | No bundles with this status. | इस स्टेटस का कोई bundle नहीं है। |
| `list.title` | All bundles | सारे bundle |
| `list.search` | Search serial or PO | Serial या PO खोजें |
| `list.empty` | No bundles match this filter. | इस फ़िल्टर में कोई bundle नहीं है। |
| `columns.serial` | Serial | Serial |
| `columns.die` | Die | Die |
| `columns.section` | Section | सेक्शन |
| `columns.weight` | Weight (kg) | वज़न (kg) |
| `columns.pieces` | Pcs | पीस |
| `columns.cutLength` | Cut length | कट लंबाई |
| `columns.kgPer12ft` | kg/12ft | kg/12ft |
| `columns.status` | Status | स्टेटस |
| `columns.po` | PO | PO |
| `columns.packed` | Packed | पैक हुआ |

### bundle (33)

| Key | English | हिंदी |
|---|---|---|
| `title` | Bundle {serial} | Bundle {serial} |
| `facts.weight` | Weight | वज़न |
| `facts.pieces` | Pieces | पीस |
| `facts.cutLength` | Cut length | कट लंबाई |
| `facts.kgPer12ft` | kg/12ft | kg/12ft |
| `facts.weightRange` | Weight range /12' | वज़न रेंज /12' |
| `facts.die` | Die | Die |
| `facts.section` | Section | सेक्शन |
| `facts.po` | PO | PO |
| `facts.session` | Packing session | पैकिंग सेशन |
| `history` | History | इतिहास |
| `historyPacked` | Packed | पैक हुआ |
| `historyChanged` | Changed to {status} | स्टेटस बदला: {status} |
| `reasonLine` | Reason: {reason} | कारण: {reason} |
| `inDispatch` | In dispatch {code} | Dispatch {code} में |
| `addToDispatch` | Add to dispatch | Dispatch में जोड़ें |
| `chooseDispatch` | Choose a dispatch | Dispatch चुनें |
| `noBuildingDispatches` | No dispatch is being built. Start one from Dispatch. | अभी कोई dispatch नहीं बन रहा। Dispatch पेज से नया शुरू करें। |
| `addedToDispatch` | Added to {code} | {code} में जोड़ दिया |
| `reprint` | Reprint label | लेबल फिर से प्रिंट करें |
| `void` | Void bundle | Bundle रद्द करें |
| `restore` | Restore bundle | Bundle वापस लाएं |
| `voidTitle` | Void this bundle? | यह bundle रद्द करें? |
| `voidBody` | A void bundle can't go into a dispatch. You can restore it later. | रद्द bundle किसी dispatch में नहीं जा सकता। बाद में इसे वापस ला सकते हैं। |
| `restoreTitle` | Restore this bundle? | यह bundle वापस लाएं? |
| `restoreBody` | It goes back to In stock. | यह फिर से स्टॉक में आ जाएगा। |
| `reason` | Reason | कारण |
| `reasonHint` | For example: packed twice, wrong weight entered. | जैसे: दो बार पैक हुआ, गलत वज़न डाला। |
| `voided` | Bundle voided | Bundle रद्द हो गया |
| `restored` | Bundle restored | Bundle वापस आ गया |
| `publicSignIn` | Sign in to see stock details | स्टॉक की जानकारी देखने के लिए साइन इन करें |
| `ambiguousTitle` | Which bundle? | कौन सा bundle? |
| `ambiguousBody` | More than one bundle has the number {code}. Pick the year it was packed. | {code} नंबर के एक से ज़्यादा bundle हैं। जिस साल पैक हुआ वह साल चुनें। |

### dispatch (54)

| Key | English | हिंदी |
|---|---|---|
| `title` | Dispatch | Dispatch |
| `newDispatch` | New dispatch | नया dispatch |
| `columns.code` | Code | कोड |
| `columns.customer` | Customer | ग्राहक |
| `columns.shipDate` | Ship date | भेजने की तारीख |
| `columns.bundles` | Bundles | Bundle |
| `columns.kg` | kg | kg |
| `columns.status` | Status | स्टेटस |
| `empty` | No dispatches here. | यहां कोई dispatch नहीं है। |
| `emptyBuilding` | Nothing is being built. Start a new dispatch. | अभी कुछ नहीं बन रहा। नया dispatch शुरू करें। |
| `new.title` | New dispatch | नया dispatch |
| `new.customer` | Customer | ग्राहक |
| `new.customerSearch` | Search customers | ग्राहक खोजें |
| `new.newCustomer` | New customer | नया ग्राहक |
| `new.shipDate` | Ship date | भेजने की तारीख |
| `new.notes` | Notes | नोट |
| `new.submit` | Create dispatch | Dispatch बनाएं |
| `steps.build` | Build | बनाएं |
| `steps.hold` | Hold | होल्ड |
| `steps.dispatch` | Dispatch | Dispatch |
| `build.scanBundles` | Scan bundles | Bundle स्कैन करें |
| `build.pasteSerials` | Paste serials | Serial पेस्ट करें |
| `build.searchAdd` | Search to add | खोज कर जोड़ें |
| `build.empty` | No bundles yet. Scan a label to add the first one. | अभी कोई bundle नहीं है। पहला bundle जोड़ने के लिए लेबल स्कैन करें। |
| `build.groupTotal` | {bundles} {bundles:bundle\|bundles} · {kg} kg | {bundles} bundle · {kg} kg |
| `build.groupLabel` | Packing group label | पैकिंग ग्रुप लेबल |
| `build.removeBundle` | Remove {serial} | {serial} हटाएं |
| `build.removed` | Removed {serial} | {serial} हटा दिया |
| `paste.title` | Paste serials | Serial पेस्ट करें |
| `paste.label` | Serials | Serial |
| `paste.hint` | One per line, or separated by commas or spaces. | हर लाइन में एक, या कॉमा या स्पेस से अलग करके। |
| `paste.submit` | Add bundles | Bundle जोड़ें |
| `paste.added` | {count} added | {count} {count:जुड़ा\|जुड़े} |
| `paste.already` | {count} already in this dispatch | {count} इस dispatch में पहले से {count:है\|हैं} |
| `paste.notFound` | {count} not found | {count} नहीं {count:मिला\|मिले} |
| `paste.unavailable` | {count} not available | {count} उपलब्ध नहीं {count:है\|हैं} |
| `holdStock` | Hold stock | स्टॉक होल्ड करें |
| `held` | Stock held | स्टॉक होल्ड हो गया |
| `heldNote` | Bundles you add now are held straight away. | अब जो bundle जोड़ेंगे, वो तुरंत होल्ड हो जाएंगे। |
| `release` | Release | होल्ड हटाएं |
| `released` | Stock released | होल्ड हट गया |
| `dispatchAction` | Dispatch | Dispatch करें |
| `confirmTitle` | Dispatch {code}? | {code} dispatch करें? |
| `confirmBody` | {bundles} {bundles:bundle\|bundles} · {kg} kg for {customer}. You can't add or remove bundles after this. | {customer} के लिए {bundles} bundle · {kg} kg। इसके बाद bundle जोड़ या हटा नहीं सकेंगे। |
| `confirm` | Dispatch | Dispatch करें |
| `dispatched` | Dispatched | Dispatch हो गया |
| `cancel` | Cancel dispatch | Dispatch कैंसल करें |
| `cancelTitle` | Cancel this dispatch? | यह dispatch कैंसल करें? |
| `cancelBody` | Held bundles go back to stock. | होल्ड वाले bundle वापस स्टॉक में चले जाएंगे। |
| `cancelled` | Dispatch cancelled | Dispatch कैंसल हो गया |
| `delete` | Delete dispatch | Dispatch डिलीट करें |
| `deleteTitle` | Delete this dispatch? | यह dispatch डिलीट करें? |
| `deleteBody` | The dispatch is removed. Its bundles stay in stock. | Dispatch हट जाएगा। इसके bundle स्टॉक में ही रहेंगे। |
| `deleted` | Dispatch deleted | Dispatch डिलीट हो गया |

### packingList (24)

| Key | English | हिंदी |
|---|---|---|
| `title` | Packing list | पैकिंग लिस्ट |
| `plNo` | PL no | PL नंबर |
| `date` | Date | तारीख |
| `shipDate` | Ship date | भेजने की तारीख |
| `customer` | Customer | ग्राहक |
| `totals` | {bundles} {bundles:bundle\|bundles} · {kg} kg | {bundles} bundle · {kg} kg |
| `columns.sr` | Sr | क्र. |
| `columns.bundleNo` | Bundle no | Bundle नंबर |
| `columns.item` | Item | आइटम |
| `columns.weightKg` | Weight kg | वज़न kg |
| `columns.cutLengthFt` | Cut length ft | कट लंबाई ft |
| `columns.cutLengthIn` | Cut length in | कट लंबाई in |
| `columns.pcs` | Pcs | पीस |
| `columns.kgPer12ft` | kg/12ft | kg/12ft |
| `columns.weightRange` | Weight range /12' | वज़न रेंज /12' |
| `groupTotal` | Group total | ग्रुप का कुल |
| `grandTotal` | Total | कुल |
| `downloadPdf` | Download PDF | PDF डाउनलोड करें |
| `downloadExcel` | Download Excel | Excel डाउनलोड करें |
| `share` | Share | शेयर करें |
| `regenerate` | Regenerate | फिर से बनाएं |
| `regenerateTitle` | Regenerate the packing list? | पैकिंग लिस्ट फिर से बनाएं? |
| `regenerateBody` | orrn builds it again from the bundles in this dispatch as they are now. | orrn इस dispatch के bundle की अभी की जानकारी से इसे फिर से बनाएगा। |
| `regenerated` | Packing list regenerated | पैकिंग लिस्ट फिर से बन गई |

### dies (32)

| Key | English | हिंदी |
|---|---|---|
| `title` | Dies | Die |
| `newDie` | New die | नया die |
| `search` | Search code, series or section | कोड, सीरीज़ या सेक्शन खोजें |
| `columns.code` | Die | Die |
| `columns.series` | Series | सीरीज़ |
| `columns.section` | Section | सेक्शन |
| `columns.name` | Name | नाम |
| `columns.range` | Range (kg/12ft) | रेंज (kg/12ft) |
| `columns.status` | Status | स्टेटस |
| `empty` | No dies yet. | अभी कोई die नहीं है। |
| `emptyAction` | Add a die | Die जोड़ें |
| `importCsv` | Import CSV | CSV इम्पोर्ट करें |
| `form.titleNew` | New die | नया die |
| `form.titleEdit` | Die {code} | Die {code} |
| `form.series` | Series | सीरीज़ |
| `form.sectionCode` | Section code | सेक्शन कोड |
| `form.name` | Name | नाम |
| `form.weightMin` | Min weight (kg/12ft) | कम से कम वज़न (kg/12ft) |
| `form.weightMax` | Max weight (kg/12ft) | ज़्यादा से ज़्यादा वज़न (kg/12ft) |
| `form.rangeHint` | Weight of one 12 ft length, in kg. | 12 ft लंबाई का वज़न, kg में। |
| `form.rangeOrder` | Max weight must be more than min weight. | ज़्यादा से ज़्यादा वज़न, कम से कम वज़न से बड़ा होना चाहिए। |
| `form.status` | Status | स्टेटस |
| `form.statusHint` | Archived dies don't show in Pack. | बंद die पैकिंग में नहीं दिखते। |
| `form.notes` | Notes | नोट |
| `form.advanced` | Advanced | एडवांस |
| `form.width` | Width | चौड़ाई |
| `form.thickness` | Thickness | मोटाई |
| `form.oblique` | Oblique | Oblique |
| `form.leg` | Leg | लेग |
| `form.submit` | Save die | Die सेव करें |
| `form.saved` | Die saved | Die सेव हो गया |
| `form.codeTaken` | This code belongs to a deleted die. Use a different code. | यह कोड एक डिलीट हुए die का है। दूसरा कोड डालें। |

### customers (28)

| Key | English | हिंदी |
|---|---|---|
| `title` | Customers | ग्राहक |
| `newCustomer` | New customer | नया ग्राहक |
| `search` | Search name, phone or GSTIN | नाम, फ़ोन या GSTIN खोजें |
| `columns.name` | Name | नाम |
| `columns.phone` | Phone | फ़ोन |
| `columns.gstin` | GSTIN | GSTIN |
| `empty` | No customers yet. | अभी कोई ग्राहक नहीं है। |
| `emptyAction` | Add a customer | ग्राहक जोड़ें |
| `form.titleNew` | New customer | नया ग्राहक |
| `form.name` | Name | नाम |
| `form.nameHint` | As it should print on the packing list. | जैसा पैकिंग लिस्ट पर छपना चाहिए। |
| `form.phone` | Phone | फ़ोन |
| `form.email` | Email | ईमेल |
| `form.gstin` | GSTIN | GSTIN |
| `form.gstinHint` | 15 characters, from the customer's GST certificate. | 15 अक्षर, ग्राहक के GST सर्टिफ़िकेट से। |
| `form.gstinInvalid` | A GSTIN has 15 letters and numbers. Check it and try again. | GSTIN में 15 अक्षर और अंक होते हैं। जांच कर फिर से डालें। |
| `form.notes` | Notes | नोट |
| `form.billingAddress` | Billing address | बिलिंग का पता |
| `form.shippingAddress` | Shipping address | डिलीवरी का पता |
| `form.sameAsBilling` | Same as billing address | बिलिंग वाला पता ही |
| `form.addressLine` | Address | पता |
| `form.city` | City | शहर |
| `form.state` | State | राज्य |
| `form.pincode` | PIN code | पिन कोड |
| `form.submit` | Save customer | ग्राहक सेव करें |
| `form.saved` | Customer saved | ग्राहक सेव हो गया |
| `dispatches` | Dispatches | Dispatch |
| `noDispatches` | No dispatches for this customer yet. | इस ग्राहक का अभी कोई dispatch नहीं है। |

### printing (25)

| Key | English | हिंदी |
|---|---|---|
| `title` | Printing | प्रिंटिंग |
| `tabs.queue` | Queue | कतार |
| `tabs.printers` | Printers | प्रिंटर |
| `tabs.labels` | Labels | लेबल |
| `queue.empty` | Nothing waiting to print. | प्रिंट के लिए कुछ बाकी नहीं है। |
| `queue.label` | Label | लेबल |
| `queue.printer` | Printer | प्रिंटर |
| `queue.status` | Status | स्टेटस |
| `queue.when` | When | कब |
| `queue.error` | Error | गड़बड़ी |
| `queue.retry` | Retry | फिर से भेजें |
| `queue.cancel` | Cancel job | जॉब कैंसल करें |
| `queue.retried` | Sent again | फिर से भेज दिया |
| `printers.empty` | No printers connected yet. | अभी कोई प्रिंटर नहीं जुड़ा है। |
| `printers.name` | Printer | प्रिंटर |
| `printers.status` | Status | स्टेटस |
| `printers.lastSeen` | Last seen {time} | आखिरी बार {time} पर दिखा |
| `labels.push` | Send label design to printers | लेबल डिज़ाइन प्रिंटर को भेजें |
| `labels.pushed` | Label design sent | लेबल डिज़ाइन भेज दिया |
| `advanced.title` | Advanced | एडवांस |
| `advanced.variables` | Label data (JSON) | लेबल डेटा (JSON) |
| `advanced.submit` | Send print job | प्रिंट जॉब भेजें |
| `notSetUpTitle` | Label printing isn't set up | लेबल प्रिंटिंग सेट नहीं है |
| `notSetUpBody` | Ask the orrn team to set up label printing for your plant. | अपने प्लांट के लिए लेबल प्रिंटिंग सेट करवाने के लिए orrn टीम से कहें। |
| `restricted` | You can see the queue. Ask a manager to change printers or labels. | आप कतार देख सकते हैं। प्रिंटर या लेबल बदलने के लिए मैनेजर से कहें। |

### settings (59)

| Key | English | हिंदी |
|---|---|---|
| `title` | Settings | सेटिंग्स |
| `tabs.company` | Company | कंपनी |
| `tabs.team` | Team | टीम |
| `tabs.printing` | Printing | प्रिंटिंग |
| `tabs.data` | Data | डेटा |
| `company.name` | Company name | कंपनी का नाम |
| `company.nameHint` | Only orrn support can change this. | इसे सिर्फ़ orrn सपोर्ट बदल सकता है। |
| `company.lengthUnit` | Length unit | लंबाई की इकाई |
| `company.unitMm` | Millimetres (mm) | मिलीमीटर (mm) |
| `company.unitInch` | Feet and inches | फ़ुट और इंच |
| `company.timezone` | Time zone | टाइम ज़ोन |
| `company.submit` | Save settings | सेटिंग्स सेव करें |
| `company.saved` | Settings saved | सेटिंग्स सेव हो गईं |
| `company.readOnly` | Only owners and admins can change these. | इन्हें सिर्फ़ मालिक और एडमिन बदल सकते हैं। |
| `team.members` | Members | सदस्य |
| `team.invite` | Invite member | सदस्य को इनवाइट करें |
| `team.inviteTitle` | Invite a team member | टीम में किसी को इनवाइट करें |
| `team.email` | Email | ईमेल |
| `team.role` | Role | रोल |
| `team.roleHints.owner` | Everything, including team and company settings. | सब कुछ, टीम और कंपनी सेटिंग्स समेत। |
| `team.roleHints.admin` | Everything, including team and company settings. | सब कुछ, टीम और कंपनी सेटिंग्स समेत। |
| `team.roleHints.manager` | Dies, customers, dispatches and printers. No team or settings. | Die, ग्राहक, dispatch और प्रिंटर। टीम या सेटिंग्स नहीं। |
| `team.roleHints.office` | Orders, dispatches, scrap weighing, D/C notes, Tally export and reports. | ऑर्डर, dispatch, स्क्रैप का वज़न, D/C नोट, Tally export और रिपोर्ट। |
| `team.roleHints.accountant` | Reads orders, invoices and D/C notes. GST and Tally export. Can belong to several plants. | ऑर्डर, बिल और D/C नोट देखना। GST और Tally export। कई प्लांट में हो सकते हैं। |
| `team.roleHints.supervisor` | Packing, stock, dispatch, casts, press runs, quality checks and ageing. Voids bundles. | पैकिंग, स्टॉक, dispatch, कास्ट, प्रेस रन, क्वालिटी जाँच और एजिंग। Bundle रद्द करना। |
| `team.roleHints.packer` | Packs bundles and prints labels, moves and counts stock, scans onto packing lists. | Bundle पैक करना और लेबल प्रिंट करना, स्टॉक की जगह बदलना और गिनना, packing list पर स्कैन करना। |
| `team.roleHints.foundry` | Cast entry and spectro. Approves cast close-outs. | कास्ट एंट्री और स्पेक्ट्रो। कास्ट क्लोज़ को मंज़ूरी देना। |
| `team.roleHints.press` | Press runs, die weight readings, quality checks and ageing. | प्रेस रन, die वज़न रीडिंग, क्वालिटी जाँच और एजिंग। |
| `team.roleHints.storekeeper` | Scrap weighing, and items issued from or returned to the store. | स्क्रैप का वज़न, और स्टोर से सामान देना और वापस लेना। |
| `team.roleHints.die_room` | Die cards, nitriding, die weight readings. Proposes tier changes. | Die कार्ड, नाइट्राइडिंग, die वज़न रीडिंग। टियर बदलने का प्रस्ताव। |
| `team.roleHints.operator` | Packs bundles, scans into dispatches, voids bundles and prints labels. | Bundle पैक करना, dispatch में स्कैन करना, bundle रद्द करना और लेबल प्रिंट करना। |
| `team.roleHints.viewer` | Can see everything. Can't change anything. | सब कुछ देख सकते हैं, कुछ बदल नहीं सकते। |
| `team.sendInvite` | Send invite | इनवाइट भेजें |
| `team.inviteSent` | Invite sent to {email} | {email} को इनवाइट भेज दिया |
| `team.pending` | Pending invites | बाकी इनवाइट |
| `team.expires` | Link works until {date} | लिंक {date} तक चलेगा |
| `team.revoke` | Cancel invite | इनवाइट कैंसल करें |
| `team.revoked` | Invite cancelled | इनवाइट कैंसल हो गया |
| `team.changeRole` | Change role | रोल बदलें |
| `team.roleChanged` | Role changed | रोल बदल गया |
| `team.remove` | Remove from team | टीम से हटाएं |
| `team.removeTitle` | Remove {name}? | {name} को हटाएं? |
| `team.removeBody` | They lose access to this company straight away. | इस कंपनी में उनका एक्सेस तुरंत बंद हो जाएगा। |
| `team.removed` | {name} removed | {name} को हटा दिया |
| `team.ownerLocked` | Only an owner can change another owner. | मालिक का रोल सिर्फ़ दूसरा मालिक बदल सकता है। |
| `team.you` | You | आप |
| `printing.status` | Label printing | लेबल प्रिंटिंग |
| `printing.printers` | Printers | प्रिंटर |
| `data.title` | Data | डेटा |
| `data.importBundles` | Import old bundles | पुराने bundle इम्पोर्ट करें |
| `data.importDies` | Import dies | Die इम्पोर्ट करें |
| `data.importCustomers` | Import customers | ग्राहक इम्पोर्ट करें |
| `data.hint` | Upload an Excel or CSV file. orrn checks every row before saving anything. | Excel या CSV फ़ाइल अपलोड करें। कुछ भी सेव करने से पहले orrn हर लाइन जांचता है। |
| `data.chooseFile` | Choose file | फ़ाइल चुनें |
| `data.rowsOk` | {count} {count:row\|rows} ready | {count} लाइन तैयार |
| `data.rowsRejected` | {count} {count:row\|rows} with problems | {count} लाइन में दिक्कत |
| `data.rowProblem` | Row {row}: {reason} | लाइन {row}: {reason} |
| `data.submit` | Import {count} {count:row\|rows} | {count} लाइन इम्पोर्ट करें |
| `data.imported` | {count} {count:row\|rows} imported | {count} लाइन इम्पोर्ट हो {count:गई\|गईं} |

### guides (11)

| Key | English | हिंदी |
|---|---|---|
| `title` | Guides | गाइड |
| `subtitle` | Step by step help for each job in orrn. | orrn के हर काम के लिए कदम दर कदम मदद। |
| `howTo` | How to | कैसे करें |
| `when` | When to use this | कब इस्तेमाल करें |
| `steps` | Steps | कदम |
| `problems` | If something goes wrong | कोई दिक्कत आए तो |
| `step` | Step {n} | कदम {n} |
| `forRoles` | For: {roles} | किसके लिए: {roles} |
| `open` | Open guide | गाइड खोलें |
| `all` | All guides | सारी गाइड |
| `empty` | No guides for your role yet. | आपके रोल के लिए अभी कोई गाइड नहीं है। |

### admin (34)

| Key | English | हिंदी |
|---|---|---|
| `title` | Godseye | Godseye |
| `kpis.active` | Active companies | चालू कंपनियां |
| `kpis.suspended` | Suspended | रोकी गई |
| `kpis.pendingRequests` | Pending requests | बाकी रिक्वेस्ट |
| `kpis.staff` | Staff | स्टाफ़ |
| `recentCompanies` | Recent companies | हाल की कंपनियां |
| `companies.title` | Companies | कंपनियां |
| `companies.search` | Search companies | कंपनी खोजें |
| `companies.empty` | No companies yet. | अभी कोई कंपनी नहीं है। |
| `companies.tabs.plan` | Plan and modules | प्लान और मॉड्यूल |
| `companies.tabs.printing` | Printing | प्रिंटिंग |
| `companies.tabs.access` | Access | एक्सेस |
| `companies.suspend` | Suspend company | कंपनी रोकें |
| `companies.reactivate` | Reactivate company | कंपनी फिर से चालू करें |
| `printing.setUp` | Set up label printing | लेबल प्रिंटिंग सेट करें |
| `printing.turnOff` | Turn off label printing | लेबल प्रिंटिंग बंद करें |
| `printing.rotateSecret` | Rotate secret | Secret बदलें |
| `printing.installScript` | Install script | इंस्टॉल स्क्रिप्ट |
| `printing.downloads` | Downloads | डाउनलोड |
| `access.impersonate` | Impersonate | कंपनी के रूप में खोलें |
| `access.banner` | Viewing {company} as orrn support | {company} को orrn सपोर्ट के रूप में देख रहे हैं |
| `access.stop` | Stop impersonating | सपोर्ट व्यू बंद करें |
| `access.expires` | Ends at {time} | {time} पर खत्म होगा |
| `requests.title` | Access requests | एक्सेस रिक्वेस्ट |
| `requests.empty` | No requests waiting. | कोई रिक्वेस्ट बाकी नहीं है। |
| `requests.approve` | Approve | मंज़ूर करें |
| `requests.reject` | Reject | नामंज़ूर करें |
| `requests.approved` | Request approved | रिक्वेस्ट मंज़ूर हो गई |
| `requests.rejected` | Request rejected | रिक्वेस्ट नामंज़ूर हो गई |
| `staff.title` | Staff | स्टाफ़ |
| `staff.add` | Add staff | स्टाफ़ जोड़ें |
| `staff.name` | Name | नाम |
| `staff.email` | Email | ईमेल |
| `staff.role` | Role | रोल |

### marketing (34)

| Key | English | हिंदी |
|---|---|---|
| `headline` | Every bundle, accounted for. | हर bundle का पूरा हिसाब। |
| `sub` | orrn tracks each bundle from packing to dispatch, so the floor and the office see the same stock. | orrn हर bundle को पैकिंग से dispatch तक ट्रैक करता है, ताकि फ़्लोर और ऑफ़िस एक ही स्टॉक देखें। |
| `requestAccess` | Request access | एक्सेस मांगें |
| `signIn` | Sign in | साइन इन करें |
| `homeLabel` | orrn home | orrn होम |
| `metaTitle` | orrn: every bundle, accounted for | orrn: हर bundle का पूरा हिसाब |
| `visual.bundles` | {count:bundle\|bundles} | {count:bundle\|bundle} |
| `visual.pieces` | {count} pcs | {count} पीस |
| `visual.packingListReady` | Packing list ready | पैकिंग लिस्ट तैयार |
| `flow.title` | Pack. Stock. Dispatch. | पैकिंग। स्टॉक। Dispatch। |
| `flow.pack` | Enter each bundle's weight and pieces, and print its label. | हर bundle का वज़न और पीस डालें, और उसका लेबल प्रिंट करें। |
| `flow.stock` | See what's in stock by section, in bundles and kg. | सेक्शन के हिसाब से स्टॉक देखें, bundle और kg में। |
| `flow.dispatch` | Scan bundles into a dispatch and print the packing list. | Bundle स्कैन करके dispatch में डालें और पैकिंग लिस्ट प्रिंट करें। |
| `floor.title` | Built for the floor | फ़्लोर के लिए बना |
| `floor.buttons` | Big buttons and big numbers, easy to hit with gloves on. | बड़े बटन और बड़े नंबर, दस्ताने पहनकर भी आसानी से दबें। |
| `floor.hindi` | Hindi and English, one tap apart. | हिंदी और English, एक टैप पर। |
| `floor.camera` | Scan labels with the phone camera. | फ़ोन के कैमरे से लेबल स्कैन करें। |
| `floor.devices` | Runs on a phone, a tablet or a laptop. | फ़ोन, टैबलेट या लैपटॉप पर चलता है। |
| `floor.tryIt` | Try it on this page | इसी पेज पर आज़माएं |
| `office.title` | For the office | ऑफ़िस के लिए |
| `office.stock` | Stock by section, up to date as bundles are packed and dispatched. | सेक्शन के हिसाब से स्टॉक, हर पैकिंग और dispatch के साथ अपडेट। |
| `office.packingList` | Packing lists with your company header, ready to print or send. | आपकी कंपनी के हेडर वाली पैकिंग लिस्ट, प्रिंट करने या भेजने के लिए तैयार। |
| `office.labels` | Labels print on your own printers over the plant network. | प्लांट के नेटवर्क पर आपके अपने प्रिंटर से लेबल प्रिंट होते हैं। |
| `office.demoCompany` | Your company name | आपकी कंपनी का नाम |
| `office.demoCustomer` | Demo customer | डेमो ग्राहक |
| `trust.title` | Your data stays yours | आपका डेटा आपका ही रहता है |
| `trust.separate` | Each company's data is kept apart from every other company. | हर कंपनी का डेटा बाकी कंपनियों से अलग रखा जाता है। |
| `trust.audit` | Every change is logged with who made it and when. | हर बदलाव का रिकॉर्ड रहता है, किसने किया और कब। |
| `trust.roles` | Roles decide who can pack, dispatch or change settings. | रोल तय करते हैं कि कौन पैकिंग, dispatch या सेटिंग्स बदल सकता है। |
| `cta.title` | Try it on your floor | अपने फ़्लोर पर आज़माएं |
| `cta.body` | Tell us about your plant and we'll get in touch. | अपने प्लांट के बारे में बताएं, हम संपर्क करेंगे। |
| `footer` | orrn, for aluminium extrusion plants | orrn, एल्युमिनियम एक्सट्रूज़न प्लांट के लिए |
| `footerNav` | Footer | फ़ुटर |
| `copyright` | © {year} orrn | © {year} orrn |

### ui (9)

| Key | English | हिंदी |
|---|---|---|
| `stepOf` | Step {n} of {total} | कदम {n} / {total} |
| `stepDone` | done | हो गया |
| `stepCurrent` | current step | अभी का कदम |
| `searching` | Searching | खोज रहे हैं |
| `recent` | Recent | हाल के |
| `pages` | Pages | पेज |
| `pageRangeOpen` | {from}-{to} | {from}-{to} |
| `stubTitle` | This screen is being rebuilt | यह स्क्रीन फिर से बन रही है |
| `stubBody` | It will be back here soon. | यह जल्द ही यहाँ वापस आएगी। |

### charts (29)

| Key | English | हिंदी |
|---|---|---|
| `showTable` | Show table | टेबल दिखाएं |
| `hideTable` | Hide table | टेबल छिपाएं |
| `legend` | Legend | संकेत |
| `loading` | Loading chart | चार्ट लोड हो रहा है |
| `emptyTitle` | No data for this period | इस अवधि का कोई डेटा नहीं |
| `emptyBody` | Pick a longer period to see more. | ज़्यादा देखने के लिए लंबी अवधि चुनें। |
| `errorTitle` | This chart didn't load | यह चार्ट लोड नहीं हुआ |
| `errorBody` | Check the connection and try again. | कनेक्शन जांचें और फिर से कोशिश करें। |
| `other` | Other | बाकी |
| `rank` | Rank | रैंक |
| `name` | Name | नाम |
| `share` | Share | हिस्सा |
| `movement` | Movement | बदलाव |
| `movedUp` | Up {count} | {count} ऊपर |
| `movedDown` | Down {count} | {count} नीचे |
| `movedUpLong` | Up {count} {count:place\|places} from the previous period | पिछली अवधि से {count} {count:स्थान\|स्थान} ऊपर |
| `movedDownLong` | Down {count} {count:place\|places} from the previous period | पिछली अवधि से {count} {count:स्थान\|स्थान} नीचे |
| `noChange` | Same | वही |
| `noChangeLong` | Same place as the previous period | पिछली अवधि जैसा ही स्थान |
| `isNew` | New | नया |
| `isNewLong` | New this period | इस अवधि में नया |
| `noValue` | No data | डेटा नहीं |
| `soFar` | so far | अब तक |
| `soFarLabel` | {label}, so far | {label}, अब तक |
| `shareOfTotal` | {share} of total | कुल का {share} |
| `unitThousand` | k | k (check) |
| `unitLakh` | L | L (check) |
| `unitCrore` | Cr | Cr (check) |
| `sparkSummary` | {label}: {first} to {last}, high {max}, low {min} | {label}: {first} से {last}, सबसे ज़्यादा {max}, सबसे कम {min} |

Please check, Lalubhai:

- `unitThousand`: Chart axis short form for thousand. Kept as k for now. Should it be हज़ार or something shorter?
- `unitLakh`: Chart axis short form for lakh (1.5L). Kept as L for now. Should it be लाख?
- `unitCrore`: Chart axis short form for crore (1.2Cr). Kept as Cr for now. Should it be करोड़?

### errors (16)

| Key | English | हिंदी |
|---|---|---|
| `generic` | Something went wrong. Try again. | कुछ गड़बड़ हो गई। फिर से कोशिश करें। |
| `network` | No internet connection. Check it and try again. | इंटरनेट नहीं है। कनेक्शन जांचें और फिर से कोशिश करें। |
| `forbidden` | Your role can't do this. Ask an admin if you need it. | आपका रोल यह काम नहीं कर सकता। ज़रूरत हो तो एडमिन से कहें। |
| `notFound` | Not found | नहीं मिला |
| `notFoundInCompany` | Not found in this company | इस कंपनी में नहीं मिला |
| `sessionExpired` | Your session ended. Sign in again. | आपका सेशन खत्म हो गया। फिर से साइन इन करें। |
| `required` | Fill this in. | यह भरना ज़रूरी है। |
| `invalidNumber` | Enter a number, like 52.40. | नंबर डालें, जैसे 52.40 |
| `wholeNumber` | Enter a whole number. | पूरा नंबर डालें, दशमलव नहीं। |
| `notPositive` | Enter a number above 0. | 0 से बड़ा नंबर डालें। |
| `tooLong` | Keep this under {max} characters. | {max} अक्षरों से कम रखें। |
| `invalidEmail` | Enter an email like name@company.com. | ऐसा ईमेल डालें: name@company.com |
| `conflict` | Someone else changed this. Reload to see the latest. | किसी और ने इसे बदल दिया है। नया देखने के लिए पेज रीलोड करें। |
| `pageNotFound` | This page doesn't exist. | यह पेज मौजूद नहीं है। |
| `goToday` | Go to Today | आज का पेज खोलें |
| `printFailed` | The label didn't print: {reason} | लेबल प्रिंट नहीं हुआ: {reason} |

## Guides

### Pack a session and print labels (`pack-session`)

| Part | English | हिंदी |
|---|---|---|
| Title | Pack a session and print labels | पैकिंग सेशन करें और लेबल प्रिंट करें |
| When | Use this when bundles from one die are packed and you have each bundle's weight and piece count. | जब एक die के bundle पैक हो गए हों और हर bundle का वज़न और पीस आपके पास हों। |
| Step 1 | Start a session | सेशन शुरू करें |
| Step 1 text | Open "Pack" and tap "New packing session". | "पैकिंग" खोलें और "नया पैकिंग सेशन" दबाएं। |
| Step 2 | Choose the die | Die चुनें |
| Step 2 text | Search by die code or section. Dies you used recently are at the top. Archived dies don't show here. | Die कोड या सेक्शन से खोजें। हाल में इस्तेमाल हुए die सबसे ऊपर दिखते हैं। बंद die यहां नहीं दिखते। |
| Step 3 | Set cut length and PO | कट लंबाई और PO डालें |
| Step 3 text | Enter the cut length once for the whole session, and the PO if there is one. Every bundle uses these unless you change them on that bundle. | पूरे सेशन के लिए कट लंबाई एक बार डालें, और PO हो तो वो भी। हर bundle में यही लगेगा, जब तक आप उस bundle पर इसे न बदलें। |
| Step 4 | Enter each bundle | हर bundle डालें |
| Step 4 text | Type the weight in kg and press "Next". Type the pieces and press "Next" again. The bundle is added to the list and a new card opens. | kg में वज़न लिखें और "आगे" दबाएं। पीस लिखें और फिर "आगे" दबाएं। Bundle लिस्ट में जुड़ जाता है और नया कार्ड खुल जाता है। |
| Step 5 | Check the kg/12ft chip | kg/12ft वाला निशान देखें |
| Step 5 text | Green means the bundle is in the die's range. Amber means it is below or above. Check the weight and pieces before you carry on. | हरा मतलब bundle die की रेंज में है। पीला मतलब रेंज से कम या ज़्यादा है। आगे बढ़ने से पहले वज़न और पीस दोबारा जांचें। |
| Step 6 | Review and save | जांचें और सेव करें |
| Step 6 text | Tap "Review" and check the bundle count, pieces and kg. Then tap "Save and print labels". If label printing isn't set up, the button says "Save session". | "जांचें" दबाएं और bundle, पीस और kg का कुल देखें। फिर "सेव करें और लेबल प्रिंट करें" दबाएं। अगर लेबल प्रिंटिंग सेट नहीं है, तो बटन पर "सेशन सेव करें" लिखा होगा। |
| Problem 1 | One bundle has a different length or PO | किसी एक bundle की लंबाई या PO अलग है |
| Fix 1 | On that bundle's card, tap "Different length or PO" and enter it. The rest of the session keeps the defaults. | उस bundle के कार्ड पर "अलग लंबाई या PO" दबाएं और उसे डालें। बाकी सेशन में पहले वाली कट लंबाई और PO ही रहेंगे। |
| Problem 2 | I typed a wrong weight | गलत वज़न डाल दिया |
| Fix 2 | Before saving, tap the bundle's row to edit or remove it. After saving, void that bundle and pack it again. | सेव करने से पहले bundle की लाइन दबाकर उसे बदलें या हटाएं। सेव करने के बाद उस bundle को रद्द करें और फिर से पैक करें। |
| Problem 3 | Some labels didn't print | कुछ लेबल प्रिंट नहीं हुए |
| Fix 3 | The session is already saved. Tap "Retry failed labels", or open the session later and tap "Reprint" on each bundle. If it keeps failing, see "The printer isn't printing". | सेशन सेव हो चुका है। "फ़ेल हुए लेबल फिर से प्रिंट करें" दबाएं, या बाद में सेशन खोलकर हर bundle पर "फिर से प्रिंट करें" दबाएं। बार बार फ़ेल हो तो "प्रिंटर प्रिंट नहीं कर रहा" गाइड देखें। |

### Reprint a label (`reprint-label`)

| Part | English | हिंदी |
|---|---|---|
| Title | Reprint a label | लेबल फिर से प्रिंट करें |
| When | Use this when a bundle's label is torn, wet, unreadable or missing. | जब किसी bundle का लेबल फट गया हो, गीला हो गया हो, पढ़ा न जा रहा हो या गायब हो। |
| Step 1 | Find the bundle | Bundle ढूंढें |
| Step 1 text | Scan the old label if it still reads. If it doesn't, open "Stock", then "Bundles", and search the serial or PO. | पुराना लेबल पढ़ा जा रहा हो तो उसे स्कैन करें। नहीं तो "स्टॉक" खोलें, फिर "Bundle", और serial या PO से खोजें। |
| Step 2 | Check it's the right bundle | सही bundle है, यह पक्का करें |
| Step 2 text | Compare the serial, weight and pieces on screen with the bundle in front of you. | स्क्रीन पर दिख रहे serial, वज़न और पीस को सामने रखे bundle से मिलाएं। |
| Step 3 | Reprint | फिर से प्रिंट करें |
| Step 3 text | Tap "Reprint label". From a packing session you can also tap "Reprint" on one bundle, or "Print all labels" for the whole session. | "लेबल फिर से प्रिंट करें" दबाएं। पैकिंग सेशन से भी किसी एक bundle पर "फिर से प्रिंट करें" या पूरे सेशन के लिए "सारे लेबल प्रिंट करें" दबा सकते हैं। |
| Step 4 | Replace the label | लेबल बदलें |
| Step 4 text | Take the new label from the printer and put it on the bundle. Remove the old label so the bundle carries only one. | प्रिंटर से नया लेबल लें और bundle पर लगाएं। पुराना लेबल हटा दें, ताकि bundle पर एक ही लेबल रहे। |
| Problem 1 | There's no "Reprint" button | "फिर से प्रिंट करें" का बटन नहीं है |
| Fix 1 | Either your role can't print or label printing isn't set up for your company. Ask a manager. | या तो आपका रोल प्रिंट नहीं कर सकता, या आपकी कंपनी के लिए लेबल प्रिंटिंग सेट नहीं है। मैनेजर से पूछें। |
| Problem 2 | I can't find the bundle | Bundle नहीं मिल रहा |
| Fix 2 | Check the serial letter by letter. Serials look like BG-000001-B001. You can also search by PO. | Serial का हर अक्षर जांचें। Serial ऐसा दिखता है: BG-000001-B001। PO से भी खोज सकते हैं। |
| Problem 3 | The label came out blank or cut off | लेबल खाली निकला या कटा हुआ निकला |
| Fix 3 | See "The printer isn't printing". | "प्रिंटर प्रिंट नहीं कर रहा" गाइड देखें। |

### Scan and check a bundle (`scan-bundle`)

| Part | English | हिंदी |
|---|---|---|
| Title | Scan and check a bundle | Bundle स्कैन करके जांचें |
| When | Use this to see a bundle's details, status and dispatch from its label. | जब लेबल से किसी bundle की जानकारी, स्टेटस और dispatch देखनी हो। |
| Step 1 | Open Scan | स्कैन खोलें |
| Step 1 text | On a phone, tap "Scan" in the middle of the bottom bar. On a laptop, click "Scan or search", or press Ctrl+K (Cmd+K on a Mac). | फ़ोन पर नीचे वाली पट्टी के बीच में "स्कैन" दबाएं। लैपटॉप पर "स्कैन करें या खोजें" पर क्लिक करें, या Ctrl+K दबाएं (Mac पर Cmd+K)। |
| Step 2 | Allow the camera | कैमरा चालू करने दें |
| Step 2 text | The first time, orrn asks to use the camera. Allow it. orrn only uses it to read labels. | पहली बार orrn कैमरा इस्तेमाल करने की इजाज़त मांगेगा। इजाज़त दे दें। orrn कैमरे से सिर्फ़ लेबल पढ़ता है। |
| Step 3 | Point at the label | लेबल की तरफ़ कैमरा करें |
| Step 3 text | Hold the QR code or barcode inside the frame. In a dark spot, turn on the torch. | QR कोड या बारकोड को फ़्रेम के अंदर रखें। अंधेरी जगह पर टॉर्च चालू करें। |
| Step 4 | Read the result | नतीजा देखें |
| Step 4 text | The bundle opens. Green means "In stock", blue means "Held", red means "Void". A dispatched bundle shows which dispatch it went in. | Bundle खुल जाता है। हरा मतलब "स्टॉक में", नीला मतलब "होल्ड पर", लाल मतलब "रद्द"। Dispatch हो चुके bundle पर दिखता है कि वो किस dispatch में गया। |
| Step 5 | No camera, or a barcode gun | कैमरा नहीं है, या बारकोड गन है |
| Step 5 text | Type the serial in the box and press Enter. A barcode scanner on a laptop types into the same box. | बॉक्स में serial लिखें और Enter दबाएं। लैपटॉप पर बारकोड स्कैनर भी इसी बॉक्स में लिखता है। |
| Problem 1 | It says "Not found in this company" | "इस कंपनी में नहीं मिला" लिखा आया |
| Fix 1 | Check the serial you typed. If it's right, the label isn't from a bundle in your company. | जो serial लिखा है उसे जांचें। अगर वो सही है, तो यह लेबल आपकी कंपनी के किसी bundle का नहीं है। |
| Problem 2 | The camera is blocked | कैमरा बंद है |
| Fix 2 | Allow camera access in your browser or phone settings, then open "Scan" again. You can always type the serial instead. | ब्राउज़र या फ़ोन की सेटिंग में कैमरा चालू करें, फिर "स्कैन" दोबारा खोलें। Serial लिखकर भी हमेशा खोज सकते हैं। |
| Problem 3 | The camera won't read the label | कैमरा लेबल नहीं पढ़ रहा |
| Fix 3 | Wipe the label, move a little closer and turn on the torch. If the label is damaged, type the serial and reprint the label. | लेबल पोंछें, थोड़ा पास आएं और टॉर्च चालू करें। लेबल खराब हो तो serial लिखें और लेबल फिर से प्रिंट करें। |

### Build a dispatch by scanning (`build-dispatch`)

| Part | English | हिंदी |
|---|---|---|
| Title | Build a dispatch by scanning | स्कैन करके dispatch बनाएं |
| When | Use this to add bundles to a dispatch that is being built. | जब किसी बन रहे dispatch में bundle जोड़ने हों। |
| Step 1 | Open the dispatch | Dispatch खोलें |
| Step 1 text | Open "Dispatch", go to the "Building" tab and tap the dispatch. If it isn't there, ask the office to create it with "New dispatch". | "Dispatch" खोलें, "बन रहा है" टैब पर जाएं और dispatch दबाएं। अगर वो वहां नहीं है, तो ऑफ़िस से कहें कि "नया dispatch" से उसे बनाएं। |
| Step 2 | Start scanning | स्कैन शुरू करें |
| Step 2 text | Tap "Scan bundles". The camera stays open and adds each bundle you scan. | "Bundle स्कैन करें" दबाएं। कैमरा खुला रहता है और हर स्कैन किया bundle जोड़ता जाता है। |
| Step 3 | Scan each label | हर लेबल स्कैन करें |
| Step 3 text | Scan one label at a time. Each bundle that goes in shows up in the list and the count goes up. | एक बार में एक लेबल स्कैन करें। जो bundle जुड़ता है वो लिस्ट में दिखता है और गिनती बढ़ जाती है। |
| Step 4 | Read any warning | चेतावनी पढ़ें |
| Step 4 text | If a bundle is held for another dispatch, void or already dispatched, orrn says why and doesn't add it. Check with your manager before using that bundle. | अगर कोई bundle दूसरे dispatch के लिए होल्ड पर है, रद्द है या पहले ही dispatch हो चुका है, तो orrn कारण बताता है और उसे नहीं जोड़ता। उस bundle को इस्तेमाल करने से पहले मैनेजर से पूछें। |
| Step 5 | Have a list of serials instead? | Serial की लिस्ट है? |
| Step 5 text | Tap "Paste serials", paste them in and tap "Add bundles". orrn shows how many were added and why any were skipped. | "Serial पेस्ट करें" दबाएं, लिस्ट पेस्ट करें और "Bundle जोड़ें" दबाएं। orrn बताता है कितने जुड़े और कौन से क्यों छूटे। |
| Step 6 | Check the totals | कुल जांचें |
| Step 6 text | Tap "Done scanning". Bundles are grouped by section with a bundle count and kg for each group. Check them against the order. | "स्कैन बंद करें" दबाएं। Bundle सेक्शन के हिसाब से ग्रुप में दिखते हैं, हर ग्रुप की bundle गिनती और kg के साथ। इन्हें ऑर्डर से मिलाएं। |
| Problem 1 | It says "Already in this dispatch" | "इस dispatch में पहले से है" लिखा आया |
| Fix 1 | You scanned the same bundle twice. Nothing changed. Carry on with the next one. | आपने वही bundle दो बार स्कैन किया। कुछ नहीं बदला। अगला bundle स्कैन करें। |
| Problem 2 | A wrong bundle went in | गलत bundle जुड़ गया |
| Fix 2 | Tap the remove button on that bundle's row. | उस bundle की लाइन पर हटाने वाला बटन दबाएं। |
| Problem 3 | There's no "Scan bundles" button | "Bundle स्कैन करें" का बटन नहीं है |
| Fix 3 | The dispatch isn't in "Building" any more, or your role can't add bundles. Check the status at the top of the dispatch. | Dispatch अब "बन रहा है" में नहीं है, या आपका रोल bundle नहीं जोड़ सकता। Dispatch के ऊपर उसका स्टेटस देखें। |

### Hold stock, dispatch, and print the packing list (`hold-and-dispatch`)

| Part | English | हिंदी |
|---|---|---|
| Title | Hold stock, dispatch, and print the packing list | स्टॉक होल्ड करें, dispatch करें और पैकिंग लिस्ट प्रिंट करें |
| When | Use this when a dispatch has all its bundles and is ready to go. | जब किसी dispatch में सारे bundle आ गए हों और वो भेजने के लिए तैयार हो। |
| Step 1 | Check the dispatch | Dispatch जांचें |
| Step 1 text | Open the dispatch and check the customer, bundle count and kg at the top. | Dispatch खोलें और ऊपर ग्राहक, bundle की गिनती और kg देखें। |
| Step 2 | Hold stock | स्टॉक होल्ड करें |
| Step 2 text | Tap "Hold stock". Every bundle in the dispatch is held for it, so nobody can put them in another dispatch. Bundles added after this are held straight away. | "स्टॉक होल्ड करें" दबाएं। Dispatch के सारे bundle उसी के लिए होल्ड हो जाते हैं, कोई उन्हें दूसरे dispatch में नहीं डाल सकता। इसके बाद जोड़े गए bundle तुरंत होल्ड हो जाते हैं। |
| Step 3 | Release if plans change | प्लान बदले तो होल्ड हटाएं |
| Step 3 text | Tap "Release" to send the dispatch back to "Building". Its bundles go back in stock until you hold again. | "होल्ड हटाएं" दबाने से dispatch वापस "बन रहा है" में चला जाता है। दोबारा होल्ड करने तक इसके bundle फिर से स्टॉक में रहते हैं। |
| Step 4 | Dispatch | Dispatch करें |
| Step 4 text | When the bundles are ready to leave, tap "Dispatch", check the totals and confirm. After this, bundles can't be added or removed. | जब bundle निकलने के लिए तैयार हों, "Dispatch करें" दबाएं, कुल जांचें और पक्का करें। इसके बाद bundle जोड़ या हटा नहीं सकते। |
| Step 5 | Get the packing list | पैकिंग लिस्ट लें |
| Step 5 text | The packing list opens. Tap "Download PDF" to print it, or "Download Excel" for the office. On the phone app, tap "Share" to send it. | पैकिंग लिस्ट खुल जाती है। प्रिंट के लिए "PDF डाउनलोड करें" दबाएं, या ऑफ़िस के लिए "Excel डाउनलोड करें"। फ़ोन ऐप में भेजने के लिए "शेयर करें" दबाएं। |
| Problem 1 | I don't see "Hold stock" or "Dispatch" | "स्टॉक होल्ड करें" या "Dispatch करें" नहीं दिख रहा |
| Fix 1 | Only managers, admins and owners can hold and dispatch. Ask one of them. | होल्ड और dispatch सिर्फ़ मैनेजर, एडमिन और मालिक कर सकते हैं। उनमें से किसी से कहें। |
| Problem 2 | The dispatch has to be stopped | Dispatch रोकना है |
| Fix 2 | Open "More actions" and tap "Cancel dispatch". Held bundles go back to stock. A dispatch that is already "Dispatched" can't be cancelled. | "और विकल्प" खोलें और "Dispatch कैंसल करें" दबाएं। होल्ड वाले bundle वापस स्टॉक में चले जाते हैं। जो dispatch हो चुका है, वो कैंसल नहीं होता। |
| Problem 3 | A number on the packing list looks wrong | पैकिंग लिस्ट में कोई नंबर गलत लग रहा है |
| Fix 3 | A manager can tap "Regenerate" to build the packing list again from the bundles as they are now. | मैनेजर "फिर से बनाएं" दबाकर bundle की अभी की जानकारी से पैकिंग लिस्ट दोबारा बना सकता है। |

### Void or restore a bundle (`void-bundle`)

| Part | English | हिंदी |
|---|---|---|
| Title | Void or restore a bundle | Bundle रद्द करें या वापस लाएं |
| When | Use this when a bundle should not be sold as entered, for example it was packed twice or has the wrong weight. | जब कोई bundle जैसा डाला गया है वैसा बेचा नहीं जाना चाहिए, जैसे दो बार पैक हो गया या वज़न गलत डला। |
| Step 1 | Open the bundle | Bundle खोलें |
| Step 1 text | Scan its label, or open "Stock", then "Bundles", and search the serial. | उसका लेबल स्कैन करें, या "स्टॉक" खोलें, फिर "Bundle", और serial खोजें। |
| Step 2 | Check the status | स्टेटस देखें |
| Step 2 text | Only a bundle that is "In stock" can be voided. If it is "Held", it has to come out of its dispatch first. Ask a manager. | सिर्फ़ "स्टॉक में" वाला bundle रद्द हो सकता है। अगर वो "होल्ड पर" है, तो पहले उसे उसके dispatch से निकालना होगा। मैनेजर से कहें। |
| Step 3 | Void it | रद्द करें |
| Step 3 text | Tap "Void bundle", write the reason and confirm. The bundle turns red and can't go into a dispatch. | "Bundle रद्द करें" दबाएं, कारण लिखें और पक्का करें। Bundle लाल हो जाता है और किसी dispatch में नहीं जा सकता। |
| Step 4 | Restore it if needed | ज़रूरत हो तो वापस लाएं |
| Step 4 text | If the void was a mistake, open the bundle, tap "Restore bundle" and give a reason. It goes back to "In stock". | अगर गलती से रद्द हुआ, तो bundle खोलें, "Bundle वापस लाएं" दबाएं और कारण लिखें। वो फिर से "स्टॉक में" आ जाता है। |
| Step 5 | Check the history | इतिहास देखें |
| Step 5 text | The "History" list on the bundle shows each change, who made it and the reason. | Bundle पर "इतिहास" में हर बदलाव दिखता है, किसने किया और क्या कारण था। |
| Problem 1 | There's no "Void bundle" button | "Bundle रद्द करें" का बटन नहीं है |
| Fix 1 | Either the bundle isn't "In stock", or your role can't change bundle status. Ask a manager. | या तो bundle "स्टॉक में" नहीं है, या आपका रोल bundle का स्टेटस नहीं बदल सकता। मैनेजर से पूछें। |
| Problem 2 | I voided the wrong bundle | गलत bundle रद्द कर दिया |
| Fix 2 | Restore it straight away with a reason. The history keeps both changes. | तुरंत कारण लिखकर उसे वापस लाएं। इतिहास में दोनों बदलाव दर्ज रहते हैं। |

### Add or edit a die (`edit-die`)

| Part | English | हिंदी |
|---|---|---|
| Title | Add or edit a die | Die जोड़ें या बदलें |
| When | Use this when a new die arrives or a die's details change. | जब नया die आए या किसी die की जानकारी बदले। |
| Step 1 | Open Dies | Die खोलें |
| Step 1 text | Open "More", then "Dies". Tap "New die", or tap an existing die to edit it. | "और" खोलें, फिर "Die"। "नया die" दबाएं, या बदलने के लिए किसी die पर दबाएं। |
| Step 2 | Enter the code | कोड डालें |
| Step 2 text | Fill in the series, section code and name. The floor sees the section code when picking a die in Pack. | सीरीज़, सेक्शन कोड और नाम भरें। पैकिंग में die चुनते समय फ़्लोर को सेक्शन कोड ही दिखता है। |
| Step 3 | Set the weight range | वज़न रेंज डालें |
| Step 3 text | Enter the min and max weight in kg for one 12 ft length. Pack uses this range for the green or amber kg/12ft chip. | 12 ft लंबाई का कम से कम और ज़्यादा से ज़्यादा वज़न kg में डालें। पैकिंग में kg/12ft का हरा या पीला निशान इसी रेंज से आता है। |
| Step 4 | Set the status | स्टेटस चुनें |
| Step 4 text | "Active" dies show in Pack. "Archived" dies are hidden from Pack but keep all their bundles and history. | "चालू" die पैकिंग में दिखते हैं। "बंद" die पैकिंग में नहीं दिखते, पर उनके सारे bundle और इतिहास रहते हैं। |
| Step 5 | Add measurements if you have them | नाप हों तो डालें |
| Step 5 text | Width, thickness, oblique and leg are under "Advanced". They are optional. | चौड़ाई, मोटाई, oblique और लेग "एडवांस" में हैं। ये ज़रूरी नहीं हैं। |
| Step 6 | Save | सेव करें |
| Step 6 text | Tap "Save die". | "Die सेव करें" दबाएं। |
| Problem 1 | It says the code belongs to a deleted die | लिखा आया कि कोड एक डिलीट हुए die का है |
| Fix 1 | That code was used by a die that was deleted. Use a different code. | यह कोड पहले एक die का था जो डिलीट हो चुका है। दूसरा कोड डालें। |
| Problem 2 | I have many dies to add | बहुत सारे die जोड़ने हैं |
| Fix 2 | Use "Import CSV" from the menu on the Dies list. Owners and admins can also import from "Settings", then "Data". | Die की लिस्ट के मेन्यू से "CSV इम्पोर्ट करें" इस्तेमाल करें। मालिक और एडमिन "सेटिंग्स" में "डेटा" से भी इम्पोर्ट कर सकते हैं। |
| Problem 3 | I can't edit dies | Die बदल नहीं पा रहे |
| Fix 3 | Only managers, admins and owners can add or change dies. | Die सिर्फ़ मैनेजर, एडमिन और मालिक जोड़ या बदल सकते हैं। |

### Add a customer (`add-customer`)

| Part | English | हिंदी |
|---|---|---|
| Title | Add a customer | ग्राहक जोड़ें |
| When | Use this before the first dispatch to a new customer. | किसी नए ग्राहक के पहले dispatch से पहले। |
| Step 1 | Open Customers | ग्राहक खोलें |
| Step 1 text | Open "More", then "Customers", and tap "New customer". You can also tap "New customer" while creating a dispatch. | "और" खोलें, फिर "ग्राहक", और "नया ग्राहक" दबाएं। Dispatch बनाते समय भी "नया ग्राहक" दबा सकते हैं। |
| Step 2 | Name and contact | नाम और संपर्क |
| Step 2 text | Enter the name as it should print on the packing list, then the phone and email. | नाम वैसा लिखें जैसा पैकिंग लिस्ट पर छपना चाहिए, फिर फ़ोन और ईमेल। |
| Step 3 | GSTIN | GSTIN |
| Step 3 text | Enter the 15-character GSTIN if the customer has one. | ग्राहक का GSTIN हो तो 15 अक्षर का GSTIN डालें। |
| Step 4 | Addresses | पता |
| Step 4 text | Enter the billing address. If goods go to the same place, tick "Same as billing address". If not, fill in the shipping address. | बिलिंग का पता डालें। अगर माल उसी जगह जाता है, तो "बिलिंग वाला पता ही" पर टिक करें। नहीं तो डिलीवरी का पता भरें। |
| Step 5 | Save | सेव करें |
| Step 5 text | Tap "Save customer". Later, this page also lists every dispatch to the customer. | "ग्राहक सेव करें" दबाएं। बाद में इसी पेज पर इस ग्राहक के सारे dispatch भी दिखेंगे। |
| Problem 1 | The customer may already exist | शायद ग्राहक पहले से है |
| Fix 1 | Search the list by name, phone or GSTIN before adding, so the same customer isn't added twice. | जोड़ने से पहले लिस्ट में नाम, फ़ोन या GSTIN से खोज लें, ताकि एक ही ग्राहक दो बार न जुड़े। |
| Problem 2 | I can't add customers | ग्राहक नहीं जोड़ पा रहे |
| Fix 2 | Only managers, admins and owners can add or change customers. | ग्राहक सिर्फ़ मैनेजर, एडमिन और मालिक जोड़ या बदल सकते हैं। |

### Invite a team member and choose a role (`invite-member`)

| Part | English | हिंदी |
|---|---|---|
| Title | Invite a team member and choose a role | टीम में किसी को इनवाइट करें और रोल चुनें |
| When | Use this when someone new needs to use orrn for your company. | जब कोई नया व्यक्ति आपकी कंपनी के लिए orrn इस्तेमाल करेगा। |
| Step 1 | Open Team | टीम खोलें |
| Step 1 text | Open "Settings" and go to the "Team" tab. | "सेटिंग्स" खोलें और "टीम" टैब पर जाएं। |
| Step 2 | Enter their email | उनका ईमेल डालें |
| Step 2 text | Tap "Invite member" and type the email they will sign in with. | "सदस्य को इनवाइट करें" दबाएं और वो ईमेल लिखें जिससे वे साइन इन करेंगे। |
| Step 3 | Choose a role | रोल चुनें |
| Step 3 text | "Operator" for floor staff who pack, scan and print labels. "Manager" for staff who also run dispatches, dies, customers and printers. "Viewer" for people who only need to look. "Admin" for people who also manage the team and settings. | "ऑपरेटर" फ़्लोर स्टाफ़ के लिए जो पैक, स्कैन और लेबल प्रिंट करते हैं। "मैनेजर" उनके लिए जो dispatch, die, ग्राहक और प्रिंटर भी संभालते हैं। "व्यूअर" उनके लिए जिन्हें सिर्फ़ देखना है। "एडमिन" उनके लिए जो टीम और सेटिंग्स भी संभालते हैं। |
| Step 4 | Send the invite | इनवाइट भेजें |
| Step 4 text | Tap "Send invite". They get an email with a link that works for 7 days. | "इनवाइट भेजें" दबाएं। उन्हें एक ईमेल मिलेगा जिसका लिंक 7 दिन तक चलता है। |
| Step 5 | They join | वे जुड़ जाते हैं |
| Step 5 text | They open the link, enter their name and a password, and they are in. | वे लिंक खोलकर अपना नाम और पासवर्ड डालते हैं, और orrn में आ जाते हैं। |
| Step 6 | Change or remove later | बाद में बदलें या हटाएं |
| Step 6 text | From the Team list you can change a member's role or remove them. Only an owner can change another owner. | टीम की लिस्ट से किसी का रोल बदल सकते हैं या उसे हटा सकते हैं। मालिक का रोल सिर्फ़ दूसरा मालिक बदल सकता है। |
| Problem 1 | The email didn't arrive | ईमेल नहीं आया |
| Fix 1 | Ask them to check spam. If it isn't there, check the email address, cancel the invite and send a new one. | उनसे स्पैम फ़ोल्डर देखने को कहें। वहां भी न हो तो ईमेल पता जांचें, पुराना इनवाइट कैंसल करें और नया भेजें। |
| Problem 2 | The link has expired | लिंक पुराना हो गया |
| Fix 2 | Links work for 7 days. Cancel the old invite and send a new one. | लिंक 7 दिन चलता है। पुराना इनवाइट कैंसल करें और नया भेजें। |
| Problem 3 | I gave the wrong role | गलत रोल दे दिया |
| Fix 3 | Change it from the Team list. | टीम की लिस्ट से उसे बदल दें। |

### The printer isn't printing (`printer-trouble`)

| Part | English | हिंदी |
|---|---|---|
| Title | The printer isn't printing | प्रिंटर प्रिंट नहीं कर रहा |
| When | Use this when labels don't come out, come out blank, or the queue shows failed jobs. | जब लेबल नहीं निकल रहे, खाली निकल रहे हैं, या कतार में फ़ेल जॉब दिख रहे हैं। |
| Step 1 | Check the queue | कतार देखें |
| Step 1 text | Open "Printing" and look at the "Queue" tab. A failed job shows "Failed" and the reason. | "प्रिंटिंग" खोलें और "कतार" टैब देखें। फ़ेल जॉब पर "फ़ेल" और उसका कारण दिखता है। |
| Step 2 | Check the printer | प्रिंटर देखें |
| Step 2 text | Open the "Printers" tab. If the printer shows "Offline", check it is switched on, has labels loaded and its cable is connected. | "प्रिंटर" टैब खोलें। अगर प्रिंटर "ऑफ़लाइन" दिखे, तो देखें कि वो चालू है, उसमें लेबल लगे हैं और उसकी केबल जुड़ी है। |
| Step 3 | Check label printing | लेबल प्रिंटिंग देखें |
| Step 3 text | If every printer is "Offline", open "Settings", then "Printing". If it says "Not connected", the plant computer that sends labels to the printers is off or has no internet. Ask whoever looks after it to restart it. | अगर सारे प्रिंटर "ऑफ़लाइन" हैं, तो "सेटिंग्स" खोलें, फिर "प्रिंटिंग"। अगर वहां "जुड़ा नहीं है" लिखा है, तो प्लांट का वो कंप्यूटर जो प्रिंटर को लेबल भेजता है, बंद है या उसमें इंटरनेट नहीं है। जो उसे संभालता है, उससे उसे रीस्टार्ट करने को कहें। |
| Step 4 | Retry the job | जॉब फिर से भेजें |
| Step 4 text | Once the printer is back, a manager taps "Retry" on the failed job in the "Queue" tab. You can also reprint from the bundle or the packing session. | प्रिंटर चालू होने पर मैनेजर "कतार" टैब में फ़ेल जॉब पर "फिर से भेजें" दबाता है। Bundle या पैकिंग सेशन से भी फिर से प्रिंट कर सकते हैं। |
| Step 5 | Still stuck | फिर भी नहीं हुआ |
| Step 5 text | Note the reason shown on the failed job and send it to the orrn team. | फ़ेल जॉब पर लिखा कारण नोट करें और orrn टीम को भेजें। |
| Problem 1 | Labels come out blank | लेबल खाली निकल रहे हैं |
| Fix 1 | Check the label roll is loaded the right way round. If it still happens, ask a manager to tap "Send label design to printers" on the "Labels" tab. | देखें कि लेबल रोल सही तरफ़ से लगा है। फिर भी हो तो मैनेजर से "लेबल" टैब पर "लेबल डिज़ाइन प्रिंटर को भेजें" दबाने को कहें। |
| Problem 2 | It says "Label printing isn't set up" | "लेबल प्रिंटिंग सेट नहीं है" लिखा आया |
| Fix 2 | Label printing hasn't been set up for your company yet. Ask the orrn team. | आपकी कंपनी के लिए लेबल प्रिंटिंग अभी सेट नहीं हुई है। orrn टीम से कहें। |
| Problem 3 | There's no "Retry" button | "फिर से भेजें" का बटन नहीं है |
| Fix 3 | Only managers, admins and owners can retry or cancel jobs. Ask one of them. | जॉब फिर से भेजना या कैंसल करना सिर्फ़ मैनेजर, एडमिन और मालिक कर सकते हैं। उनमें से किसी से कहें। |
