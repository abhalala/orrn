# Hindi review

For Lalubhai. Every Hindi string in orrn, next to the English it comes from.

This file is generated from `packages/i18n` by `bun run --cwd packages/i18n export-review`. Don't edit it by hand. Send corrections as "key: new Hindi" (for example `pack.new.saveBundle: Bundle सेव करो`) and we update `hi.ts` and regenerate.

What to check:

1. Would someone on the floor understand it on first read?
2. Is it the word the plant actually uses? (for example ग्राहक or पार्टी, रद्द or कैंसल)
3. Words kept in English on purpose: bundle, die, dispatch, PO, kg, kg/12ft, serial numbers, codes, numbers, orrn. Tell us if any of these should be Hindi, or if more words should stay English.

Counts: 2149 screen strings in 39 groups, 12 guides with 220 strings.

## Screen strings

### common (67)

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
| `gujarati` | ગુજરાતી | ગુજરાતી |
| `reason` | Reason | कारण |
| `note` | Note | नोट |
| `noteRequired` | Write a note when you pick Other. | अन्य चुनें तो नोट लिखें। |
| `other` | Other | अन्य |
| `shift` | Shift | शिफ्ट |
| `productionDay` | Production day | प्रोडक्शन का दिन |
| `askApproval` | Ask for approval | मंज़ूरी मांगें |
| `waitingApproval` | Waiting for approval | मंज़ूरी का इंतज़ार |
| `plant` | Plant | प्लांट |

### units (12)

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
| `kgPerM` | kg/m | kg/m |
| `percent` | {value}% | {value}% |

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

### nav (41)

| Key | English | हिंदी |
|---|---|---|
| `main` | Main | मुख्य |
| `today` | Today | आज |
| `pack` | Pack | पैकिंग |
| `scan` | Scan | स्कैन |
| `stock` | Stock | स्टॉक |
| `dispatch` | Dispatch | Dispatch |
| `more` | More | और |
| `orders` | Orders | ऑर्डर |
| `dies` | Dies | Die |
| `customers` | Customers | ग्राहक |
| `store` | Store | स्टोर |
| `printing` | Printing | प्रिंटिंग |
| `guides` | Guides | गाइड |
| `settings` | Settings | सेटिंग्स |
| `preview` | Preview | प्रीव्यू |
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
| `purchase` | Purchase | खरीद |
| `approvals` | Approvals | मंज़ूरी |

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

### today (87)

| Key | English | हिंदी |
|---|---|---|
| `title` | Today | आज |
| `greetingMorning` | Good morning, {name} | नमस्ते, {name} |
| `greetingAfternoon` | Good afternoon, {name} | नमस्ते, {name} |
| `greetingEvening` | Good evening, {name} | नमस्ते, {name} |
| `numbersHeading` | Today so far | आज अब तक |
| `shortcutsHeading` | Shortcuts | शॉर्टकट |
| `inStock` | In stock | स्टॉक में |
| `packed` | Packed today | आज पैक हुआ |
| `dispatched` | Dispatched today | आज dispatch हुआ |
| `dispatchesDone` | {count} {count:dispatch\|dispatches} done | {count} dispatch {count:हुआ\|हुए} |
| `noDispatchYet` | No dispatch done yet | अभी कोई dispatch नहीं हुआ |
| `bundleUnit` | {count:bundle\|bundles} | {count:bundle\|bundle} |
| `inStockKg` | {kg} kg | {kg} kg |
| `nothingPackedYet` | No bundles yet | अभी कोई bundle नहीं |
| `tiles.pack` | Pack | पैकिंग |
| `tiles.packHint` | Start a packing session | पैकिंग सेशन शुरू करें |
| `tiles.dispatch` | Dispatch | Dispatch |
| `tiles.dispatchHint` | {count} open | {count} {count:खुला\|खुले} |
| `tiles.dispatchHintNone` | None open | कोई खुला नहीं |
| `tiles.dispatchHintAny` | Load a truck | गाड़ी लोड करें |
| `tiles.stock` | Stock | स्टॉक |
| `tiles.stockHint` | Bundles by section | सेक्शन के हिसाब से bundle |
| `tiles.guides` | Guides | गाइड |
| `tiles.guidesHint` | How each job is done | हर काम कैसे करें |
| `openDispatches` | Open dispatches | खुले dispatch |
| `noOpenDispatches` | No open dispatches | कोई dispatch खुला नहीं है |
| `noOpenDispatchesBody` | Dispatches being built or held show up here. | जो dispatch बन रहे हैं या होल्ड पर हैं, वे यहां दिखेंगे। |
| `allDispatches` | All dispatches | सभी dispatch |
| `sessionsTodayHeading` | Packing sessions today | आज के पैकिंग सेशन |
| `noSessionsToday` | Nothing packed yet today | आज अभी कुछ पैक नहीं हुआ |
| `sessionVoided` | All bundles void | सारे bundle रद्द |
| `noSessionsTodayBody` | Each packing session shows up here as it is saved. | हर पैकिंग सेशन सेव होते ही यहां दिखेगा। |
| `allSessions` | All sessions | सभी सेशन |
| `printProblemsCount` | {count} {count:label\|labels} didn't print | {count} लेबल प्रिंट नहीं {count:हुआ\|हुए} |
| `printProblemsBody` | Check the printer, then print them again from Printing. | प्रिंटर देखें, फिर प्रिंटिंग से दोबारा प्रिंट करें। |
| `openPrinting` | Open printing | प्रिंटिंग खोलें |
| `loadErrorTitle` | Today's numbers didn't load | आज के आंकड़े लोड नहीं हुए |
| `loadErrorBody` | Check the connection and try again. | इंटरनेट देखें और फिर से कोशिश करें। |
| `refreshFailed` | Couldn't refresh. Showing the numbers from {time}. | रीफ़्रेश नहीं हुआ। {time} तक के आंकड़े दिख रहे हैं। |
| `chartsErrorTitle` | Charts didn't load | चार्ट लोड नहीं हुए |
| `chartsErrorBody` | Reload the page to load them again. | चार्ट फिर से लाने के लिए पेज दोबारा लोड करें। |
| `reloadPage` | Reload page | पेज दोबारा लोड करें |
| `trendsHeading` | Trends | रुझान |
| `trend.title` | Packed and dispatched | पैक और dispatch |
| `trend.subtitle` | kg per day, last 90 days, today so far | रोज़ का kg, पिछले 90 दिन, आज अब तक |
| `trend.label` | Packed and dispatched, kg per day | पैक और dispatch, रोज़ का kg |
| `trend.packed` | Packed | पैक हुआ |
| `trend.dispatched` | Dispatched | Dispatch हुआ |
| `trend.dateHeader` | Date | तारीख |
| `trend.emptyTitle` | Nothing packed or dispatched in 90 days | 90 दिन में कुछ पैक या dispatch नहीं हुआ |
| `trend.emptyBody` | Each day's kg shows up here once bundles are packed or dispatched. | Bundle पैक या dispatch होते ही हर दिन का kg यहां दिखेगा। |
| `ageing.title` | Stock age | स्टॉक की उम्र |
| `ageing.subtitle` | kg in stock by days since packing | पैकिंग से अब तक के दिनों के हिसाब से स्टॉक का kg |
| `ageing.label` | Stock age, kg by days since packing | स्टॉक की उम्र, पैकिंग से दिनों के हिसाब से kg |
| `ageing.ageHeader` | Age | उम्र |
| `ageing.valueHeader` | In stock | स्टॉक में |
| `ageing.upTo15` | 0-15 days | 0-15 दिन |
| `ageing.upTo15Short` | 0-15 | 0-15 |
| `ageing.upTo30` | 16-30 days | 16-30 दिन |
| `ageing.upTo30Short` | 16-30 | 16-30 |
| `ageing.upTo60` | 31-60 days | 31-60 दिन |
| `ageing.upTo60Short` | 31-60 | 31-60 |
| `ageing.over60` | Over 60 days | 60 दिन से ज़्यादा |
| `ageing.over60Short` | 60+ | 60+ |
| `ageing.emptyTitle` | Nothing in stock | स्टॉक में कुछ नहीं |
| `ageing.emptyBody` | Packed bundles show up here by how long they have been waiting. | पैक हुए bundle यहां दिखेंगे, कितने दिन से रखे हैं उसके हिसाब से। |
| `startHere.title` | Start here | यहां से शुरू करें |
| `startHere.body` | A few things to set up before the floor starts using orrn. | फ़्लोर पर orrn चलाने से पहले ये कुछ काम कर लें। |
| `startHere.bodyWaiting` | Your admin is setting orrn up. Today's numbers show here once the first bundles are packed. | एडमिन orrn सेट कर रहे हैं। पहले bundle पैक होते ही आज के आंकड़े यहां दिखेंगे। |
| `startHere.addDie` | Add a die | Die जोड़ें |
| `startHere.addCustomer` | Add a customer | ग्राहक जोड़ें |
| `startHere.packFirst` | Pack your first bundles | पहले bundle पैक करें |
| `startHere.connectPrinter` | Connect a label printer | लेबल प्रिंटर जोड़ें |
| `startHere.progress` | {done} of {total} done | {total} में से {done} हो गए |
| `startHere.done` | Done | हो गया |
| `startHere.askAdmin` | An admin sets this up | यह एडमिन सेट करेंगे |
| `startHere.afterDie` | After a die is added | Die जुड़ने के बाद |
| `shiftNow` | {shift} shift, {day} | {shift} शिफ्ट, {day} |
| `floor.heading` | Floor | फ़्लोर |
| `floor.press` | Press | प्रेस |
| `floor.pressHint` | {count} queued | {count} कतार में |
| `floor.dieRoom` | Die room | Die रूम |
| `floor.dieRoomHint` | {count} to issue | {count} देनी हैं |
| `floor.orders` | Orders | ऑर्डर |
| `floor.ordersHint` | {count} open | {count} {count:खुला\|खुले} |
| `floor.ageing` | Ageing | एजिंग |
| `floor.ageingHint` | {count} in the oven | {count} ओवन में |

### pack (72)

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
| `partyNo` | Party no. | पार्टी नंबर |
| `forOrder` | For order | किस ऑर्डर के लिए |
| `plantStock` | Plant stock | प्लांट स्टॉक |
| `ageingRow` | From ageing | एजिंग से |
| `recut` | Cut shorter | छोटा काटा |
| `standard` | Standard | स्टैंडर्ड |
| `showLogo` | Print logo | लोगो प्रिंट करें |
| `dieOwned` | This die belongs to {name} | यह die {name} की है |
| `scale.title` | Scale | कांटा |
| `scale.stable` | Steady | स्थिर |
| `scale.waiting` | Waiting for a steady weight | स्थिर वज़न का इंतज़ार |
| `scale.stale` | The scale stopped sending | कांटे से वज़न नहीं आ रहा |
| `scale.useScale` | Use scale weight | कांटे का वज़न लें |
| `scale.typed` | Typed | हाथ से लिखा |
| `scale.typedReason` | Why type the weight | वज़न हाथ से क्यों लिखा |
| `reject.title` | Rejects | रिजेक्ट |
| `reject.add` | Add reject | रिजेक्ट जोड़ें |
| `reject.pcs` | Pieces | पीस |
| `reject.kg` | kg | kg |
| `reject.saved` | {count} {count:piece\|pieces} rejected | {count} पीस रिजेक्ट |

### scan (41)

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
| `continuous.reallocationPending` | Waiting on a reallocation approval | reallocation की मंज़ूरी बाकी है |
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
| `continuous.dieOwned` | Die belongs to {name} | Die {name} की है |
| `continuous.otherOrder` | On another customer's order | दूसरे ग्राहक के ऑर्डर पर |
| `continuous.overCapacity` | {kg} kg over the truck's capacity | गाड़ी की क्षमता से {kg} kg ज़्यादा |

### stock (61)

| Key | English | हिंदी |
|---|---|---|
| `title` | Stock | स्टॉक |
| `sections` | Sections | सेक्शन |
| `bundles` | Bundles | Bundle |
| `searchSections` | Search die or section | Die या सेक्शन खोजें |
| `totals` | {bundles} {bundles:bundle\|bundles} · {kg} kg in stock | स्टॉक में {bundles} bundle · {kg} kg |
| `heldChip` | {count} held | {count} होल्ड पर |
| `heldKg` | {count} held, {kg} kg | {count} होल्ड पर, {kg} kg |
| `empty` | No stock yet. Bundles show up here after packing. | अभी स्टॉक नहीं है। पैकिंग के बाद bundle यहां दिखेंगे। |
| `emptyAction` | Start a packing session | पैकिंग सेशन शुरू करें |
| `view` | Stock view | स्टॉक व्यू |
| `filterStatus` | Status | स्टेटस |
| `clearSearch` | Clear search | खोज हटाएं |
| `sectionsFound` | {count} {count:section\|sections} found | {count} सेक्शन {count:मिला\|मिले} |
| `loadError` | Stock didn't load. Check the connection, then try again. | स्टॉक लोड नहीं हुआ। इंटरनेट देखें, फिर दोबारा कोशिश करें। |
| `noPermission` | Your role can't do this. Ask your admin. | आपके रोल को यह करने की अनुमति नहीं है। अपने एडमिन से पूछें। |
| `reprintSent` | Label sent to printer | लेबल प्रिंटर को भेजा |
| `reprintNoPrinter` | No label printer is set up. Ask your admin to connect one in Printing. | कोई लेबल प्रिंटर सेट नहीं है। एडमिन से Printing में प्रिंटर जोड़ने को कहें। |
| `reprintFailed` | The label didn't print. Check that the print station is on, then try again. | लेबल प्रिंट नहीं हुआ। देखें कि प्रिंट स्टेशन चालू है, फिर दोबारा कोशिश करें। |
| `block.unitInStock` | {count:bundle\|bundles} in stock | {count:bundle\|bundle} स्टॉक में |
| `block.unitHeld` | {count:bundle\|bundles} held | {count:bundle\|bundle} होल्ड पर |
| `block.band` | {band} kg/12ft | {band} kg/12ft |
| `block.kg` | {kg} kg | {kg} kg |
| `charts.ageTitle` | Stock age | स्टॉक कितना पुराना |
| `charts.ageSubtitle` | kg on the floor, in stock and held, by days since packing | फ़्लोर पर kg, स्टॉक और होल्ड, पैकिंग के बाद के दिनों के हिसाब से |
| `charts.ageLabel` | Stock age, kg by days since packing | स्टॉक की उम्र, पैकिंग के बाद के दिनों के हिसाब से kg |
| `charts.ageHeader` | Age | उम्र |
| `charts.kgHeader` | kg | kg |
| `charts.bucket` | {range} days | {range} दिन |
| `charts.topTitle` | Top sections | सबसे ज़्यादा स्टॉक वाले सेक्शन |
| `charts.topSubtitle` | kg in stock and held per section, top 8 and the rest | हर सेक्शन का स्टॉक और होल्ड का kg, टॉप 8 और बाकी |
| `charts.topLabel` | Sections by kg on the floor | फ़्लोर पर kg के हिसाब से सेक्शन |
| `charts.otherSections` | Other sections | बाकी सेक्शन |
| `charts.loadFailed` | Charts didn't load. Check the connection, then try again. | चार्ट लोड नहीं हुए। इंटरनेट देखें, फिर दोबारा कोशिश करें। |
| `section.title` | Section {code} | सेक्शन {code} |
| `section.empty` | No bundles with this status. | इस स्टेटस का कोई bundle नहीं है। |
| `section.emptyAll` | No bundles packed for this section yet. | इस सेक्शन का अभी कोई bundle पैक नहीं हुआ। |
| `section.nothingOnFloor` | Nothing on the floor | फ़्लोर पर कुछ नहीं |
| `section.heroUnit` | {count:bundle\|bundles} | {count:bundle\|bundle} |
| `section.band` | Weight range {band} kg/12ft | वज़न रेंज {band} kg/12ft |
| `section.dieDetails` | Die details | Die की जानकारी |
| `section.bundlesLabel` | Bundles of {section} | {section} के bundle |
| `list.title` | All bundles | सारे bundle |
| `list.search` | Search serial or PO | Serial या PO खोजें |
| `list.empty` | No bundles match this filter. | इस फ़िल्टर में कोई bundle नहीं है। |
| `list.bundlesLabel` | Bundles | Bundle |
| `list.filterDie` | Showing one section | एक सेक्शन दिख रहा है |
| `list.filterGroup` | Showing one packing session | एक पैकिंग सेशन दिख रहा है |
| `list.filterDieNamed` | Showing {section} | {section} दिख रहा है |
| `list.filterGroupNamed` | Showing packing session {code} | पैकिंग सेशन {code} दिख रहा है |
| `list.clearFilter` | Show all bundles | सारे bundle दिखाएं |
| `columns.serial` | Serial | Serial |
| `columns.die` | Die | Die |
| `columns.section` | Section | सेक्शन |
| `columns.weight` | Weight (kg) | वज़न (kg) |
| `columns.pieces` | Pcs | पीस |
| `columns.cutLength` | Cut length | कट लंबाई |
| `columns.piecesLength` | Pcs × cut length | पीस × कट लंबाई |
| `columns.kgPer12ft` | kg/12ft | kg/12ft |
| `columns.status` | Status | स्टेटस |
| `columns.po` | PO | PO |
| `columns.packed` | Packed | पैक हुआ |

### bundle (54)

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
| `facts.dieBand` | Die range /12' | Die रेंज /12' |
| `facts.packed` | Packed | पैक हुआ |
| `history` | History | इतिहास |
| `historyPacked` | Packed | पैक हुआ |
| `historyImported` | Imported | इम्पोर्ट हुआ |
| `historyHeld` | Held for a dispatch | Dispatch के लिए होल्ड हुआ |
| `historyReleased` | Released from a dispatch | Dispatch से हटा |
| `historyDispatched` | Dispatched | Dispatch हो गया |
| `historyVoided` | Voided | रद्द हुआ |
| `historyRestored` | Restored | वापस आया |
| `openDispatch` | Open dispatch {code} | Dispatch {code} खोलें |
| `openDispatchPlain` | Open the dispatch | Dispatch खोलें |
| `alreadyInDispatch` | Already in {code} | पहले से {code} में है |
| `addNotFound` | This bundle isn't in this company. | यह bundle इस कंपनी में नहीं है। |
| `addFailed` | The bundle wasn't added. Try again. | Bundle नहीं जुड़ा। दोबारा कोशिश करें। |
| `newDispatch` | New dispatch | नया dispatch |
| `dispatchesLoadError` | Dispatches didn't load. Try again. | Dispatch लोड नहीं हुए। दोबारा कोशिश करें। |
| `reasonRequired` | Write why this bundle is void. | लिखें कि यह bundle क्यों रद्द है। |
| `howToReprint` | How to reprint | दोबारा प्रिंट कैसे करें |
| `howToVoid` | How to void or restore | रद्द या वापस कैसे करें |
| `actionsLabel` | Bundle actions | Bundle के काम |
| `transitionFailed` | The bundle didn't change. Try again. | Bundle नहीं बदला। दोबारा कोशिश करें। |
| `changedElsewhere` | This bundle changed since you opened it. The page now shows where it is. | आपके खोलने के बाद यह bundle बदल गया। पेज अब इसकी अभी की हालत दिखा रहा है। |
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

### dispatch (137)

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
| `emptyHeld` | Nothing is held right now. | अभी कुछ होल्ड पर नहीं है। |
| `emptyDispatched` | Nothing has been dispatched yet. | अभी तक कोई dispatch नहीं हुआ। |
| `emptyCancelled` | No cancelled dispatches. | कोई कैंसल dispatch नहीं है। |
| `emptySearch` | No dispatch matches "{query}". | "{query}" से कोई dispatch नहीं मिला। |
| `showBuilding` | Show building | बन रहे दिखाएं |
| `show` | Show | दिखाएं |
| `search` | Search dispatches | Dispatch खोजें |
| `searchHint` | Code or notes | कोड या नोट |
| `listLabel` | Dispatches | Dispatch |
| `loadError` | Dispatches didn't load. Check the connection and try again. | Dispatch लोड नहीं हुए। इंटरनेट देखें और फिर से कोशिश करें। |
| `volume.title` | Dispatch volume | Dispatch मात्रा |
| `volume.subtitle` | kg dispatched per month, last 12 months | हर महीने dispatch हुआ kg, पिछले 12 महीने |
| `volume.label` | Dispatch volume, kg per month | Dispatch मात्रा, हर महीने kg |
| `volume.month` | Month | महीना |
| `volume.kg` | Dispatched | Dispatch हुआ |
| `new.title` | New dispatch | नया dispatch |
| `new.customer` | Customer | ग्राहक |
| `new.customerSearch` | Search customers | ग्राहक खोजें |
| `new.newCustomer` | New customer | नया ग्राहक |
| `new.shipDate` | Ship date | भेजने की तारीख |
| `new.notes` | Notes | नोट |
| `new.submit` | Create dispatch | Dispatch बनाएं |
| `new.customerHint` | Recent customers first. Type to search. | हाल के ग्राहक पहले। खोजने के लिए टाइप करें। |
| `new.customerRequired` | Pick a customer. | ग्राहक चुनें। |
| `new.customerName` | Customer name | ग्राहक का नाम |
| `new.customerPhone` | Phone | फ़ोन |
| `new.addCustomer` | Add customer | ग्राहक जोड़ें |
| `new.customerAdded` | Added {name} | {name} जोड़ा गया |
| `new.created` | Created {code} | {code} बन गया |
| `new.shipDateHint` | Leave it blank if the date isn't fixed yet. | तारीख तय न हो तो खाली छोड़ दें। |
| `new.noAccess` | Your role can't start a dispatch. Ask the office to create one. | आपका रोल dispatch शुरू नहीं कर सकता। ऑफ़िस से बनवाएं। |
| `detail.loadError` | This dispatch didn't load. Check the connection and try again. | यह dispatch लोड नहीं हुआ। इंटरनेट देखें और फिर से कोशिश करें। |
| `detail.shipOn` | Ship {date} | {date} को भेजना है |
| `detail.noShipDate` | No ship date | भेजने की तारीख तय नहीं |
| `detail.dispatchedOn` | Dispatched {date} | {date} को dispatch हुआ |
| `detail.editDetails` | Edit details | जानकारी बदलें |
| `detail.saveDetails` | Save details | जानकारी सेव करें |
| `detail.detailsSaved` | Details saved | जानकारी सेव हो गई |
| `detail.viewOnly` | You can see this dispatch. Changes are made by the office. | आप यह dispatch देख सकते हैं। बदलाव ऑफ़िस करता है। |
| `detail.justDispatched` | {code} dispatched | {code} dispatch हो गया |
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
| `build.undo` | Undo | वापस लाएं |
| `build.added` | Added {serial} | {serial} जुड़ा |
| `build.bundlesIn` | Bundles in this dispatch | इस dispatch के bundle |
| `build.colBundle` | Bundle no | Bundle नंबर |
| `build.colWeight` | Weight kg | वज़न kg |
| `build.colPcs` | Pcs | पीस |
| `build.colLength` | Cut length | कट लंबाई |
| `build.colKg12` | kg/12ft | kg/12ft |
| `build.colActions` | Actions | काम |
| `build.setLabel` | Set label | लेबल लगाएं |
| `build.changeLabel` | Change label | लेबल बदलें |
| `build.labelFor` | Packing group label for {group} | {group} का पैकिंग ग्रुप लेबल |
| `build.labelHint` | A short mark like A or B. It groups these bundles on the packing list. | A या B जैसा छोटा निशान। पैकिंग लिस्ट में ये bundle एक साथ आएंगे। |
| `build.saveLabel` | Save label | लेबल सेव करें |
| `build.clearLabel` | Remove label | लेबल हटाएं |
| `build.labelSaved` | Label saved | लेबल सेव हो गया |
| `build.labelCleared` | Label removed | लेबल हट गया |
| `build.labelPartial` | Saved on {done} of {total} bundles. Save again for the rest. | {total} में से {done} bundle पर सेव हुआ। बाकी के लिए फिर से सेव करें। |
| `build.groupNamed` | Group {label} | ग्रुप {label} |
| `build.searchTitle` | Search to add | खोज कर जोड़ें |
| `build.searchLabel` | Serial or PO | Serial या PO |
| `build.searchHint` | Only bundles in stock are listed. | सिर्फ़ स्टॉक वाले bundle दिखते हैं। |
| `build.searchStart` | Type part of a serial or PO number. | Serial या PO नंबर का कुछ हिस्सा टाइप करें। |
| `build.searchEmpty` | No bundle in stock matches "{query}". | "{query}" से स्टॉक में कोई bundle नहीं मिला। |
| `build.add` | Add | जोड़ें |
| `build.inDispatch` | Added | जुड़ गया |
| `build.notHeld` | Not held | होल्ड नहीं |
| `build.labelNotBack` | {serial} is back without its label {label}. Set the label again. | {serial} वापस आ गया, पर लेबल {label} के बिना। लेबल फिर से लगाएं। |
| `build.blockedBuild` | {count} {count:bundle\|bundles} can't be held. Remove {count:it\|them} to go on. | {count} bundle होल्ड नहीं हो {count:सकता\|सकते}। आगे बढ़ने के लिए {count:इसे\|इन्हें} हटाएं। |
| `build.blockedHeld` | {count} {count:bundle\|bundles} can't go out. Release the stock, remove {count:it\|them}, then hold again. | {count} bundle नहीं जा {count:सकता\|सकते}। होल्ड हटाएं, {count:इसे\|इन्हें} हटाएं, फिर से होल्ड करें। |
| `paste.title` | Paste serials | Serial पेस्ट करें |
| `paste.label` | Serials | Serial |
| `paste.hint` | One per line, or separated by commas or spaces. | हर लाइन में एक, या कॉमा या स्पेस से अलग करके। |
| `paste.submit` | Add bundles | Bundle जोड़ें |
| `paste.added` | {count} added | {count} {count:जुड़ा\|जुड़े} |
| `paste.already` | {count} already in this dispatch | {count} इस dispatch में पहले से {count:है\|हैं} |
| `paste.notFound` | {count} not found | {count} नहीं {count:मिला\|मिले} |
| `paste.unavailable` | {count} not available | {count} उपलब्ध नहीं {count:है\|हैं} |
| `paste.found` | {count} {count:serial\|serials} to add | जोड़ने के लिए {count} serial |
| `paste.adding` | Adding {done} of {total} | {total} में से {done} जोड़ रहे हैं |
| `paste.nothingFound` | No serials found. Paste one per line. | कोई serial नहीं मिला। हर लाइन में एक पेस्ट करें। |
| `paste.reportTitle` | What happened | क्या हुआ |
| `paste.pasteMore` | Paste more | और पेस्ट करें |
| `paste.stopped` | Stopped after {done} of {total}. The rest weren't sent. | {total} में से {done} के बाद रुक गया। बाकी नहीं भेजे गए। |
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
| `holdHint` | Holding keeps these bundles for {customer}. Nobody can add them to another dispatch. | होल्ड करने से ये bundle {customer} के लिए रुक जाते हैं। कोई इन्हें दूसरे dispatch में नहीं जोड़ सकता। |
| `releaseTitle` | Release the held stock? | होल्ड हटाएं? |
| `releaseBody` | The bundles go back to stock and this dispatch goes back to Building. | Bundle वापस स्टॉक में जाएंगे और यह dispatch फिर से बनने लगेगा। |
| `errors.empty` | Add at least one bundle first. | पहले कम से कम एक bundle जोड़ें। |
| `errors.conflict` | Some bundles changed since this page loaded. The ones that can't go are marked in the list. | पेज खुलने के बाद कुछ bundle बदल गए। जो नहीं जा सकते, उन पर लिस्ट में निशान है। |
| `errors.moved` | This dispatch has moved on. Reload to see where it is now. | यह dispatch आगे बढ़ चुका है। ताज़ा स्थिति के लिए पेज रीलोड करें। |
| `capacity.label` | Truck capacity (kg) | गाड़ी की क्षमता (kg) |
| `capacity.fill` | {pct}% full | {pct}% भरी |
| `capacity.near` | Nearly full | लगभग भरी |
| `capacity.over` | {kg} kg over capacity | क्षमता से {kg} kg ज़्यादा |
| `capacity.overReason` | Why load over capacity | क्षमता से ज़्यादा क्यों लोड किया |
| `transporter.label` | Transporter | ट्रांसपोर्टर |
| `transporter.add` | Add transporter | ट्रांसपोर्टर जोड़ें |
| `transporter.none` | No transporter | कोई ट्रांसपोर्टर नहीं |

### packingList (50)

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
| `dispatch` | Dispatch | Dispatch |
| `gstin` | GSTIN | GSTIN |
| `notSet` | Not set | तय नहीं |
| `rowsLabel` | Packing list rows | पैकिंग लिस्ट की लाइनें |
| `groupNamed` | Group {label} | ग्रुप {label} |
| `groupTotalOf` | Total {label} | {label} का कुल |
| `loadError` | This packing list couldn't be read. Regenerate it to build it again. | यह पैकिंग लिस्ट पढ़ी नहीं जा सकी। इसे फिर से बनाएं। |
| `missing` | This dispatch has no packing list yet. | इस dispatch की पैकिंग लिस्ट अभी नहीं बनी। |
| `make` | Make packing list | पैकिंग लिस्ट बनाएं |
| `made` | Packing list made | पैकिंग लिस्ट बन गई |
| `downloadFailed` | The file couldn't be made. Try again. | फ़ाइल नहीं बन पाई। फिर से कोशिश करें। |
| `v2.revision` | Revision {n} | संशोधन {n} |
| `v2.regenerate` | Make a new revision | नया संशोधन बनाएं |
| `v2.changes` | Changes from revision {n} | संशोधन {n} से बदलाव |
| `v2.added` | {count} added | {count} {count:जुड़ा\|जुड़े} |
| `v2.removed` | {count} removed | {count} हटे |
| `v2.changed` | {count} changed | {count} बदले |
| `v2.same` | No changes | कोई बदलाव नहीं |
| `v2.combine` | Combine lists | लिस्ट मिलाएं |
| `v2.combinedInto` | Combined into {code} | {code} में मिलाई गई |
| `v2.showBranding` | Show company name | कंपनी का नाम दिखाएं |
| `v2.showOriginalSo` | Show original order | पहला ऑर्डर दिखाएं |
| `v2.partyNo` | Party no. | पार्टी नंबर |
| `v2.summary.hollow` | Hollow | हॉलो |
| `v2.summary.solid` | Solid | सॉलिड |
| `v2.summary.semi` | Semi hollow | सेमी हॉलो |

### dies (60)

| Key | English | हिंदी |
|---|---|---|
| `title` | Dies | Die |
| `subtitle` | Weight bands and measurements for every die. | हर die का वज़न रेंज और नाप। |
| `newDie` | New die | नया die |
| `search` | Search code, series or section | कोड, सीरीज़ या सेक्शन खोजें |
| `searchLabel` | Search dies | Die खोजें |
| `listLabel` | Dies | Die |
| `columns.code` | Die | Die |
| `columns.series` | Series | सीरीज़ |
| `columns.section` | Section | सेक्शन |
| `columns.name` | Name | नाम |
| `columns.range` | Range (kg/12ft) | रेंज (kg/12ft) |
| `columns.status` | Status | स्टेटस |
| `rangeValue` | {min}-{max} | {min}-{max} |
| `unnamed` | No name | कोई नाम नहीं |
| `empty` | No dies yet. | अभी कोई die नहीं है। |
| `emptyBody` | Add a die, or import the catalogue from a CSV file. | Die जोड़ें, या CSV फ़ाइल से कैटलॉग इम्पोर्ट करें। |
| `emptyAction` | Add a die | Die जोड़ें |
| `importCsv` | Import CSV | CSV इम्पोर्ट करें |
| `pageEmpty` | Nothing on this page. | इस पेज पर कुछ नहीं है। |
| `firstPage` | Go to the first page | पहले पेज पर जाएं |
| `detail.band` | Weight per 12 ft | 12 ft का वज़न |
| `detail.bandValue` | {min} to {max} | {min} से {max} |
| `detail.measurements` | Measurements | नाप |
| `detail.noMeasurements` | No measurements yet. | अभी कोई नाप नहीं है। |
| `detail.code` | Code | कोड |
| `detail.seeStock` | See stock | स्टॉक देखें |
| `detail.edit` | Edit die | Die बदलें |
| `detail.editTitle` | Edit die {code} | Die {code} बदलें |
| `detail.notFound` | This die doesn't exist or was deleted. | यह die नहीं मिला या डिलीट हो गया है। |
| `detail.backToList` | Back to dies | Die की लिस्ट पर वापस |
| `detail.delete` | Delete die | Die डिलीट करें |
| `detail.deleteTitle` | Delete die {code}? | Die {code} डिलीट करें? |
| `detail.deleteBody` | It leaves this list and Pack. Bundles already packed keep it. | यह इस लिस्ट और पैकिंग से हट जाएगा। जो bundle पैक हो चुके हैं, उनमें यह रहेगा। |
| `detail.deleted` | Die deleted | Die डिलीट हो गया |
| `detail.loadFailed` | This die didn't load. Check the connection and try again. | यह die लोड नहीं हुआ। इंटरनेट जांच कर फिर से कोशिश करें। |
| `form.titleNew` | New die | नया die |
| `form.titleEdit` | Die {code} | Die {code} |
| `form.series` | Series | सीरीज़ |
| `form.sectionCode` | Section code | सेक्शन कोड |
| `form.name` | Name | नाम |
| `form.weightMin` | Min weight (kg/12ft) | कम से कम वज़न (kg/12ft) |
| `form.weightMax` | Max weight (kg/12ft) | ज़्यादा से ज़्यादा वज़न (kg/12ft) |
| `form.rangeHint` | Weight of one 12 ft length, in kg. | 12 ft लंबाई का वज़न, kg में। |
| `form.rangeOrder` | Max weight can't be less than min weight. | ज़्यादा से ज़्यादा वज़न, कम से कम वज़न से कम नहीं हो सकता। |
| `form.status` | Status | स्टेटस |
| `form.statusHint` | Archived dies don't show in Pack. | बंद die पैकिंग में नहीं दिखते। |
| `form.notes` | Notes | नोट |
| `form.advanced` | Advanced | एडवांस |
| `form.advancedHint` | Width, thickness and leg. All optional. | चौड़ाई, मोटाई और लेग। सब ज़रूरी नहीं। |
| `form.measureHintMm` | In mm. | mm में। |
| `form.measureHintInch` | In inches, like 0.125 for 1/8 in. | इंच में, जैसे 1/8 in के लिए 0.125। |
| `form.width` | Width | चौड़ाई |
| `form.thickness` | Thickness | मोटाई |
| `form.leg` | Leg | लेग |
| `form.submit` | Save die | Die सेव करें |
| `form.saved` | Die saved | Die सेव हो गया |
| `form.codeTaken` | This code belongs to a deleted die. Use a different code. | यह कोड एक डिलीट हुए die का है। दूसरा कोड डालें। |
| `form.duplicate` | A die with this series and section code already exists. | इस सीरीज़ और सेक्शन कोड का die पहले से है। |
| `form.fixErrors` | Check the fields marked in red. | लाल निशान वाले खाने जांचें। |
| `form.cantAdd` | Your role can't add dies. Ask an admin if you need it. | आपका रोल die नहीं जोड़ सकता। ज़रूरत हो तो एडमिन से कहें। |

### customers (109)

| Key | English | हिंदी |
|---|---|---|
| `title` | Customers | ग्राहक |
| `subtitle` | Who buys from the plant, and how much. | प्लांट से कौन खरीदता है, और कितना। |
| `newCustomer` | New customer | नया ग्राहक |
| `search` | Search name, phone or GSTIN | नाम, फ़ोन या GSTIN खोजें |
| `searchLabel` | Search customers | ग्राहक खोजें |
| `listLabel` | Customers | ग्राहक |
| `columns.name` | Name | नाम |
| `columns.phone` | Phone | फ़ोन |
| `columns.gstin` | GSTIN | GSTIN |
| `columns.city` | City | शहर |
| `columns.kg` | Dispatched (kg) | Dispatch हुआ (kg) |
| `empty` | No customers yet. | अभी कोई ग्राहक नहीं है। |
| `emptyBody` | Add a customer before their first dispatch. | पहले dispatch से पहले ग्राहक जोड़ें। |
| `emptyAction` | Add a customer | ग्राहक जोड़ें |
| `importCsv` | Import CSV | CSV इम्पोर्ट करें |
| `pageEmpty` | Nothing on this page. | इस पेज पर कुछ नहीं है। |
| `firstPage` | Go to the first page | पहले पेज पर जाएं |
| `kgFailed` | The dispatched kg didn't load. | Dispatch हुआ kg लोड नहीं हुआ। |
| `period.label` | Period | समय |
| `period.month` | This month | इस महीने |
| `period.quarter` | This quarter | इस तिमाही |
| `period.fy` | This year | इस साल |
| `period.range` | {from} to {to} | {from} से {to} |
| `leaderboard.title` | Who is leading | सबसे आगे कौन |
| `leaderboard.subtitle` | kg dispatched per customer. {total} kg in all. | हर ग्राहक को dispatch हुआ kg। कुल {total} kg। |
| `leaderboard.subtitleShort` | kg dispatched per customer. | हर ग्राहक को dispatch हुआ kg। |
| `leaderboard.label` | Customers by kg dispatched | dispatch हुए kg के हिसाब से ग्राहक |
| `leaderboard.otherShare` | Other customers ({share}) | बाकी ग्राहक ({share}) |
| `leaderboard.valueHeader` | Dispatched | Dispatch हुआ |
| `form.titleNew` | New customer | नया ग्राहक |
| `form.name` | Name | नाम |
| `form.nameHint` | As it should print on the packing list. | जैसा पैकिंग लिस्ट पर छपना चाहिए। |
| `form.phone` | Phone | फ़ोन |
| `form.email` | Email | ईमेल |
| `form.gstin` | GSTIN | GSTIN |
| `form.gstinHint` | 15 characters, from the customer's GST certificate. | 15 अक्षर, ग्राहक के GST सर्टिफ़िकेट से। |
| `form.gstinInvalid` | A GSTIN has 15 letters and numbers. Check it and try again. | GSTIN में 15 अक्षर और अंक होते हैं। जांच कर फिर से डालें। |
| `form.gstinLegacy` | This GSTIN isn't 15 letters and numbers. Check it against the GST certificate when you can. | यह GSTIN 15 अक्षर और अंक का नहीं है। समय मिलने पर GST सर्टिफ़िकेट से मिलाएं। |
| `form.notes` | Notes | नोट |
| `form.billingAddress` | Billing address | बिलिंग का पता |
| `form.shippingAddress` | Shipping address | डिलीवरी का पता |
| `form.sameAsBilling` | Same as billing address | बिलिंग वाला पता ही |
| `form.addressLine` | Address | पता |
| `form.addressLine2` | Address line 2 | पता, दूसरी लाइन |
| `form.city` | City | शहर |
| `form.state` | State | राज्य |
| `form.pincode` | PIN code | पिन कोड |
| `form.submit` | Save customer | ग्राहक सेव करें |
| `form.saved` | Customer saved | ग्राहक सेव हो गया |
| `form.fixErrors` | Check the fields marked in red. | लाल निशान वाले खाने जांचें। |
| `form.cantAdd` | Your role can't add customers. Ask an admin if you need it. | आपका रोल ग्राहक नहीं जोड़ सकता। ज़रूरत हो तो एडमिन से कहें। |
| `detail.gstin` | GSTIN {gstin} | GSTIN {gstin} |
| `detail.lastToday` | Last dispatch today | आखिरी dispatch आज |
| `detail.lastYesterday` | Last dispatch yesterday | आखिरी dispatch कल |
| `detail.lastDaysAgo` | Last dispatch {count} {count:day\|days} ago | आखिरी dispatch {count} दिन पहले |
| `detail.lastNever` | No dispatches yet | अभी कोई dispatch नहीं |
| `detail.cadence` | every ~{count} {count:day\|days} | हर ~{count} दिन में |
| `detail.edit` | Edit customer | ग्राहक बदलें |
| `detail.editTitle` | Edit {name} | {name} बदलें |
| `detail.contact` | Contact | संपर्क |
| `detail.noContact` | No phone or email yet. | अभी कोई फ़ोन या ईमेल नहीं है। |
| `detail.noAddress` | No address yet. | अभी कोई पता नहीं है। |
| `detail.sameAsBilling` | Same as billing address | बिलिंग वाला पता ही |
| `detail.notFound` | This customer doesn't exist or was deleted. | यह ग्राहक नहीं मिला या डिलीट हो गया है। |
| `detail.backToList` | Back to customers | ग्राहकों की लिस्ट पर वापस |
| `detail.loadFailed` | This customer didn't load. Check the connection and try again. | यह ग्राहक लोड नहीं हुआ। इंटरनेट जांच कर फिर से कोशिश करें। |
| `detail.delete` | Delete customer | ग्राहक डिलीट करें |
| `detail.deleteTitle` | Delete {name}? | {name} को डिलीट करें? |
| `detail.deleteBody` | They leave this list and the dispatch picker. Past dispatches and packing lists keep their name. | यह इस लिस्ट और dispatch चुनने की लिस्ट से हट जाएगा। पुराने dispatch और पैकिंग लिस्ट में नाम रहेगा। |
| `detail.deleted` | Customer deleted | ग्राहक डिलीट हो गया |
| `detail.kpi.kg` | Dispatched | Dispatch हुआ |
| `detail.kpi.dispatches` | Dispatches | Dispatch |
| `detail.kpi.avgLoad` | Average load | औसत लोड |
| `detail.kpi.share` | Share of all dispatches | सभी dispatch में हिस्सा |
| `detail.kpi.shareOf` | of {total} kg in all | कुल {total} kg में से |
| `detail.kpi.perDispatch` | kg per dispatch | kg हर dispatch |
| `detail.kpi.analyticsFailed` | These numbers didn't load. | ये आंकड़े लोड नहीं हुए। |
| `detail.kpi.shareFailed` | The total didn't load. | कुल आंकड़ा लोड नहीं हुआ। |
| `detail.volume.title` | Monthly volume | हर महीने का माल |
| `detail.volume.subtitle` | kg dispatched per month, last 12 months | हर महीने dispatch हुआ kg, पिछले 12 महीने |
| `detail.volume.label` | kg dispatched per month | हर महीने dispatch हुआ kg |
| `detail.volume.month` | Month | महीना |
| `detail.volume.value` | Dispatched | Dispatch हुआ |
| `detail.sections.title` | What they buy | क्या खरीदते हैं |
| `detail.sections.subtitle` | Top sections by kg dispatched in this period | इस समय में kg के हिसाब से टॉप सेक्शन |
| `detail.sections.label` | Sections by kg dispatched | dispatch हुए kg के हिसाब से सेक्शन |
| `detail.sections.other` | Other sections | बाकी सेक्शन |
| `detail.sections.otherShare` | Other sections ({share}) | बाकी सेक्शन ({share}) |
| `detail.sections.valueHeader` | Dispatched | Dispatch हुआ |
| `detail.recent.title` | Recent dispatches | हाल के dispatch |
| `detail.recent.label` | Recent dispatches | हाल के dispatch |
| `detail.recent.code` | Dispatch | Dispatch |
| `detail.recent.date` | Date | तारीख |
| `detail.recent.status` | Status | स्टेटस |
| `detail.recent.bundles` | Bundles | Bundle |
| `detail.recent.kg` | kg | kg |
| `detail.openOrders.title` | Open orders | बाकी ऑर्डर |
| `detail.openOrders.ordered` | Ordered | ऑर्डर हुआ |
| `detail.openOrders.dispatched` | Dispatched | Dispatch हुआ |
| `detail.openOrders.baki` | Baki | बाकी |
| `detail.openOrders.lines` | {count} {count:line\|lines} | {count} लाइन |
| `dispatches` | Dispatches | Dispatch |
| `noDispatches` | No dispatches for this customer yet. | इस ग्राहक का अभी कोई dispatch नहीं है। |
| `bundleNumbers.title` | Party bundle numbers | पार्टी bundle नंबर |
| `bundleNumbers.none` | Same as our serial | हमारे serial जैसा |
| `bundleNumbers.monthly` | Monthly, like 26J12 | हर महीने, जैसे 26J12 |
| `bundleNumbers.fy` | Each financial year, like 2026-27/12 | हर वित्त वर्ष, जैसे 2026-27/12 |
| `bundleNumbers.lifelong` | Never reset, like 4086 | कभी शून्य नहीं, जैसे 4086 |
| `bundleNumbers.changeHint` | Old bundles keep their numbers. | पुराने bundle के नंबर नहीं बदलते। |

### store (189)

| Key | English | हिंदी |
|---|---|---|
| `title` | Store | स्टोर |
| `subtitle` | Chemicals, fuel, gas and spares in the central store. | सेंट्रल स्टोर में केमिकल, ईंधन, गैस और स्पेयर पार्ट। |
| `items` | Store items | स्टोर का सामान |
| `actions.issue` | Issue | माल दें |
| `actions.issueHint` | Give items to the floor | फ़्लोर को सामान दें |
| `actions.receive` | Receive | माल लें |
| `actions.receiveHint` | A delivery came in | डिलीवरी आई है |
| `actions.exchange` | Exchange | पुराना देकर नया |
| `actions.exchangeHint` | Old out, new in | पुराना पार्ट बाहर, नया अंदर |
| `readOnly` | Only the storekeeper makes store entries. You can see what is in the store. | स्टोर की एंट्री सिर्फ़ स्टोरकीपर करता है। स्टोर में क्या है, यह आप देख सकते हैं। |
| `inStore` | In the store | स्टोर में |
| `search` | Search items | सामान खोजें |
| `category` | Category | किस्म |
| `allCategories` | All categories | सारी किस्में |
| `columns.item` | Item | सामान |
| `columns.category` | Category | किस्म |
| `columns.inStore` | In store | स्टोर में |
| `columns.status` | Status | स्थिति |
| `columns.entry` | Entry | एंट्री |
| `columns.quantity` | Quantity | मात्रा |
| `columns.when` | When | कब |
| `columns.details` | Details | ब्योरा |
| `status.empty` | Empty | खाली |
| `status.inStock` | In stock | मौजूद |
| `status.retired` | Retired | बंद |
| `noItems` | No store items yet | स्टोर में अभी कोई सामान नहीं है |
| `noItemsBody` | Add the chemicals, fuel and spares you keep, then receive the first delivery. | जो केमिकल, ईंधन और स्पेयर आप रखते हैं उन्हें जोड़ें, फिर पहली डिलीवरी लें। |
| `noItemsInCategory` | No items in this category | इस किस्म का कोई सामान नहीं है |
| `addItem` | Add item | सामान जोड़ें |
| `noLocation` | Set up the central store first | पहले सेंट्रल स्टोर बनाएं |
| `noLocationBody` | Ask your manager or admin to add a location of the kind Store in Masters, Locations. Until then nothing can be received or issued. | मैनेजर या एडमिन से कहें कि मास्टर, लोकेशन में Store किस्म की लोकेशन जोड़ें। तब तक न माल लिया जा सकता है, न दिया जा सकता है। |
| `noLocationBodyPublisher` | Add a location of the kind Store in Masters, Locations. Until then nothing can be received or issued. | मास्टर, लोकेशन में Store किस्म की लोकेशन जोड़ें। तब तक न माल लिया जा सकता है, न दिया जा सकता है। |
| `loadFailed` | The store did not load. Check the connection and try again. | स्टोर लोड नहीं हुआ। कनेक्शन देखें और फिर से कोशिश करें। |
| `noAccess` | The store is for the storekeeper | स्टोर स्टोरकीपर के लिए है |
| `noAccessBody` | Ask your plant admin if you need to see or change the store. | स्टोर देखना या बदलना हो तो प्लांट एडमिन से पूछें। |
| `noEntryAccess` | Only the storekeeper makes store entries | स्टोर की एंट्री सिर्फ़ स्टोरकीपर करता है |
| `noEntryAccessBody` | You can still see what is in the store. | स्टोर में क्या है, यह आप फिर भी देख सकते हैं। |
| `backToStore` | Store | स्टोर |
| `recent` | Recent entries | हाल की एंट्री |
| `entries` | Entries | एंट्री |
| `noEntries` | No entries yet | अभी कोई एंट्री नहीं है |
| `noEntriesBody` | Deliveries received and items issued show here. | आई हुई डिलीवरी और दिया हुआ माल यहां दिखेगा। |
| `showMore` | Show older entries | पुरानी एंट्री दिखाएं |
| `showingLatest` | Showing the latest {max} entries. | सबसे नई {max} एंट्री दिख रही हैं। |
| `kind.grn` | Received | माल आया |
| `kind.mrs` | Issued | माल दिया |
| `cancelled` | Cancelled | रद्द |
| `purpose.melt` | Melt | मेल्ट |
| `purpose.nitriding` | Nitriding | नाइट्राइडिंग |
| `purpose.maintenance` | Maintenance | मेंटेनेंस |
| `purpose.exchange` | Exchange | बदली |
| `purpose.other` | Other | दूसरा काम |
| `categories.chemical` | Chemical | केमिकल |
| `categories.fuel` | Fuel | ईंधन |
| `categories.gas` | Gas | गैस |
| `categories.spare` | Spare | स्पेयर |
| `categories.other` | Other | दूसरा |
| `unitShort.kg` | kg | kg |
| `unitShort.litre` | L | L |
| `unitShort.piece` | pcs | pcs |
| `unitShort.metre` | m | m |
| `unitShort.set` | {count:set\|sets} | {count:सेट\|सेट} |
| `unitShort.box` | {count:box\|boxes} | {count:डिब्बा\|डिब्बे} |
| `unitShort.bag` | {count:bag\|bags} | {count:बोरी\|बोरी} |
| `unitName.kg` | Kilogram (kg) | किलो (kg) |
| `unitName.litre` | Litre (L) | लीटर (L) |
| `unitName.piece` | Piece (pcs) | नग (pcs) |
| `unitName.metre` | Metre (m) | मीटर (m) |
| `unitName.set` | Set | सेट |
| `unitName.box` | Box | डिब्बा |
| `unitName.bag` | Bag | बोरी |
| `countedIn` | {category}, counted in {unit} | {category}, {unit} में गिनती |
| `openItem` | Open {item} | {item} खोलें |
| `qtyOf` | {qty} {unit} of {item} | {item}: {qty} {unit} |
| `form.item` | Item | सामान |
| `form.itemPlaceholder` | Search store items | स्टोर का सामान खोजें |
| `form.itemRequired` | Choose an item. | सामान चुनें। |
| `form.inStoreNow` | In store now | अभी स्टोर में |
| `form.quantity` | Quantity | मात्रा |
| `form.quantityHint` | In store: {qty} {unit} | स्टोर में: {qty} {unit} |
| `form.oldOut` | Old going out | पुराना जो बाहर जा रहा है |
| `form.newIn` | New coming in | नया जो आ रहा है |
| `form.purpose` | What is it for | किस काम के लिए |
| `form.purposeRequired` | Choose what it is for. | किस काम के लिए है, चुनें। |
| `form.ref` | Cast, die or job | कास्ट, die या जॉब |
| `form.refHint` | Optional. A cast number, die or job card. | ज़रूरी नहीं। कास्ट नंबर, die या जॉब कार्ड। |
| `form.challan` | Challan or bill number | चालान या बिल नंबर |
| `form.challanHint` | Optional. From the vendor's paper. | ज़रूरी नहीं। वेंडर के कागज़ से। |
| `form.note` | Note | नोट |
| `form.noteHint` | Optional. | ज़रूरी नहीं। |
| `form.qty.empty` | Enter the quantity. | मात्रा लिखें। |
| `form.qty.invalid` | Enter a number like 12 or 12.5. | 12 या 12.5 जैसा नंबर लिखें। |
| `form.qty.zero` | The quantity must be more than 0. | मात्रा 0 से ज़्यादा होनी चाहिए। |
| `form.qty.decimals` | Use at most 3 digits after the point. | दशमलव के बाद ज़्यादा से ज़्यादा 3 अंक लिखें। |
| `form.qty.whole` | This item is counted in whole numbers. | यह सामान पूरे नग में गिना जाता है। |
| `form.qty.tooBig` | One entry can hold at most 1,00,000. Split it into two entries. | एक एंट्री में ज़्यादा से ज़्यादा 1,00,000 आ सकता है। इसे दो एंट्री में बांटें। |
| `form.qty.short` | Only {qty} {unit} in the store. Issue less, or receive the delivery first. | स्टोर में सिर्फ़ {qty} {unit} है। कम दें, या पहले डिलीवरी लें। |
| `form.failed` | Not saved. {reason} | सेव नहीं हुआ। {reason} |
| `form.unknownOutcome` | orrn didn't confirm this save, so it may have gone through. Tap {action} again to check: the same entry is never saved twice. | orrn ने इस सेव की पुष्टि नहीं की, हो सकता है यह सेव हो गया हो। जांचने के लिए फिर से {action} दबाएं, एक ही एंट्री दो बार सेव नहीं होती। |
| `form.backToStore` | Back to store | स्टोर पर वापस |
| `form.notInList` | Not in the list? | लिस्ट में नहीं है? |
| `form.allItems` | Items | सामान |
| `form.emptyHint` | Empty. Receive it first. | खाली है। पहले माल लें। |
| `errors.duplicateName` | An item in use already has this name. Use another name, or open that item. | इस नाम का सामान पहले से चालू है। दूसरा नाम रखें, या वह सामान खोलें। |
| `errors.requestReused` | This entry changed while it was being saved. Check the register, then enter it again. | सेव होते समय यह एंट्री बदल गई। रजिस्टर देखें, फिर से दर्ज करें। |
| `errors.short` | The store has less than this now. Check what is in the store and change the quantity. | स्टोर में अब इससे कम है। स्टोर में कितना है देखें और मात्रा बदलें। |
| `errors.retireWithStock` | Only an empty item can be retired. Issue what is left, or cancel its entries, first. | सिर्फ़ खाली सामान बंद हो सकता है। पहले बचा हुआ माल दें, या उसकी एंट्री रद्द करें। |
| `errors.unitLocked` | The unit can't change: this item already has entries. | इकाई नहीं बदल सकती: इस सामान की एंट्री हो चुकी है। |
| `errors.cancelDrawn` | This entry can't be cancelled: some of what it brought in has been issued since. Cancel those issues first. | यह एंट्री रद्द नहीं हो सकती: इससे आया माल बाद में दिया जा चुका है। पहले वे एंट्री रद्द करें। |
| `errors.cancelItemRetired` | This item is retired. Bring it back into use first, then cancel the entry. | यह सामान बंद है। पहले इसे फिर से चालू करें, फिर एंट्री रद्द करें। |
| `errors.cancelLocationRetired` | The store location of this entry is retired. Ask your manager or admin to bring it back, then cancel the entry. | इस एंट्री की स्टोर लोकेशन बंद है। मैनेजर या एडमिन से उसे चालू करवाएं, फिर एंट्री रद्द करें। |
| `errors.alreadyCancelled` | This entry is already cancelled. | यह एंट्री पहले ही रद्द हो चुकी है। |
| `errors.sourceLocked` | This entry belongs to another record, such as a melt. Cancel it there. | यह एंट्री दूसरे रिकॉर्ड की है, जैसे मेल्ट। उसे वहीं रद्द करें। |
| `errors.itemRetired` | This item is retired. Bring it back into use in Store items first. | यह सामान बंद है। पहले स्टोर का सामान में इसे फिर से चालू करें। |
| `errors.itemChanged` | This item was changed meanwhile. Open it again. | इस बीच यह सामान बदल गया। इसे फिर से खोलें। |
| `errors.storeChanged` | The store changed while saving. Try again. | सेव होते समय स्टोर बदल गया। फिर से कोशिश करें। |
| `errors.noLocation` | The central store is not set up yet. Ask your manager or admin to add a location of the kind Store. | सेंट्रल स्टोर अभी बना नहीं है। मैनेजर या एडमिन से Store किस्म की लोकेशन जुड़वाएं। |
| `errors.manyStores` | There is more than one store location. Ask your manager or admin to retire the extra ones. | एक से ज़्यादा स्टोर लोकेशन हैं। मैनेजर या एडमिन से फालतू वाली बंद करवाएं। |
| `errors.nameInvalid` | Use letters or digits in the name. | नाम में अक्षर या अंक लिखें। |
| `errors.notFound` | This item or entry is not here any more. Go back to the store and pick it again. | यह सामान या एंट्री अब यहां नहीं है। स्टोर पर वापस जाकर फिर से चुनें। |
| `errors.refused` | The store did not accept this. Check the entry and try again. | स्टोर ने यह नहीं लिया। एंट्री जांचें और फिर से कोशिश करें। |
| `receive.title` | Receive into store | स्टोर में माल लें |
| `receive.subtitle` | Record a delivery. It gets a GRN number. | डिलीवरी दर्ज करें। इसे GRN नंबर मिलेगा। |
| `receive.submit` | Receive | माल लें |
| `receive.done` | Received | माल आ गया |
| `receive.again` | Receive another | और माल लें |
| `issue.title` | Issue from store | स्टोर से माल दें |
| `issue.subtitle` | Give items to the floor. It gets an MRS number. | फ़्लोर को सामान दें। इसे MRS नंबर मिलेगा। |
| `issue.submit` | Issue | माल दें |
| `issue.done` | Issued | माल दे दिया |
| `issue.again` | Issue another | और माल दें |
| `exchange.title` | Exchange old for new | पुराना देकर नया लें |
| `exchange.subtitle` | The old part leaves the store and the new one comes in. It gets an MRS and a GRN number. | पुराना पार्ट स्टोर से बाहर जाता है और नया अंदर आता है। इसे MRS और GRN नंबर मिलेंगे। |
| `exchange.submit` | Exchange | बदलें |
| `exchange.done` | Exchanged | बदल गया |
| `exchange.again` | Exchange another | और बदलें |
| `exchange.newInUnder` | New part in under {number} | नया पार्ट {number} से आया |
| `replayCancelled.title` | Already cancelled | पहले ही रद्द |
| `replayCancelled.body` | {number} was saved earlier and has since been cancelled, so nothing moved now. Enter it again if it is still needed. | {number} पहले सेव हुआ था और बाद में रद्द हो गया, इसलिए अभी कुछ नहीं बदला। ज़रूरत हो तो फिर से दर्ज करें। |
| `entry.item` | Item | सामान |
| `entry.quantity` | Quantity | मात्रा |
| `entry.when` | When | कब |
| `entry.purpose` | For | किसके लिए |
| `entry.ref` | Cast, die or job | कास्ट, die या जॉब |
| `entry.challan` | Challan or bill | चालान या बिल |
| `entry.note` | Note | नोट |
| `entry.exchangedWith` | Exchange, with {number} | बदली, {number} के साथ |
| `entry.cancelledBecause` | Cancelled: {reason} | रद्द: {reason} |
| `entry.cancel` | Cancel entry | एंट्री रद्द करें |
| `entry.keep` | Keep entry | एंट्री रहने दें |
| `entry.reason` | Why cancel it | क्यों रद्द कर रहे हैं |
| `entry.reasonHint` | For example: wrong quantity typed. | जैसे: गलत मात्रा लिख दी। |
| `entry.reasonRequired` | Write why you are cancelling it. | रद्द करने की वजह लिखें। |
| `entry.cancelBoth` | Both sides of this exchange are cancelled together. | इस बदली की दोनों एंट्री एक साथ रद्द होंगी। |
| `entry.cancelEffect` | The number stays in the register, marked cancelled, and the store goes back to what it was. | नंबर रजिस्टर में रद्द लिखकर रहेगा, और स्टोर पहले जैसा हो जाएगा। |
| `entry.cancelledToast` | {number} cancelled | {number} रद्द हो गया |
| `entry.open` | Open {number} | {number} खोलें |
| `entry.belongsTo` | This entry belongs to another record ({source}). Cancel that record to undo it. | यह एंट्री दूसरे रिकॉर्ड ({source}) की है। इसे वापस लेने के लिए वह रिकॉर्ड रद्द करें। |
| `entry.challanRef` | Challan {ref} | चालान {ref} |
| `entry.period` | Financial year | वित्त वर्ष |
| `itemPage.notFound` | Store item not found | स्टोर का सामान नहीं मिला |
| `itemPage.notFoundBody` | It may belong to another plant. Go back to the store and pick it again. | यह शायद किसी दूसरे प्लांट का है। स्टोर पर वापस जाकर फिर से चुनें। |
| `itemPage.edit` | Edit item | सामान बदलें |
| `itemPage.retiredNote` | This item is retired. It can't be received or issued. | यह सामान बंद है। इसे न लिया जा सकता है, न दिया जा सकता है। |
| `itemsPage.subtitle` | Everything the store keeps, with its unit and category. | स्टोर में रखा हर सामान, उसकी इकाई और किस्म के साथ। |
| `itemsPage.show` | Show | दिखाएं |
| `itemsPage.showInUse` | In use | चालू |
| `itemsPage.showRetired` | Retired | बंद |
| `itemsPage.showAll` | All | सब |
| `itemsPage.noRetired` | No retired items | कोई बंद सामान नहीं है |
| `itemsPage.noneInUse` | No items in use | कोई सामान चालू नहीं है |
| `itemsPage.noneInUseBody` | Every item is retired. Choose Retired to see them and bring one back. | हर सामान बंद है। उन्हें देखने और फिर से चालू करने के लिए बंद चुनें। |
| `itemForm.addTitle` | Add store item | स्टोर का सामान जोड़ें |
| `itemForm.editTitle` | Edit store item | स्टोर का सामान बदलें |
| `itemForm.name` | Name | नाम |
| `itemForm.nameHint` | As the storekeeper calls it, for example Cover flux. | जैसा स्टोरकीपर बोलता है, जैसे Cover flux। |
| `itemForm.nameRequired` | Enter the item name. | सामान का नाम लिखें। |
| `itemForm.unit` | Unit | इकाई |
| `itemForm.unitHint` | The unit can't change after the item's first entry. | पहली एंट्री के बाद इकाई नहीं बदल सकती। |
| `itemForm.category` | Category | किस्म |
| `itemForm.save` | Save item | सामान सेव करें |
| `itemForm.added` | {name} added | {name} जुड़ गया |
| `itemForm.saved` | {name} saved | {name} सेव हो गया |
| `itemForm.retire` | Retire item | सामान बंद करें |
| `itemForm.restore` | Bring back into use | फिर से चालू करें |
| `itemForm.retireHint` | Retired items can't be received or issued. Only an empty item can be retired. | बंद सामान न लिया जा सकता है, न दिया जा सकता है। सिर्फ़ खाली सामान बंद हो सकता है। |
| `itemForm.retired` | {name} retired | {name} बंद हो गया |
| `itemForm.restored` | {name} is back in use | {name} फिर से चालू है |
| `itemForm.retireBlocked` | {qty} {unit} is still in the store. Issue it or cancel its entries before retiring the item. | स्टोर में अभी {qty} {unit} है। सामान बंद करने से पहले इसे दें या इसकी एंट्री रद्द करें। |

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
| `footer` | For aluminium extrusion plants | एल्युमिनियम एक्सट्रूज़न प्लांट के लिए |
| `footerNav` | Footer | फ़ुटर |
| `copyright` | © {year} orrn | © {year} orrn |

### native (18)

| Key | English | हिंदी |
|---|---|---|
| `scanHint` | Opens the camera to scan a bundle label. | बंडल लेबल स्कैन करने के लिए कैमरा खोलता है। |
| `offlineTitle` | Can't reach orrn | orrn से कनेक्ट नहीं हो पा रहा |
| `offlineBody` | Check the phone's internet connection, then try again. | फ़ोन का इंटरनेट कनेक्शन जांचें, फिर से कोशिश करें। |
| `setPasswordTitle` | Set your own password first | पहले अपना पासवर्ड बनाएं |
| `setPasswordBody` | Your account has a temporary password. Open orrn.in in your phone's browser or on a computer, sign in and set a new password, then come back here. | आपके अकाउंट में अभी अस्थायी पासवर्ड है। फ़ोन के ब्राउज़र में या कंप्यूटर पर orrn.in खोलें, साइन इन करके नया पासवर्ड बनाएं, फिर यहाँ वापस आएं। |
| `staffTitle` | Godseye is on the web | Godseye वेब पर है |
| `staffBody` | Staff accounts don't belong to a plant. Open orrn on a computer to use Godseye. | स्टाफ अकाउंट किसी प्लांट का हिस्सा नहीं होते। Godseye इस्तेमाल करने के लिए कंप्यूटर पर orrn खोलें। |
| `checkAgain` | Check again | फिर से जांचें |
| `tooManyTries` | Too many tries. Wait a minute, then try again. | बहुत बार कोशिश हो गई। एक मिनट रुकें, फिर कोशिश करें। |
| `codeTimedOut` | That took too long. Sign in again. | बहुत देर हो गई। फिर से साइन इन करें। |
| `verifying` | Checking code | कोड जांच रहे हैं |
| `signingOut` | Signing out | साइन आउट हो रहा है |
| `version` | Version {version} | वर्ज़न {version} |
| `codeTooShort` | Enter all 6 digits of the code. | कोड के सभी 6 अंक डालें। |
| `serverTitle` | orrn ran into a problem | orrn में कोई दिक्कत आई |
| `serverBody` | The problem is on orrn's side, not this phone. Try again in a minute. | दिक्कत orrn की तरफ़ से है, इस फ़ोन में नहीं। एक मिनट बाद फिर से कोशिश करें। |
| `saveUnsureTitle` | Not sure it saved | पता नहीं सेव हुआ या नहीं |
| `saveUnsureBody` | orrn didn't confirm this save, so it may have gone through. Check before you try again. | orrn से सेव होने का जवाब नहीं आया, इसलिए हो सकता है यह सेव हो गया हो। दोबारा कोशिश करने से पहले जांच लें। |

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

### charts (28)

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

### purchase (206)

| Key | English | हिंदी |
|---|---|---|
| `title` | Purchase | खरीद |
| `subtitle` | Scrap lots from the kanta to the scrap store | स्क्रैप के लॉट, कांटे से स्क्रैप स्टोर तक |
| `newLot` | New lot | नया लॉट |
| `lotStatus.booking` | Booked | बुक हुआ |
| `lotStatus.unload` | Unloading | उतराई में |
| `lotStatus.ok` | OK | OK |
| `lotStatus.cancelled` | Cancelled | कैंसल |
| `flag.shortWithoutNote` | Needs a note | नोट चाहिए |
| `flag.notePending` | Note waiting | नोट इंतज़ार में |
| `filter.label` | Show | दिखाएं |
| `filter.all` | All | सभी |
| `filter.booking` | Booked | बुक हुए |
| `filter.unload` | Unloading | उतराई में |
| `filter.ok` | OK | OK |
| `kpi.atKanta` | At the kanta | कांटे पर |
| `kpi.atKantaMeta` | Booked or unloading | बुक हुए या उतराई में |
| `kpi.lots` | {count:lot\|lots} | {count:लॉट\|लॉट} |
| `kpi.inStock` | Scrap in stock | स्टॉक में स्क्रैप |
| `kpi.inStockMeta` | All scrap stores | सभी स्क्रैप स्टोर |
| `kpi.error` | This figure didn't load. | यह आंकड़ा लोड नहीं हुआ। |
| `list.label` | Scrap lots | स्क्रैप लॉट |
| `list.lot` | Lot | लॉट |
| `list.vendor` | Vendor | पार्टी |
| `list.material` | Material | माल |
| `list.party` | Party kg | पार्टी kg |
| `list.ours` | Our kg | हमारा kg |
| `list.difference` | Difference | फ़र्क |
| `list.status` | Status | स्थिति |
| `list.emptyTitle` | No lots yet | अभी कोई लॉट नहीं |
| `list.emptyBody` | Weigh the first truck and its lot shows up here. | पहली गाड़ी तौलें, उसका लॉट यहां दिखेगा। |
| `list.emptyFilteredTitle` | No lots here | यहां कोई लॉट नहीं |
| `list.emptyFilteredBody` | Nothing matches this filter. | इस फ़िल्टर में कुछ नहीं मिला। |
| `list.showAll` | Show all lots | सभी लॉट दिखाएं |
| `list.error` | The lots didn't load. Check the connection and try again. | लॉट लोड नहीं हुए। कनेक्शन देखें और फिर से कोशिश करें। |
| `material` | {item}, grade {grade} | {item}, ग्रेड {grade} |
| `diff.even` | Same weight | वज़न बराबर |
| `diff.over` | {kg} kg over | {kg} kg ज़्यादा |
| `diff.within` | {kg} kg short, within {pct} | {kg} kg कम, {pct} के अंदर |
| `diff.short` | {kg} kg short, beyond {pct} | {kg} kg कम, {pct} से ज़्यादा |
| `diff.incomplete` | Not weighed on our kanta | हमारे कांटे पर नहीं तौला |
| `diffWord.even` | Same weight | वज़न बराबर |
| `diffWord.over` | Over | ज़्यादा |
| `diffWord.within` | Short, within {pct} | कम, {pct} के अंदर |
| `diffWord.short` | Short, beyond {pct} | कम, {pct} से ज़्यादा |
| `diffWord.incomplete` | Not weighed on our kanta | हमारे कांटे पर नहीं तौला |
| `tolerance` | Tolerance {kg} kg ({pct}) | छूट {kg} kg ({pct}) |
| `charts.rateTitle` | Rate paid | दिया गया रेट |
| `charts.rateSubtitle` | Average ₹ per kg by month for the most bought items, this month so far | सबसे ज़्यादा खरीदे माल का महीने वार औसत ₹ प्रति kg, इस महीने अब तक |
| `charts.rateLabel` | Rate paid, rupees per kg by month | दिया गया रेट, महीने वार रुपये प्रति kg |
| `charts.month` | Month | महीना |
| `charts.vendorTitle` | Kg bought by vendor | पार्टी वार खरीदा kg |
| `charts.vendorSubtitle` | Party kg in the last 6 months, top 8 and the rest | पिछले 6 महीने का पार्टी kg, टॉप 8 और बाकी |
| `charts.vendorLabel` | Vendors by kg bought | खरीदे kg के हिसाब से पार्टियां |
| `charts.bought` | Bought | खरीदा |
| `charts.otherVendors` | Other vendors | बाकी पार्टियां |
| `charts.truncated` | These charts count only the first 2,000 lots of the 6 months, so the latest weeks are missing. | ये चार्ट 6 महीनों के पहले 2,000 लॉट ही गिनते हैं, इसलिए सबसे नए हफ़्ते छूट गए हैं। |
| `new.title` | New lot | नया लॉट |
| `new.subtitle` | A truck at the kanta | कांटे पर आई गाड़ी |
| `new.steps.vendor` | Vendor | पार्टी |
| `new.steps.material` | Material | माल |
| `new.steps.weights` | Weights | वज़न |
| `new.steps.book` | Book | बुक |
| `new.vendor` | Vendor | पार्टी |
| `new.vendorHint` | Search by name or any spelling the book uses. | नाम से या बुक में लिखे किसी भी नाम से खोजें। |
| `new.vendorPlaceholder` | Search vendors | पार्टी खोजें |
| `new.addVendor` | Add new vendor | नई पार्टी जोड़ें |
| `new.addVendorTitle` | Add vendor | पार्टी जोड़ें |
| `new.addVendorBody` | A manager confirms new vendors later. | नई पार्टी को बाद में मैनेजर पक्का करेंगे। |
| `new.vendorName` | Vendor name | पार्टी का नाम |
| `new.vendorCity` | City | शहर |
| `new.vendorPhone` | Phone | फ़ोन |
| `new.saveVendor` | Add vendor | पार्टी जोड़ें |
| `new.vendorAdded` | Vendor added | पार्टी जुड़ गई |
| `new.draftVendor` | New | नई |
| `new.usual` | Usually sells | आम तौर पर बेचती है |
| `new.usualPick` | {item} at {rate} per kg | {item}, {rate} प्रति kg |
| `new.item` | Material | माल |
| `new.grade` | Grade | ग्रेड |
| `new.rate` | Rate (₹ per kg) | रेट (₹ प्रति kg) |
| `new.origin` | Origin | कहां से |
| `new.originHint` | Where the scrap comes from, like local or Dubai. | स्क्रैप कहां से आया, जैसे लोकल या दुबई। |
| `new.dross` | Dross (%) | ड्रॉस (%) |
| `new.party` | Party kanta (kg) | पार्टी का कांटा (kg) |
| `new.partyHint` | The weight on the party's slip. | पार्टी की पर्ची पर लिखा वज़न। |
| `new.fc` | Our kanta (kg) | हमारा कांटा (kg) |
| `new.fcHint` | Leave it empty if the truck is not weighed here yet. | गाड़ी यहां अभी नहीं तौली तो खाली छोड़ें। |
| `new.difference` | Difference | फ़र्क |
| `new.noteTitle` | Debit note | डेबिट नोट |
| `new.noteBody` | {kg} kg short, more than {pct}. The lot can't go OK until a debit note covers at least {min} kg. | {kg} kg कम, {pct} से ज़्यादा। जब तक डेबिट नोट कम से कम {min} kg नहीं ढकता, लॉट OK नहीं होगा। |
| `new.raiseNote` | Raise the debit note now | डेबिट नोट अभी बनाएं |
| `new.noteKg` | Kg to debit | डेबिट करने वाले kg |
| `new.noteKgHint` | At least {min} kg. | कम से कम {min} kg। |
| `new.noteKgRange` | From {min} kg up to the short, {max} kg. | {min} kg से कमी तक, {max} kg। |
| `new.noteKgMax` | Up to the short still open, {max} kg. | बची हुई कमी तक, {max} kg। |
| `new.summaryNote` | Debit note | डेबिट नोट |
| `new.fixCount` | {count} {count:thing\|things} to fix on this step | इस कदम पर {count} {count:चीज़\|चीज़ें} ठीक करनी हैं |
| `new.saveUnsure` | orrn didn't answer, so the lot may have saved. Check the lot list before you save it again. | orrn से जवाब नहीं आया, हो सकता है लॉट सेव हो गया हो। दोबारा सेव करने से पहले लॉट की सूची देखें। |
| `new.openLots` | Open lots | लॉट देखें |
| `new.mastersError` | The scrap items didn't load. Check the connection and try again. | स्क्रैप आइटम लोड नहीं हुए। कनेक्शन देखें और फिर से कोशिश करें। |
| `new.bori` | Bori deduction (kg) | बोरी कटौती (kg) |
| `new.boriHint` | Weight of the bags, when the party is charged for them. | बोरियों का वज़न, अगर पार्टी से काटना है। |
| `new.noteText` | Note for the manager | मैनेजर के लिए नोट |
| `new.noteOffice` | The office raises the debit note before this lot can go OK. | लॉट OK होने से पहले ऑफ़िस डेबिट नोट बनाएगा। |
| `new.billBook` | Bill book | बिल बुक |
| `new.billBookHint` | WB is the w-bill book. UB is a lot partly in the w-bill book. | WB यानी w-bill बुक। UB यानी लॉट का कुछ हिस्सा w-bill बुक में। |
| `new.partyBillNo` | Party bill number | पार्टी का बिल नंबर |
| `new.vehicleNo` | Vehicle number | गाड़ी नंबर |
| `new.date` | Lot date | लॉट की तारीख |
| `new.notes` | Notes | नोट |
| `new.summary` | This lot | यह लॉट |
| `new.notChosen` | Not chosen | चुना नहीं |
| `new.save` | Save lot | लॉट सेव करें |
| `new.saved` | Lot {number} saved | लॉट {number} सेव हो गया |
| `new.savedWithNote` | Lot {number} saved. Note {note} sent for approval. | लॉट {number} सेव हो गया। नोट {note} मंज़ूरी के लिए भेजा। |
| `new.noteFailed` | Lot {number} saved, but the debit note didn't go through: {error} | लॉट {number} सेव हो गया, पर डेबिट नोट नहीं बना: {error} |
| `new.noItems` | No scrap items yet. A manager adds them in Masters. | अभी कोई स्क्रैप माल नहीं। मैनेजर इसे Masters में जोड़ेंगे। |
| `billBooks.main` | Main | मुख्य |
| `billBooks.wb` | WB | WB |
| `billBooks.ub` | UB | UB |
| `detail.party` | Party kanta | पार्टी का कांटा |
| `detail.ours` | Our kanta | हमारा कांटा |
| `detail.difference` | Difference | फ़र्क |
| `detail.facts` | Lot details | लॉट की जानकारी |
| `detail.nextStep` | Next step | अगला कदम |
| `detail.vendor` | Vendor | पार्टी |
| `detail.material` | Material | माल |
| `detail.rate` | Rate | रेट |
| `detail.amount` | Amount | रकम |
| `detail.payable` | Payable | देय वज़न |
| `detail.billBook` | Bill book | बिल बुक |
| `detail.partyBillNo` | Party bill number | पार्टी का बिल नंबर |
| `detail.vehicleNo` | Vehicle | गाड़ी |
| `detail.origin` | Origin | कहां से |
| `detail.dross` | Dross | ड्रॉस |
| `detail.date` | Lot date | लॉट की तारीख |
| `detail.notSet` | Not set | नहीं डाला |
| `detail.perKg` | {rate} per kg | {rate} प्रति kg |
| `detail.perKgUnit` | per kg | प्रति kg |
| `detail.notesTitle` | Debit and credit notes | डेबिट और क्रेडिट नोट |
| `detail.noNotes` | No notes on this lot. | इस लॉट पर कोई नोट नहीं। |
| `detail.noteType.debit` | Debit note | डेबिट नोट |
| `detail.noteType.credit` | Credit note | क्रेडिट नोट |
| `detail.noteReason.weight` | Weight | वज़न |
| `detail.noteReason.grade` | Grade | ग्रेड |
| `detail.noteKg` | {kg} kg | {kg} kg |
| `detail.noteBori` | Bori {kg} kg | बोरी {kg} kg |
| `detail.stockTitle` | Scrap stock | स्क्रैप स्टॉक |
| `detail.stockNone` | Goes into scrap stock when it is marked OK. | OK होने पर स्क्रैप स्टॉक में जाएगा। |
| `detail.stockNever` | This lot never went into stock. | यह लॉट कभी स्टॉक में नहीं आया। |
| `detail.stockIn` | {kg} kg in at {location} | {location} में {kg} kg आया |
| `detail.stockOut` | {kg} kg out at {location} | {location} से {kg} kg गया |
| `detail.markUnload` | Mark unloading | उतराई चालू करें |
| `detail.markedUnload` | Marked unloading | उतराई चालू की |
| `detail.markOk` | Mark OK | OK करें |
| `detail.markedOk` | Marked OK. {kg} kg in scrap stock at {location}. | OK हो गया। {location} में {kg} kg स्क्रैप स्टॉक में। |
| `detail.weigh` | Enter our kanta weight | हमारे कांटे का वज़न डालें |
| `detail.editWeights` | Edit weights | वज़न बदलें |
| `detail.weightsLocked` | A note on the weight is open, so the weights are locked. | वज़न पर नोट खुला है, इसलिए वज़न नहीं बदलेगा। |
| `detail.saveWeights` | Save weights | वज़न सेव करें |
| `detail.weightsSaved` | Weights saved | वज़न सेव हो गया |
| `detail.raiseNote` | Raise D/C note | D/C नोट बनाएं |
| `detail.noteSheetTitle` | Raise D/C note | D/C नोट बनाएं |
| `detail.noteSheetBody` | A manager approves it before it counts. | मैनेजर की मंज़ूरी के बाद ही गिना जाएगा। |
| `detail.type` | Type | किस्म |
| `detail.reason` | Reason | वजह |
| `detail.kgDiff` | Kg difference | kg का फ़र्क |
| `detail.amountOptional` | Amount (₹) | रकम (₹) |
| `detail.amountHint` | Leave it empty to use kg times the lot's rate. | खाली छोड़ें तो kg गुणा लॉट का रेट लगेगा। |
| `detail.sendNote` | Send for approval | मंज़ूरी के लिए भेजें |
| `detail.noteSent` | Note {number} sent for approval | नोट {number} मंज़ूरी के लिए भेजा |
| `detail.blockedWeigh` | Weigh the truck on our kanta before marking it OK. | OK करने से पहले गाड़ी हमारे कांटे पर तौलें। |
| `detail.blockedShort` | {kg} kg short, beyond {pct}. A debit note must cover at least {min} kg before OK. | {kg} kg कम, {pct} से ज़्यादा। OK से पहले डेबिट नोट कम से कम {min} kg ढके। |
| `detail.blockedShortOffice` | {kg} kg short, beyond {pct}. Ask the office to raise a debit note for at least {min} kg. | {kg} kg कम, {pct} से ज़्यादा। ऑफ़िस से कम से कम {min} kg का डेबिट नोट बनवाएं। |
| `detail.okShortWithoutNote` | In stock, but {kg} kg short, beyond {pct}, and no live debit note covers it. Raise one for at least {min} kg. | स्टॉक में है, पर {kg} kg कम है, {pct} से ज़्यादा, और कोई चालू डेबिट नोट इसे नहीं ढकता। कम से कम {min} kg का नोट बनाएं। |
| `detail.okShortOffice` | In stock, but {kg} kg short, beyond {pct}, and no live debit note covers it. Ask the office to raise one for at least {min} kg. | स्टॉक में है, पर {kg} kg कम है, {pct} से ज़्यादा, और कोई चालू डेबिट नोट इसे नहीं ढकता। ऑफ़िस से कम से कम {min} kg का नोट बनवाएं। |
| `detail.coveredBy` | The short is covered by {notes}. | कमी {notes} से ढकी है। |
| `detail.noteCovers` | The debit notes cover the short. The lot can go OK. | डेबिट नोट कमी को ढकते हैं। लॉट OK हो सकता है। |
| `detail.store` | Scrap store | स्क्रैप स्टोर |
| `detail.cancel` | Cancel lot | लॉट कैंसल करें |
| `detail.cancelTitle` | Cancel this lot? | यह लॉट कैंसल करें? |
| `detail.cancelBody` | It stays in the book as cancelled. A lot in stock comes out of scrap stock. | बुक में कैंसल लिखा रहेगा। स्टॉक में आया लॉट स्क्रैप स्टॉक से निकल जाएगा। |
| `detail.cancelReason` | Reason | वजह |
| `detail.keep` | Keep lot | लॉट रखें |
| `detail.cancelled` | Lot cancelled | लॉट कैंसल हो गया |
| `detail.cancelledBecause` | Cancelled: {reason} | कैंसल: {reason} |
| `detail.notFound` | This lot doesn't exist or was removed. | यह लॉट नहीं है या हटा दिया गया। |
| `detail.error` | This lot didn't load. Check the connection and try again. | यह लॉट लोड नहीं हुआ। कनेक्शन देखें और फिर से कोशिश करें। |
| `errors.vendor` | Choose the vendor, or add a new one. | पार्टी चुनें, या नई जोड़ें। |
| `errors.item` | Choose the material. | माल चुनें। |
| `errors.grade` | Choose the grade. | ग्रेड चुनें। |
| `errors.rate` | Enter the rate in rupees per kg, like 198.50. | रेट रुपये प्रति kg में डालें, जैसे 198.50। |
| `errors.rateHigh` | That rate is above ₹10,000 per kg. Check it. | यह रेट ₹10,000 प्रति kg से ज़्यादा है। जांच लें। |
| `errors.dross` | Enter dross as a percent from 0 to 100. | ड्रॉस 0 से 100 के बीच प्रतिशत में डालें। |
| `errors.origin` | Keep the origin under 80 characters. | कहां से 80 अक्षर से कम रखें। |
| `errors.party` | Enter the weight on the party's slip in kg. | पार्टी की पर्ची का वज़न kg में डालें। |
| `errors.fc` | Enter our kanta weight in kg, or leave it empty. | हमारे कांटे का वज़न kg में डालें, या खाली छोड़ें। |
| `errors.tooHeavy` | That is more than 100 tonnes. Check the weight. | यह 100 टन से ज़्यादा है। वज़न जांच लें। |
| `errors.noteTooSmall` | The note must cover at least the short beyond the tolerance. | नोट कम से कम छूट से ज़्यादा वाली कमी ढके। |
| `errors.noteTooBig` | The note can't be more than the party weight. | नोट पार्टी के वज़न से ज़्यादा नहीं हो सकता। |
| `errors.noteOverShort` | A weight debit can't be more than the short. Lower the kg. | वज़न का डेबिट कमी से ज़्यादा नहीं हो सकता। kg कम करें। |
| `errors.bori` | The bori deduction must be less than our kanta weight. | बोरी कटौती हमारे कांटे के वज़न से कम हो। |
| `errors.date` | Pick the lot date. | लॉट की तारीख चुनें। |
| `errors.vehicle` | Keep the vehicle number under 20 characters. | गाड़ी नंबर 20 अक्षर से कम रखें। |
| `errors.billNo` | Keep the bill number under 60 characters. | बिल नंबर 60 अक्षर से कम रखें। |
| `errors.notes` | Keep the notes under 500 characters. | नोट 500 अक्षर से कम रखें। |
| `errors.reason` | Write why the lot is cancelled. | लिखें कि लॉट क्यों कैंसल हो रहा है। |

### approvals (64)

| Key | English | हिंदी |
|---|---|---|
| `title` | Approvals | मंज़ूरी |
| `subtitle` | Requests that need a second person | जिन कामों पर दूसरे व्यक्ति की मंज़ूरी चाहिए |
| `waitingTitle` | Waiting for a decision | फ़ैसले के इंतज़ार में |
| `waitingUnit` | {count:request\|requests} | {count:रिक्वेस्ट\|रिक्वेस्ट} |
| `filter.label` | Show | दिखाएं |
| `filter.pending` | Waiting | इंतज़ार में |
| `filter.approved` | Approved | मंज़ूर |
| `filter.rejected` | Rejected | नामंज़ूर |
| `kindFilter` | Kind | किस्म |
| `allKinds` | All kinds | सभी किस्म |
| `kind.dc_note` | Debit or credit note | डेबिट या क्रेडिट नोट |
| `kind.cast_close` | Cast close | कास्ट बंद करना |
| `kind.die_rerank` | Die tier change | Die का टियर बदलना |
| `kind.dispatch_overdraw` | Dispatch over the order | ऑर्डर से ज़्यादा dispatch |
| `kind.phantom_void` | Void after a count | गिनती के बाद void |
| `kind.die_owner_override` | Use another customer's die | दूसरे ग्राहक की die चलाना |
| `kind.order_reallocate` | Move bundles to another customer | Bundle दूसरे ग्राहक को देना |
| `kind.press_time` | Press run times | प्रेस रन का समय |
| `kind.press_reopen` | Reopen a press run | प्रेस रन फिर खोलना |
| `kind.ageing_override` | Ageing override | एजिंग की छूट |
| `subject.dcDebit` | Debit note {number} on {lot} | {lot} पर डेबिट नोट {number} |
| `subject.dcCredit` | Credit note {number} on {lot} | {lot} पर क्रेडिट नोट {number} |
| `subject.dieRerank` | Copy {code}, tier {from} to {to} | कॉपी {code}, टियर {from} से {to} |
| `subject.dieRerankNew` | Copy {code}, set tier {to} | कॉपी {code}, टियर {to} करें |
| `subject.generic` | {ref} | {ref} |
| `askedBy` | Asked by {name} | {name} ने मांगा |
| `someone` | Someone | किसी ने |
| `decidedBy` | {status} by {name} | {name} ने {status} किया |
| `review` | Review | देखें और तय करें |
| `view` | View | देखें |
| `approve` | Approve | मंज़ूर करें |
| `reject` | Reject | नामंज़ूर करें |
| `approved` | Approved | मंज़ूर किया |
| `rejected` | Rejected | नामंज़ूर किया |
| `note` | Note | नोट |
| `noteHint` | Say why when you reject, so it can be fixed. | नामंज़ूर करें तो वजह लिखें, ताकि ठीक हो सके। |
| `rejectNeedsNote` | Write why you are rejecting it. | नामंज़ूर करने की वजह लिखें। |
| `own` | Someone else has to approve your request. | आपकी रिक्वेस्ट कोई और मंज़ूर करेगा। |
| `viewOnly` | A manager approves this. | इसे मैनेजर मंज़ूर करते हैं। |
| `openLot` | Open lot | लॉट खोलें |
| `openDie` | Open die | डाई खोलें |
| `theirNote` | Their note | उनका नोट |
| `decisionNote` | Decision note | फ़ैसले का नोट |
| `figures` | Figures | आंकड़े |
| `party` | Party kanta | पार्टी का कांटा |
| `ours` | Our kanta | हमारा कांटा |
| `short` | Short | कमी |
| `tolerance` | Tolerance | छूट |
| `kgDiff` | Kg in this note | इस नोट के kg |
| `bori` | Bori deduction | बोरी कटौती |
| `amount` | Amount | रकम |
| `rate` | Rate | रेट |
| `covers` | Covers the short beyond {pct} | {pct} से ज़्यादा वाली कमी ढकता है |
| `notCovers` | Does not cover the short beyond {pct} | {pct} से ज़्यादा वाली कमी नहीं ढकता |
| `overShort` | This note is {kg} kg more than the short. Check it before approving. | यह नोट कमी से {kg} kg ज़्यादा है। मंज़ूर करने से पहले जांचें। |
| `overShortWithOthers` | With the lot's other weight notes, this comes to {kg} kg more than the short. Check it before approving. | लॉट के बाकी वज़न वाले नोट मिलाकर यह कमी से {kg} kg ज़्यादा है। मंज़ूर करने से पहले जांचें। |
| `moreError` | More requests didn't load. Press Show more to try again. | और रिक्वेस्ट लोड नहीं हुईं। फिर से कोशिश के लिए और दिखाएं दबाएं। |
| `otherNotes` | Other notes on this lot | इस लॉट के बाकी नोट |
| `figuresHidden` | Your role can't see the purchase figures. | आपके रोल को खरीद के आंकड़े नहीं दिखते। |
| `emptyPendingTitle` | Nothing waiting | कुछ इंतज़ार में नहीं |
| `emptyPendingBody` | Requests for a second person show up here. | जिन पर दूसरे की मंज़ूरी चाहिए, वे यहां दिखेंगे। |
| `emptyTitle` | No requests here | यहां कोई रिक्वेस्ट नहीं |
| `emptyBody` | Nothing matches this filter. | इस फ़िल्टर में कुछ नहीं मिला। |
| `error` | The requests didn't load. Check the connection and try again. | रिक्वेस्ट लोड नहीं हुईं। कनेक्शन देखें और फिर से कोशिश करें। |

### dieRoom (80)

| Key | English | हिंदी |
|---|---|---|
| `title` | Die room | Die रूम |
| `copies.title` | Copies | कॉपी |
| `copies.copy` | Copy | कॉपी |
| `copies.tier` | Tier {rank} | टियर {rank} |
| `copies.untiered` | No tier | कोई टियर नहीं |
| `copies.latestWeight` | Latest kg/12ft | ताज़ा kg/12ft |
| `copies.drift` | Drift | बढ़त |
| `copies.band` | Band | बैंड |
| `copies.primaryBand` | Main band | मुख्य बैंड |
| `copies.owner` | Owner | मालिक |
| `copies.rack` | Rack | रैक |
| `copies.empty` | No copies of this die yet. | इस die की अभी कोई कॉपी नहीं। |
| `copies.add` | Add copy | कॉपी जोड़ें |
| `copies.suggestFirst` | Use first | पहले इसे चलाएं |
| `status.available` | In rack | रैक में |
| `status.in_use` | On press | प्रेस पर |
| `status.at_nitriding` | At nitriding | नाइट्राइडिंग पर |
| `status.at_maker` | At die maker | Die मेकर के पास |
| `status.retired` | Retired | बंद |
| `bands.title` | Bands | बैंड |
| `bands.add` | Add band | बैंड जोड़ें |
| `bands.wall` | Wall (mm) | दीवार (mm) |
| `bands.range` | {min} to {max} kg/12ft | {min} से {max} kg/12ft |
| `bands.label` | Label | नाम |
| `bands.retire` | Retire band | बैंड बंद करें |
| `bands.duplicate` | This band already exists for this die. | इस die का यह बैंड पहले से है। |
| `card.title` | Die card | Die कार्ड |
| `card.alloy` | Alloy | अलॉय |
| `card.temper` | Temper | टेम्पर |
| `card.profileKind` | Shape | आकार |
| `card.hollow` | Hollow | हॉलो |
| `card.solid` | Solid | सॉलिड |
| `card.semi` | Semi hollow | सेमी हॉलो |
| `card.cavities` | Cavities | कैविटी |
| `card.bolster` | Bolster | बोल्स्टर |
| `card.backer` | Backer | बैकर |
| `card.subBolster` | Sub bolster | सब बोल्स्टर |
| `card.received` | Received | मिली |
| `card.drawing` | Press drawing | प्रेस ड्रॉइंग |
| `card.files` | Files | फ़ाइलें |
| `card.addFile` | Add file | फ़ाइल जोड़ें |
| `tier.propose` | Change tier | टियर बदलें |
| `tier.lift` | Move to band | बैंड में ले जाएं |
| `tier.pending` | Waiting for approval | मंज़ूरी का इंतज़ार |
| `tier.nothingChanges` | Pick a different tier or band. | दूसरा टियर या बैंड चुनें। |
| `tier.pendingExists` | A change for this copy is already waiting. | इस कॉपी का एक बदलाव पहले से इंतज़ार में है। |
| `drift.under` | Under band | बैंड से कम |
| `drift.green` | In band | बैंड में |
| `drift.amber` | Near the edge | किनारे के पास |
| `drift.red` | Over band | बैंड से ज़्यादा |
| `drift.value` | {pct}% over band start | बैंड शुरू से {pct}% ज़्यादा |
| `issue.title` | Issue to press | प्रेस को दें |
| `issue.issue` | Issue | दें |
| `issue.return` | Take back | वापस लें |
| `issue.cancel` | Cancel issue | देना रद्द करें |
| `issue.line` | Press line | प्रेस लाइन |
| `issue.issued` | Issued to {line} | {line} को दी |
| `issue.returned` | Back in rack | रैक में वापस |
| `issue.notAvailable` | This copy is not in the rack. | यह कॉपी रैक में नहीं है। |
| `issue.openIssue` | This copy is already issued. | यह कॉपी पहले से दी हुई है। |
| `issue.dieOnPress` | The die is still on the press. Log the run first. | Die अभी प्रेस पर है। पहले रन दर्ज करें। |
| `maker.title` | Die maker | Die मेकर |
| `maker.makers` | Die makers | Die मेकर |
| `maker.addMaker` | Add die maker | Die मेकर जोड़ें |
| `maker.send` | Send to maker | मेकर को भेजें |
| `maker.receive` | Received back | वापस मिली |
| `maker.purpose` | Why | क्यों |
| `maker.trial` | Trial | ट्रायल |
| `maker.correction` | Correction | सुधार |
| `maker.repair` | Repair | मरम्मत |
| `maker.job` | Job {number} | जॉब {number} |
| `owner.title` | Owner | मालिक |
| `owner.belongsTo` | This die belongs to {name} | यह die {name} की है |
| `owner.pickCopy` | Pick the die copy | Die की कॉपी चुनें |
| `owner.noCopies` | This section has no copies | इस सेक्शन की कोई कॉपी नहीं है |
| `owner.requestOverride` | Ask to use it for {name} | {name} के लिए चलाने की मंज़ूरी मांगें |
| `owner.purpose.plan` | Plan | प्लान |
| `owner.purpose.press` | Press | प्रेस |
| `owner.purpose.pack` | Pack | पैकिंग |
| `owner.purpose.dispatch` | Dispatch | Dispatch |

### orders (236)

| Key | English | हिंदी |
|---|---|---|
| `title` | Orders | ऑर्डर |
| `new` | New order | नया ऑर्डर |
| `number` | Order | ऑर्डर |
| `poNumber` | PO number | PO नंबर |
| `orderDate` | Order date | ऑर्डर की तारीख |
| `expectedDate` | Expected by | कब तक चाहिए |
| `source.office` | Office | ऑफ़िस |
| `source.portal` | Portal | पोर्टल |
| `source.label` | Booked from | कहां से बुक हुआ |
| `status.booking` | Booking | बुकिंग |
| `status.confirmed` | Confirmed | पक्का |
| `status.dispatching` | Dispatching | Dispatch चालू |
| `status.closed` | Closed | बंद |
| `status.cancelled` | Cancelled | रद्द |
| `line.copy` | Die copy | Die कॉपी |
| `line.tierOrBetter` | Tier {rank} or better | टियर {rank} या बेहतर |
| `line.cutLength` | Cut length | कट लंबाई |
| `line.pcs` | Pieces | पीस |
| `line.kg` | kg | kg |
| `line.basis` | kg/12ft | kg/12ft |
| `line.finish` | Finish | फ़िनिश |
| `line.alloy` | Alloy | अलॉय |
| `line.temper` | Temper | टेम्पर |
| `line.rate` | Rate (Rs/kg) | रेट (Rs/kg) |
| `line.die` | Die | Die |
| `line.anyCopy` | The die room picks the copy | कॉपी die room चुनेगा |
| `line.copyCode` | Copy {code} | कॉपी {code} |
| `line.copyPinned` | Copy pinned | कॉपी तय है |
| `line.tierShort` | tier {rank} | टियर {rank} |
| `finish.none` | Mill finish | मिल फ़िनिश |
| `finish.anodise` | Anodise | एनोडाइज़ |
| `finish.pvd` | PVD | PVD |
| `weightBasis.copy_current` | Copy's latest weight | कॉपी का ताज़ा वज़न |
| `weightBasis.band_start` | Band start | बैंड की शुरुआत |
| `qtyBasis.pcs` | By pieces | पीस से |
| `qtyBasis.kg` | By kg | kg से |
| `ordered` | Ordered | ऑर्डर |
| `dispatched` | Dispatched | Dispatch हुआ |
| `baki` | Baki | बाकी |
| `planable` | Can still plan | अभी प्लान हो सकता है |
| `over` | Over by {kg} kg | {kg} kg ज़्यादा |
| `confirm` | Confirm order | ऑर्डर पक्का करें |
| `close` | Close order | ऑर्डर बंद करें |
| `cancel` | Cancel order | ऑर्डर रद्द करें |
| `closeReason` | Why close with baki left | बाकी रहते हुए क्यों बंद कर रहे हैं |
| `cancelReason` | Why cancel | क्यों रद्द कर रहे हैं |
| `poRepeat` | PO {po} is already on order {code}. | PO {po} पहले से ऑर्डर {code} पर है। |
| `blockers.po_number` | Add the PO number. | PO नंबर डालें। |
| `blockers.no_lines` | Add at least one line. | कम से कम एक लाइन जोड़ें। |
| `blockers.line` | Line {n}: {problem} | लाइन {n}: {problem} |
| `blockers.pcs` | add pieces | पीस डालें |
| `blockers.kg` | add kg | kg डालें |
| `blockers.length` | add the cut length | कट लंबाई डालें |
| `blockers.alloy` | add the alloy | अलॉय डालें |
| `blockers.temper` | add the temper | टेम्पर डालें |
| `blockers.die_or_tier` | pick a copy or a tier | कॉपी या टियर चुनें |
| `subtitle` | Customer POs and what is still to dispatch | ग्राहकों के PO और जो dispatch होना बाकी है |
| `filter.label` | Show | दिखाएं |
| `filter.open` | Open | खुले |
| `filter.closed` | Closed | बंद |
| `filter.cancelled` | Cancelled | रद्द |
| `search` | Number, PO or customer | नंबर, PO या ग्राहक |
| `searchLabel` | Search orders | ऑर्डर खोजें |
| `customer` | Customer | ग्राहक |
| `po` | PO | PO |
| `noPo` | No PO yet | अभी PO नहीं |
| `late` | Late, {days} days | लेट, {days} दिन |
| `list.status` | Status | स्थिति |
| `list.ordered` | Ordered kg | ऑर्डर kg |
| `list.baki` | Baki kg | बाकी kg |
| `empty.title` | No orders yet | अभी कोई ऑर्डर नहीं |
| `empty.body` | Book a customer's PO to start an order. | ग्राहक का PO बुक करके ऑर्डर शुरू करें। |
| `empty.noMatch` | No orders match | कोई ऑर्डर नहीं मिला |
| `empty.noMatchBody` | Try another number, PO or customer. | दूसरा नंबर, PO या ग्राहक आज़माएं। |
| `empty.filtered` | Nothing under {status} | {status} में कुछ नहीं |
| `strip.label` | Balance figures | बाकी के आंकड़े |
| `strip.ordered` | Ordered | ऑर्डर |
| `strip.planned` | Planned | प्लान |
| `strip.pressed` | Pressed | प्रेस हुआ |
| `strip.aged` | Aged | एजिंग |
| `strip.packed` | Packed | पैक |
| `strip.inStock` | In stock | स्टॉक में |
| `strip.dispatched` | Dispatched | Dispatch हुआ |
| `strip.baki` | Baki | बाकी |
| `totals.title` | Balance | हिसाब |
| `totals.ordered` | Ordered | ऑर्डर |
| `totals.produced` | Produced | बना |
| `totals.dispatched` | Dispatched | Dispatch हुआ |
| `totals.baki` | Baki | बाकी |
| `bakiNote` | Baki is ordered minus dispatched. It does not go below zero. | बाकी = ऑर्डर घटा dispatch। यह शून्य से नीचे नहीं जाता। |
| `confirmed` | Order confirmed | ऑर्डर पक्का हो गया |
| `closed` | Order closed | ऑर्डर बंद हो गया |
| `cancelled` | Order cancelled | ऑर्डर रद्द हो गया |
| `toConfirm` | To confirm this order | ऑर्डर पक्का करने के लिए |
| `closeBakiHint` | {kg} kg is still to dispatch. Say why you are closing it. | {kg} kg अभी dispatch होना बाकी है। बंद करने का कारण लिखें। |
| `pending.title` | Waiting for a manager | मैनेजर का इंतज़ार |
| `pending.line` | {count} {count:bundle\|bundles}, {kg} kg, to {order} {customer} | {count} bundle, {kg} kg, {order} {customer} को |
| `detail.lines` | Lines | लाइनें |
| `detail.lineShort` | Line {n} | लाइन {n} |
| `detail.moveBundles` | Move bundles | Bundle डालें |
| `detail.basisLineBare` | Weight basis {milli} kg/12ft. | वज़न आधार {milli} kg/12ft। |
| `detail.basisLine` | Weight basis {milli} kg/12ft ({basis}). | वज़न आधार {milli} kg/12ft ({basis})। |
| `detail.implied` | {pcs} pcs weigh {implied} kg at that basis. | इस आधार पर {pcs} पीस का वज़न {implied} kg। |
| `detail.rate` | Rs {rate}/kg | Rs {rate}/kg |
| `detail.timeline` | Timeline | टाइमलाइन |
| `detail.timelineEmpty` | Nothing has happened yet. | अभी कुछ नहीं हुआ। |
| `detail.notFound` | This order was not found | यह ऑर्डर नहीं मिला |
| `detail.editLines` | Edit lines | लाइनें बदलें |
| `detail.saveLines` | Save lines | लाइनें सेव करें |
| `detail.refreshWeight` | Refresh weight | वज़न ताज़ा करें |
| `detail.weightRefreshed` | Line {n}: weight basis refreshed | लाइन {n}: वज़न आधार ताज़ा किया |
| `detail.takeStock` | Take ready stock | तैयार स्टॉक लें |
| `edit.title` | Edit order | ऑर्डर बदलें |
| `edit.saved` | Order saved | ऑर्डर सेव हुआ |
| `edit.linesTitle` | Edit the lines | लाइनें बदलें |
| `edit.linesHint` | Pieces or kg, length, die and copy. A line on a released press plan keeps its figures. | पीस या kg, लंबाई, die और कॉपी। प्रेस को भेजे गए प्लान की लाइन के आंकड़े नहीं बदलते। |
| `edit.linesSaved` | Lines saved | लाइनें सेव हुईं |
| `edit.releasedPlan` | Line {lines} is on a released press plan. Its kg, pieces, length and die can't change now. | लाइन {lines} प्रेस को भेजे गए प्लान पर है। इसके kg, पीस, लंबाई और die अभी नहीं बदल सकते। |
| `edit.belowDispatched` | Line {line}: {dispatched} kg is already dispatched, more than the new {kg} kg. | लाइन {line}: {dispatched} kg पहले ही dispatch हो चुका है, नए {kg} kg से ज़्यादा। |
| `serverSaid` | {message} | सर्वर का जवाब: {message} |
| `ownedBy` | This die belongs to {name}. | यह die {name} की है। |
| `form.subtitle` | Book a customer's PO. Confirm it on the order once the PO number and every line are complete. | ग्राहक का PO बुक करें। PO नंबर और हर लाइन पूरी होने पर ऑर्डर पर पक्का करें। |
| `form.party` | Customer and PO | ग्राहक और PO |
| `form.customerSearch` | Search customers | ग्राहक खोजें |
| `form.dieSearch` | Search by die code or name | Die कोड या नाम से खोजें |
| `form.poHint` | Needed to confirm. A PO number can be used once per customer. | पक्का करने के लिए ज़रूरी। एक ग्राहक का PO नंबर एक ही बार चलता है। |
| `form.poPlaceholder` | Customer's PO number | ग्राहक का PO नंबर |
| `form.lineTitle` | Line {n} | लाइन {n} |
| `form.removeLine` | Remove line {n} | लाइन {n} हटाएं |
| `form.addLine` | Add another line | एक और लाइन जोड़ें |
| `form.book` | Book order | ऑर्डर बुक करें |
| `form.saved` | Order {number} booked | ऑर्डर {number} बुक हुआ |
| `form.feet` | Feet | फ़ीट |
| `form.inches` | Inches | इंच |
| `form.lengthHintInch` | Feet and inches | फ़ीट और इंच |
| `form.lengthHintMm` | Millimetres | मिलीमीटर |
| `form.quickLengths` | Common lengths | आम लंबाइयां |
| `form.weightBasis` | Weight basis | वज़न आधार |
| `form.basisCurrent` | Current | ताज़ा |
| `form.basisBandStart` | Band start | बैंड की शुरुआत |
| `form.basisUsingCopy` | Using {milli} kg/12ft, the latest weight of copy {copy}. | {milli} kg/12ft ले रहे हैं, कॉपी {copy} का ताज़ा वज़न। |
| `form.basisUsingBand` | Using {milli} kg/12ft, the start of the die's band. | {milli} kg/12ft ले रहे हैं, die के बैंड की शुरुआत। |
| `form.noReading` | No weight reading on the copy yet; band start used. | कॉपी का अभी कोई वज़न नहीं है; बैंड की शुरुआत ली गई। |
| `form.quoteLine` | {pcs} pcs come to {kg} kg. | {pcs} पीस = {kg} kg। |
| `form.impliedLine` | {pcs} pcs weigh {implied} kg. You typed {kg} kg. | {pcs} पीस का वज़न {implied} kg है। आपने {kg} kg डाला। |
| `form.minusPiece` | -1 piece | -1 पीस |
| `form.plusPiece` | +1 piece | +1 पीस |
| `form.quoteFailed` | Could not work out the other side. Check the die and the length. | दूसरी तरफ़ का हिसाब नहीं निकला। Die और लंबाई देखें। |
| `form.quoting` | Working out… | हिसाब लग रहा है… |
| `form.basisLocked` | Using {milli} kg/12ft, locked when this line was booked. | {milli} kg/12ft ले रहे हैं, जो लाइन बुक होते समय तय हुआ। |
| `form.errors.customer` | Pick the customer. | ग्राहक चुनें। |
| `form.errors.die` | Pick the die. | Die चुनें। |
| `form.errors.length` | Enter the cut length. | कट लंबाई डालें। |
| `form.errors.qty` | Enter pieces or kg. | पीस या kg डालें। |
| `stock.title` | Stock for this die and length | इस die और लंबाई का स्टॉक |
| `stock.hint` | Bundles of this die that are already made. Book the order, then use Take ready stock on its line to put them on it. | इस die के बने हुए bundle। ऑर्डर बुक करें, फिर उसकी लाइन पर "तैयार स्टॉक लें" से इन्हें उस पर डालें। |
| `stock.takeTitle` | Ready stock for line {n} | लाइन {n} के लिए तैयार स्टॉक |
| `stock.takeHint` | Plant stock and bundles not on an order go on this line at once. Another customer's bundles wait for a manager. | प्लांट स्टॉक और बिना ऑर्डर के bundle तुरंत इस लाइन पर आते हैं। दूसरे ग्राहक के bundle मैनेजर की मंज़ूरी के बाद। |
| `stock.putOnLine` | Put on this line | इस लाइन पर डालें |
| `stock.noneToTake` | No ready stock of this die to take. | इस die का लेने लायक तैयार स्टॉक नहीं है। |
| `stock.prompt` | Ready stock of this die: {count} {count:bundle\|bundles}, {kg} kg. | इस die का तैयार स्टॉक: {count} bundle, {kg} kg। |
| `stock.promptNone` | No ready stock of this die. | इस die का तैयार स्टॉक नहीं है। |
| `stock.open` | See stock | स्टॉक देखें |
| `stock.none` | No ready stock for this die. | इस die का तैयार स्टॉक नहीं है। |
| `stock.sameLength` | Same length | वही लंबाई |
| `stock.needsApproval` | Needs a manager | मैनेजर की मंज़ूरी |
| `stock.group.plant` | Plant stock | प्लांट स्टॉक |
| `stock.group.unassigned` | Not on an order | किसी ऑर्डर पर नहीं |
| `stock.group.same_customer` | This customer's orders | इसी ग्राहक के ऑर्डर |
| `stock.group.other_customer` | Another customer's orders | दूसरे ग्राहक के ऑर्डर |
| `timeline.create` | Order booked | ऑर्डर बुक हुआ |
| `timeline.update` | Order edited | ऑर्डर बदला गया |
| `timeline.confirm` | Order confirmed | ऑर्डर पक्का हुआ |
| `timeline.close` | Order closed | ऑर्डर बंद हुआ |
| `timeline.cancel` | Order cancelled | ऑर्डर रद्द हुआ |
| `timeline.weightRefresh` | Weight basis refreshed | वज़न आधार ताज़ा किया |
| `timeline.reallocatePending` | {count} {count:bundle\|bundles}, {kg} kg, asked to move. Waiting for a manager. | {count} bundle, {kg} kg डालने की मांग। मैनेजर का इंतज़ार। |
| `timeline.reallocateApplied` | {count} {count:bundle\|bundles}, {kg} kg, moved | {count} bundle, {kg} kg डाले गए |
| `timeline.reallocateRejected` | The move of {count} {count:bundle\|bundles} was refused | {count} bundle डालना मना किया गया |
| `timeline.planCreate` | Press plan {number} drafted | प्रेस प्लान {number} बना |
| `timeline.planRelease` | Press plan {number} released to the press | प्रेस प्लान {number} प्रेस को भेजा गया |
| `timeline.planCancel` | Press plan {number} cancelled | प्रेस प्लान {number} रद्द हुआ |
| `timeline.planClose` | Press plan {number} closed | प्रेस प्लान {number} बंद हुआ |
| `timeline.planUpdate` | Press plan {number} changed | प्रेस प्लान {number} बदला गया |
| `timeline.packed` | Bundles packed for this order | इस ऑर्डर के लिए bundle पैक हुए |
| `timeline.dispatched` | Dispatch completed | Dispatch पूरा हुआ |
| `timeline.overdraw` | More than ordered was asked for on a dispatch | Dispatch पर ऑर्डर से ज़्यादा मांगा गया |
| `timeline.other` | {action} | {action} |
| `plan.subtitle` | Group open lines by die, set the window, release to the press. | खुली लाइनें die के हिसाब से जोड़ें, समय तय करें, प्रेस को भेजें। |
| `plan.biggerTitle` | Use a bigger screen | बड़ी स्क्रीन पर खोलें |
| `plan.biggerBody` | The press plan needs a desktop or an 11-inch tablet. Open it there to plan. | प्रेस प्लान के लिए डेस्कटॉप या 11 इंच का टैबलेट चाहिए। प्लान वहीं खोलें। |
| `plan.recent` | Plans | प्लान |
| `plan.noPlans` | No press plans yet. | अभी कोई प्रेस प्लान नहीं। |
| `plan.summary` | {dies} {dies:die\|dies}, {kg} kg | {dies} die, {kg} kg |
| `plan.from` | Window starts | समय शुरू |
| `plan.to` | Window ends | समय खत्म |
| `plan.windowHint` | A window is at most 24 hours. | एक प्लान का समय ज़्यादा से ज़्यादा 24 घंटे। |
| `plan.windowLong` | The window is longer than 24 hours. | समय 24 घंटे से ज़्यादा है। |
| `plan.windowOrder` | The window must end after it starts. | खत्म होने का समय शुरू के बाद होना चाहिए। |
| `plan.openLines` | Open lines | खुली लाइनें |
| `plan.searchPlaceholder` | Die, customer or PO | Die, ग्राहक या PO |
| `plan.searchLabel` | Search open lines | खुली लाइनें खोजें |
| `plan.allCustomers` | All customers | सभी ग्राहक |
| `plan.nothingLeft` | Nothing left to plan | प्लान करने को कुछ नहीं |
| `plan.nothingLeftBody` | Open lines are in stock or already on a plan. | खुली लाइनें स्टॉक में हैं या पहले से किसी प्लान में हैं। |
| `plan.planable` | {kg} kg to plan | {kg} kg प्लान हो सकता है |
| `plan.addLine` | Add {order} to the plan | {order} को प्लान में जोड़ें |
| `plan.draftDies` | Dies in run order | चलने के क्रम में die |
| `plan.chooseLines` | Choose lines | लाइनें चुनें |
| `plan.chooseLinesBody` | One die groups every customer that needs it. | एक die उसे चाहने वाले सब ग्राहकों को एक साथ रखता है। |
| `plan.markUrgent` | Mark urgent | जल्दी करें |
| `plan.moveEarlier` | Move earlier | पहले करें |
| `plan.moveLater` | Move later | बाद में करें |
| `plan.otherParty` | {die} is also open for {customer} on {order} ({length}): {kg} kg still to plan. | {die} पर {customer} का {order} ({length}) भी खुला है: {kg} kg प्लान होना बाकी। |
| `plan.otherLinesTitle` | Other open lines on these dies | इन die पर दूसरी खुली लाइनें |
| `plan.otherLinesBody` | Add them to press them in the same run. | इन्हें जोड़ें तो एक ही रन में दबेंगी। |
| `plan.otherLinesNone` | No other open line on these dies. | इन die पर कोई और खुली लाइन नहीं। |
| `plan.planableBoth` | {kg} kg, {pcs} pcs to plan | {kg} kg, {pcs} पीस प्लान होना बाकी |
| `plan.addAllOfSo` | Add all of {order} | {order} की सब लाइनें जोड़ें |
| `plan.draftFooter` | {dies} {dies:die\|dies}, {lines} {lines:line\|lines} | {dies} die, {lines} लाइन |
| `plan.moreLines` | More open lines than shown. Narrow by customer or search. | दिखाई गई से ज़्यादा खुली लाइनें हैं। ग्राहक या खोज से छांटें। |
| `plan.added` | Added to the plan | प्लान में जोड़ा |
| `plan.removed` | Taken off the plan | प्लान से हटाया |
| `plan.lineKg` | kg for {order} | {order} के लिए kg |
| `plan.lineKgHint` | Blank = all that is left to plan | खाली = जितना प्लान होना बाकी है सब |
| `plan.pressLine` | Press | प्रेस |
| `plan.pickPressLine` | Pick the press | प्रेस चुनें |
| `plan.saveDraft` | Save draft plan | ड्राफ़्ट प्लान सेव करें |
| `plan.released` | Plan released to the press | प्लान प्रेस को भेजा गया |
| `plan.cancelled` | Plan cancelled | प्लान रद्द हुआ |
| `plan.closed` | Plan closed | प्लान बंद हुआ |
| `plan.releaseTitle` | Release {number} | {number} भेजें |
| `plan.releaseHint` | The die room picks the copy at issue. Each die becomes one queued run. | कॉपी die room निकालते समय चुनता है। हर die एक कतार का रन बनता है। |
| `plan.releaseNow` | Release to press | प्रेस को भेजें |
| `plan.warningsTitle` | Other customers are waiting on these dies too | इन die पर दूसरे ग्राहक भी इंतज़ार में हैं |
| `plan.notFound` | This plan was not found | यह प्लान नहीं मिला |

### reallocate (28)

| Key | English | हिंदी |
|---|---|---|
| `title` | Move to another order | दूसरे ऑर्डर में डालें |
| `toLine` | Move to | कहां डालें |
| `toPlant` | Plant stock | प्लांट स्टॉक |
| `unassigned` | Not on an order | किसी ऑर्डर पर नहीं |
| `reasonCode` | Reason | कारण |
| `lengthMismatch` | The cut length differs from the order line. Pick a reason. | कट लंबाई ऑर्डर लाइन से अलग है। कारण चुनें। |
| `needsApproval` | This is another customer's order. A manager approves the move. | यह दूसरे ग्राहक का ऑर्डर है। मैनेजर मंज़ूरी देंगे। |
| `moved` | {count} {count:bundle\|bundles} moved | {count} bundle डाले गए |
| `tooMany` | Move at most {max} bundles at a time. | एक बार में ज़्यादा से ज़्यादा {max} bundle डालें। |
| `from` | From {order}, line {line} | {order} लाइन {line} से |
| `bundles` | Bundles | Bundle |
| `selectAll` | Select all | सब चुनें |
| `clearAll` | Clear | साफ़ करें |
| `noneToMove` | No bundle on this line can move. Only available bundles move. | इस लाइन का कोई bundle नहीं डाला जा सकता। सिर्फ़ उपलब्ध bundle डलते हैं। |
| `leave` | Leave them | रहने दें |
| `move` | Move | डालें |
| `plantNote` | Plant stock applies at once. It is not a customer. | प्लांट स्टॉक में तुरंत हो जाता है। यह ग्राहक नहीं है। |
| `lengthWarning` | The cut length differs from {order} line {line} ({length}) for {count} {count:bundle\|bundles}. Pick a reason. | {count} bundle की लंबाई {order} लाइन {line} की कट लंबाई ({length}) से अलग है। कारण चुनें। |
| `reasonNone` | Choose a reason | कारण चुनें |
| `reasonNeeded` | Pick a reason or write a note. | कारण चुनें या नोट लिखें। |
| `pickBundles` | Pick the bundles to move. | डालने के लिए bundle चुनें। |
| `waiting` | Waiting for a manager | मैनेजर का इंतज़ार |
| `waitingBody` | {count} {count:bundle\|bundles}, {kg} kg, stay where they are until a manager approves. | {count} bundle, {kg} kg मैनेजर की मंज़ूरी तक जहां हैं वहीं रहेंगे। |
| `openRequest` | See the request | मांग देखें |
| `refused.dispatched` | Already dispatched | पहले ही dispatch हो चुका |
| `refused.void` | Void | रद्द |
| `refused.held` | Held on {code} | {code} पर होल्ड |
| `refused.die_mismatch` | Different die | दूसरी die |

### press (63)

| Key | English | हिंदी |
|---|---|---|
| `title` | Press | प्रेस |
| `lines.title` | Press lines | प्रेस लाइन |
| `lines.add` | Add press | प्रेस जोड़ें |
| `lines.code` | Code | कोड |
| `lines.name` | Name | नाम |
| `lines.tonnage` | Tonnes | टन |
| `lines.retire` | Retire | बंद करें |
| `plan.title` | Press plan | प्रेस प्लान |
| `plan.new` | New plan | नया प्लान |
| `plan.number` | Plan {number} | प्लान {number} |
| `plan.window` | From {from} to {to} | {from} से {to} तक |
| `plan.addDie` | Add die | Die जोड़ें |
| `plan.addLine` | Add order line | ऑर्डर लाइन जोड़ें |
| `plan.urgent` | Urgent | जल्दी |
| `plan.release` | Release to press | प्रेस को भेजें |
| `plan.cancel` | Cancel plan | प्लान रद्द करें |
| `plan.close` | Close plan | प्लान बंद करें |
| `plan.overPlanable` | More than the order can still take. | ऑर्डर में जितना बाकी है उससे ज़्यादा। |
| `plan.status.draft` | Draft | ड्राफ़्ट |
| `plan.status.released` | Released | भेजा गया |
| `plan.status.closed` | Closed | बंद |
| `plan.status.cancelled` | Cancelled | रद्द |
| `console.title` | Press console | प्रेस कंसोल |
| `console.queue` | Queue | कतार |
| `console.noRuns` | Nothing queued for this press. | इस प्रेस के लिए कतार में कुछ नहीं। |
| `console.run` | Run {number} | रन {number} |
| `console.status.queued` | Queued | कतार में |
| `console.status.die_issued` | Die issued | Die मिल गई |
| `console.status.running` | Running | चल रहा है |
| `console.status.stopped` | Stopped | रुका है |
| `console.status.counting` | Counting | गिनती |
| `console.status.logged` | Logged | दर्ज |
| `console.status.voided` | Void | रद्द |
| `console.start` | Start | शुरू करें |
| `console.stop` | Stop | रोकें |
| `console.resume` | Resume | फिर चालू करें |
| `console.undoStart` | Undo start | शुरू करना वापस लें |
| `console.count` | Count | गिनती करें |
| `console.close` | Close run | रन बंद करें |
| `console.reopen` | Reopen | फिर खोलें |
| `console.voidRun` | Void run | रन रद्द करें |
| `console.dieIn` | Die in | Die लगी |
| `console.dieOut` | Die out | Die उतरी |
| `console.waitingDie` | Waiting for the die room | Die रूम का इंतज़ार |
| `console.lineBusy` | Another run is on this press. | इस प्रेस पर दूसरा रन चल रहा है। |
| `console.stopReason` | Why stopped | क्यों रुका |
| `console.operator` | Operator | ऑपरेटर |
| `console.relief` | Relief operator | रिलीफ़ ऑपरेटर |
| `console.supervisor` | Supervisor | सुपरवाइज़र |
| `console.cast` | Cast | कास्ट |
| `console.shift` | Shift | शिफ्ट |
| `console.productionDay` | Day | दिन |
| `console.good` | Good kg | अच्छा kg |
| `console.reject` | Reject kg | रिजेक्ट kg |
| `console.ends` | Ends kg | टुकड़े kg |
| `console.discard` | Butt kg | बट kg |
| `console.input` | Billet kg | बिलेट kg |
| `console.recovery` | Recovery | रिकवरी |
| `console.balance` | Balance {kg} kg | बाकी {kg} kg |
| `console.balanceWarn` | Billets and output differ by more than {pct}%. | बिलेट और माल में {pct}% से ज़्यादा फ़र्क है। |
| `console.pressRemark` | Press remark | प्रेस टिप्पणी |
| `console.dieRemark` | Die remark | Die टिप्पणी |
| `console.timeUnconfirmed` | Time not confirmed | समय पक्का नहीं |

### ageing (20)

| Key | English | हिंदी |
|---|---|---|
| `title` | Ageing | एजिंग |
| `board` | Ageing board | एजिंग बोर्ड |
| `readings.title` | Readings | रीडिंग |
| `readings.batch` | Batch {number} | बैच {number} |
| `readings.oven` | Oven | ओवन |
| `readings.temperature` | Temperature (°C) | तापमान (°C) |
| `readings.soak` | Soak time | सोक समय |
| `readings.start` | Start | शुरू |
| `readings.end` | End | खत्म |
| `readings.hardness` | Hardness | हार्डनेस |
| `readings.addReading` | Add reading | रीडिंग जोड़ें |
| `readings.saved` | Reading saved | रीडिंग सेव हुई |
| `readings.pass` | Pass | पास |
| `readings.fail` | Fail | फ़ेल |
| `readings.hold` | Hold | होल्ड |
| `readings.release` | Release | छोड़ें |
| `readings.rework` | Age again | फिर से एजिंग |
| `readings.scrap` | Scrap | स्क्रैप |
| `readings.empty` | No readings yet. | अभी कोई रीडिंग नहीं। |
| `readings.outOfRange` | Outside {min} to {max}. | {min} से {max} के बाहर। |

### reasons (48)

| Key | English | हिंदी |
|---|---|---|
| `kinds.downtime` | Downtime | रुकावट |
| `kinds.qc_reject` | Rejects | रिजेक्ट |
| `kinds.void` | Void | रद्द |
| `kinds.reprint` | Reprint | फिर से प्रिंट |
| `kinds.ageing_hold` | Ageing hold | एजिंग होल्ड |
| `kinds.ageing_rework` | Age again | फिर से एजिंग |
| `kinds.ageing_scrap` | Ageing scrap | एजिंग स्क्रैप |
| `kinds.reallocate` | Move to another order | दूसरे ऑर्डर में डालना |
| `downtime.die_change` | Die change | Die बदली |
| `downtime.billet_wait` | Waiting for billets | बिलेट का इंतज़ार |
| `downtime.breakdown` | Breakdown | ब्रेकडाउन |
| `downtime.power` | Power cut | बिजली गई |
| `downtime.no_order` | No order | ऑर्डर नहीं |
| `downtime.die_correction` | Die correction | Die सुधार |
| `downtime.quality_hold` | Quality hold | क्वालिटी होल्ड |
| `downtime.other` | Other | अन्य |
| `qc_reject.dimension` | Dimension | नाप |
| `qc_reject.surface` | Surface | सतह |
| `qc_reject.bend` | Bend | टेढ़ा |
| `qc_reject.crack` | Crack | दरार |
| `qc_reject.short_length` | Short length | छोटी लंबाई |
| `qc_reject.other` | Other | अन्य |
| `void.wrong_entry` | Wrong entry | गलत एंट्री |
| `void.damaged` | Damaged | खराब |
| `void.repacked` | Packed again | फिर से पैक |
| `void.other` | Other | अन्य |
| `reprint.label_damaged` | Label damaged | लेबल खराब |
| `reprint.printer_fault` | Printer fault | प्रिंटर खराब |
| `reprint.wrong_label` | Wrong label | गलत लेबल |
| `reprint.other` | Other | अन्य |
| `ageing_hold.hardness_low` | Hardness low | हार्डनेस कम |
| `ageing_hold.hardness_high` | Hardness high | हार्डनेस ज़्यादा |
| `ageing_hold.under_soak` | Under soak | सोक कम |
| `ageing_hold.surface` | Surface | सतह |
| `ageing_hold.bend` | Bend | टेढ़ा |
| `ageing_hold.customer` | Customer hold | ग्राहक का होल्ड |
| `ageing_hold.other` | Other | अन्य |
| `ageing_rework.hardness_low` | Hardness low | हार्डनेस कम |
| `ageing_rework.under_soak` | Under soak | सोक कम |
| `ageing_rework.other` | Other | अन्य |
| `ageing_scrap.bend` | Bend | टेढ़ा |
| `ageing_scrap.surface` | Surface | सतह |
| `ageing_scrap.short_length` | Short length | छोटी लंबाई |
| `ageing_scrap.other` | Other | अन्य |
| `reallocate.length_mismatch` | Different cut length | अलग कट लंबाई |
| `reallocate.customer_request` | Customer asked | ग्राहक ने कहा |
| `reallocate.packed_wrong_order` | Packed on the wrong order | गलत ऑर्डर पर पैक हुआ |
| `reallocate.other` | Other | अन्य |

### plantSettings (50)

| Key | English | हिंदी |
|---|---|---|
| `title` | Plant settings | प्लांट सेटिंग |
| `shifts.title` | Shifts | शिफ्ट |
| `shifts.name` | Name | नाम |
| `shifts.start` | Starts | शुरू |
| `shifts.end` | Ends | खत्म |
| `shifts.add` | Add shift | शिफ्ट जोड़ें |
| `shifts.suggest` | Use Day and Night | दिन और रात लें |
| `shifts.none` | No shifts. Days start at midnight. | कोई शिफ्ट नहीं। दिन रात 12 बजे शुरू होता है। |
| `shifts.errors.count` | Keep 1 to 4 shifts. | 1 से 4 शिफ्ट रखें। |
| `shifts.errors.id` | Reload and try again. | पेज दोबारा लोड करके फिर कोशिश करें। |
| `shifts.errors.name_empty` | Give each shift a name. | हर शिफ्ट का नाम लिखें। |
| `shifts.errors.name_long` | Keep names under 40 characters. | नाम 40 अक्षर से छोटा रखें। |
| `shifts.errors.name_duplicate` | Two shifts have the same name. | दो शिफ्ट का एक ही नाम है। |
| `shifts.errors.minute_range` | Pick a time in the day. | दिन का कोई समय चुनें। |
| `shifts.errors.seq` | Reload and try again. | पेज दोबारा लोड करके फिर कोशिश करें। |
| `shifts.errors.zero_length` | A shift can't start and end at the same time. | शिफ्ट एक ही समय पर शुरू और खत्म नहीं हो सकती। |
| `shifts.errors.gap_or_overlap` | Shifts must cover the whole day with no gap or overlap. | शिफ्ट पूरा दिन ढकें, बीच में खाली या दोहरा समय न हो। |
| `standards.title` | Standards | स्टैंडर्ड |
| `standards.standard` | Standard | स्टैंडर्ड |
| `standards.cml` | Licence (CM/L) | लाइसेंस (CM/L) |
| `standards.solid` | Solid | सॉलिड |
| `standards.hollow` | Hollow | हॉलो |
| `standards.semi` | Semi hollow | सेमी हॉलो |
| `standards.semiFallback` | Left blank, semi hollow uses the solid one. | खाली छोड़ें तो सेमी हॉलो में सॉलिड वाला लगेगा। |
| `modules.title` | Modules | मॉड्यूल |
| `modules.hint` | Turn off what the plant doesn't use. | जो प्लांट में नहीं चलता उसे बंद करें। |
| `modules.names.customers` | Customers | ग्राहक |
| `modules.names.dies` | Dies | Die |
| `modules.names.bundles` | Bundles | Bundle |
| `modules.names.dispatches` | Dispatches | Dispatch |
| `modules.names.orders` | Orders | ऑर्डर |
| `modules.names.foundry` | Foundry | फ़ाउंड्री |
| `modules.names.press` | Press | प्रेस |
| `modules.names.ageing` | Ageing | एजिंग |
| `modules.names.store` | Store | स्टोर |
| `modules.names.purchase` | Scrap purchase | स्क्रैप खरीद |
| `letterhead.title` | Letterhead | लेटरहेड |
| `letterhead.legalName` | Legal name | कानूनी नाम |
| `letterhead.gstin` | GSTIN | GSTIN |
| `letterhead.address` | Address | पता |
| `letterhead.phone` | Phone | फ़ोन |
| `drift.title` | Die weight colours | Die वज़न के रंग |
| `drift.green` | In band up to (%) | बैंड में (%) तक |
| `drift.amber` | Near the edge up to (%) | किनारे के पास (%) तक |
| `recovery.title` | Recovery colours | रिकवरी के रंग |
| `recovery.green` | Good from (%) | अच्छी (%) से |
| `recovery.amber` | Watch from (%) | ध्यान दें (%) से |
| `orders.dieBands` | Use die bands | Die बैंड इस्तेमाल करें |
| `orders.priceOnSalesOrder` | Rates on orders | ऑर्डर पर रेट |
| `orders.dieRequired` | Order lines need a die copy or tier | ऑर्डर लाइन पर die कॉपी या टियर ज़रूरी |

### devices (5)

| Key | English | हिंदी |
|---|---|---|
| `title` | Devices | डिवाइस |
| `label` | Name | नाम |
| `lastSeen` | Last seen {time} | आखिरी बार {time} |
| `revoke` | Sign out this device | इस डिवाइस से साइन आउट करें |
| `revoked` | Signed out | साइन आउट हो गया |

### backups (6)

| Key | English | हिंदी |
|---|---|---|
| `title` | Backups | बैकअप |
| `run` | Back up now | अभी बैकअप लें |
| `last` | Last backup {time} | आखिरी बैकअप {time} |
| `status.running` | Running | चल रहा है |
| `status.succeeded` | Done | हो गया |
| `status.failed` | Failed | नहीं हुआ |

### support (9)

| Key | English | हिंदी |
|---|---|---|
| `title` | Help | मदद |
| `ask` | Ask for help | मदद मांगें |
| `subject` | Subject | विषय |
| `body` | What happened | क्या हुआ |
| `sent` | Sent. The reply shows up here. | भेज दिया। जवाब यहां दिखेगा। |
| `reply` | Reply | जवाब |
| `status.open` | Open | खुला |
| `status.answered` | Answered | जवाब मिला |
| `status.closed` | Closed | बंद |

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
| Step 1 text | Open "More", then "Dies". Tap "New die". To change a die, open it and tap "Edit die". | "और" खोलें, फिर "Die"। "नया die" दबाएं। किसी die को बदलने के लिए उसे खोलें और "Die बदलें" दबाएं। |
| Step 2 | Enter the code | कोड डालें |
| Step 2 text | Fill in the series, section code and name. The floor sees the section code when picking a die in Pack. | सीरीज़, सेक्शन कोड और नाम भरें। पैकिंग में die चुनते समय फ़्लोर को सेक्शन कोड ही दिखता है। |
| Step 3 | Set the weight range | वज़न रेंज डालें |
| Step 3 text | Enter the min and max weight in kg for one 12 ft length. Pack uses this range for the green or amber kg/12ft chip. | 12 ft लंबाई का कम से कम और ज़्यादा से ज़्यादा वज़न kg में डालें। पैकिंग में kg/12ft का हरा या पीला निशान इसी रेंज से आता है। |
| Step 4 | Set the status | स्टेटस चुनें |
| Step 4 text | "Active" dies show in Pack. "Archived" dies are hidden from Pack but keep all their bundles and history. | "चालू" die पैकिंग में दिखते हैं। "बंद" die पैकिंग में नहीं दिखते, पर उनके सारे bundle और इतिहास रहते हैं। |
| Step 5 | Add measurements if you have them | नाप हों तो डालें |
| Step 5 text | Width, thickness, oblique and leg are under "Advanced". They are optional. | चौड़ाई, मोटाई, oblique और लेग "एडवांस" में हैं। ये ज़रूरी नहीं हैं। |
| Step 6 | Save | सेव करें |
| Step 6 text | Tap "Save die". The die's page opens with its weight band and measurements. | "Die सेव करें" दबाएं। Die का पेज खुलेगा, उस पर वज़न की रेंज और नाप दिखते हैं। |
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
| Step 5 text | Tap "Save customer". The customer's page opens; it lists every dispatch to them, and "Edit customer" changes the details later. | "ग्राहक सेव करें" दबाएं। ग्राहक का पेज खुलेगा; उस पर इस ग्राहक के सारे dispatch दिखते हैं, और बाद में "ग्राहक बदलें" से जानकारी बदल सकते हैं। |
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

### Weigh a scrap lot (`weigh-scrap-lot`)

| Part | English | हिंदी |
|---|---|---|
| Title | Weigh a scrap lot | स्क्रैप लॉट तौलें |
| When | Use this when a scrap truck comes to the kanta. | जब स्क्रैप की गाड़ी कांटे पर आए। |
| Step 1 | Start the lot | लॉट शुरू करें |
| Step 1 text | Open "Purchase" and tap "New lot". | "खरीद" खोलें और "नया लॉट" दबाएं। |
| Step 2 | Pick the vendor | पार्टी चुनें |
| Step 2 text | Search by the name on the slip. Any spelling the book uses finds the same vendor. For a new party, tap "Add new vendor". A manager confirms it later. | पर्ची पर लिखे नाम से खोजें। बुक में लिखा कोई भी नाम उसी पार्टी को ढूंढ लेता है। नई पार्टी के लिए "नई पार्टी जोड़ें" दबाएं। मैनेजर उसे बाद में पक्का करेंगे। |
| Step 3 | Material and rate | माल और रेट |
| Step 3 text | Choose the material and the grade, and type the rate per kg. The vendor's usual material and last rate are one tap away. | माल और ग्रेड चुनें, और प्रति kg रेट लिखें। पार्टी का आम माल और पिछला रेट एक टैप पर मिलता है। |
| Step 4 | Enter both weights | दोनों वज़न डालें |
| Step 4 text | Type the weight on the party's slip, then our kanta weight. The difference and the tolerance show straight away. If the truck is not weighed here yet, leave our kanta empty and add it later with "Edit weights". | पार्टी की पर्ची का वज़न लिखें, फिर हमारे कांटे का वज़न। फ़र्क और छूट तुरंत दिखते हैं। गाड़ी यहां अभी नहीं तौली तो हमारा कांटा खाली छोड़ें और बाद में "वज़न बदलें" से डालें। |
| Step 5 | Short beyond the tolerance | छूट से ज़्यादा कमी |
| Step 5 text | If the lot is short beyond the tolerance, the office raises the debit note on the same screen: keep "Raise the debit note now" on and check the kg. A manager approves it in "Approvals". | अगर लॉट छूट से ज़्यादा कम है, तो ऑफ़िस उसी स्क्रीन पर डेबिट नोट बनाता है: "डेबिट नोट अभी बनाएं" चालू रखें और kg जांच लें। मैनेजर इसे "मंज़ूरी" में मंज़ूर करते हैं। |
| Step 6 | Save and mark OK | सेव करें और OK करें |
| Step 6 text | Tap "Save lot". When the truck is unloaded, open the lot and tap "Mark OK". The scrap goes into scrap stock. | "लॉट सेव करें" दबाएं। गाड़ी उतर जाए तो लॉट खोलें और "OK करें" दबाएं। स्क्रैप, स्क्रैप स्टॉक में चला जाता है। |
| Problem 1 | There is no "Mark OK" button | "OK करें" का बटन नहीं है |
| Fix 1 | Either our kanta weight is missing, or the lot is short beyond the tolerance and no debit note covers it. The lot page says which. | या तो हमारे कांटे का वज़न नहीं डाला, या लॉट छूट से ज़्यादा कम है और कोई डेबिट नोट उसे नहीं ढकता। लॉट के पेज पर वजह लिखी है। |
| Problem 2 | I typed a wrong weight | गलत वज़न डल गया |
| Fix 2 | Open the lot and tap "Edit weights" before it is OK. Once a note on the weight is open the weights are locked, so ask the manager to reject that note first. | OK होने से पहले लॉट खोलें और "वज़न बदलें" दबाएं। वज़न पर नोट खुला हो तो वज़न बंद रहता है, इसलिए पहले मैनेजर से वह नोट नामंज़ूर करवाएं। |
| Problem 3 | The same vendor shows up twice | एक ही पार्टी दो बार दिखती है |
| Fix 3 | A manager merges the two vendors in Masters. Their lots move with the merge. | मैनेजर Masters में दोनों पार्टियों को मिला देते हैं। उनके लॉट भी साथ चले जाते हैं। |

### Issue and receive store items (`store-entries`)

| Part | English | हिंदी |
|---|---|---|
| Title | Issue and receive store items | स्टोर से माल दें और माल लें |
| When | Use this when chemicals, fuel, gas or spares leave the store or a delivery comes in. | जब केमिकल, ईंधन, गैस या स्पेयर स्टोर से बाहर जाएं या कोई डिलीवरी आए। |
| Step 1 | Open the store | स्टोर खोलें |
| Step 1 text | Open "Store". Every item shows how much is in the store now. | "स्टोर" खोलें। हर सामान के आगे दिखता है कि अभी स्टोर में कितना है। |
| Step 2 | Issue to the floor | फ़्लोर को माल दें |
| Step 2 text | Tap "Issue", pick the item, type the quantity and choose what it is for. Tap "Issue" again to save. The MRS number shows on screen. | "माल दें" दबाएं, सामान चुनें, मात्रा लिखें और किस काम के लिए है वो चुनें। सेव करने के लिए फिर से "माल दें" दबाएं। स्क्रीन पर MRS नंबर दिखेगा। |
| Step 3 | Receive a delivery | डिलीवरी लें |
| Step 3 text | Tap "Receive", pick the item, type the quantity from the challan and add the challan or bill number. Tap "Receive" again to save. The GRN number shows on screen. | "माल लें" दबाएं, सामान चुनें, चालान से मात्रा लिखें और चालान या बिल नंबर डालें। सेव करने के लिए फिर से "माल लें" दबाएं। स्क्रीन पर GRN नंबर दिखेगा। |
| Step 4 | Exchange old for new | पुराना देकर नया लें |
| Step 4 text | When an old part leaves the store and a new one comes in, tap "Exchange". Type how many go out and how many come in. | जब पुराना पार्ट स्टोर से बाहर जाए और नया अंदर आए, तो "पुराना देकर नया" दबाएं। कितने बाहर गए और कितने अंदर आए, लिखें। |
| Step 5 | Check an item | सामान देखें |
| Step 5 text | Tap an item in the list to see its balance and every entry for it. | लिस्ट में किसी सामान पर दबाएं, उसका बैलेंस और उसकी हर एंट्री दिखेगी। |
| Problem 1 | It says there is not enough in the store | लिखा आया कि स्टोर में इतना नहीं है |
| Fix 1 | You typed more than the store holds. Issue less, or receive the delivery first and then issue. | आपने स्टोर में जितना है उससे ज़्यादा लिखा है। कम दें, या पहले डिलीवरी लें और फिर दें। |
| Problem 2 | I saved a wrong quantity | गलत मात्रा सेव हो गई |
| Fix 2 | Open the entry, tap "Cancel entry" and write why. Then make the entry again with the right quantity. | एंट्री खोलें, "एंट्री रद्द करें" दबाएं और वजह लिखें। फिर सही मात्रा से नई एंट्री करें। |
| Problem 3 | The item is not in the list | सामान लिस्ट में नहीं है |
| Fix 3 | Open "Store items" and tap "Add item". Choose its unit carefully: it can't change after the first entry. | "स्टोर का सामान" खोलें और "सामान जोड़ें" दबाएं। इकाई ध्यान से चुनें: पहली एंट्री के बाद यह नहीं बदल सकती। |
