# Hindi review

For Lalubhai. Every Hindi string in orrn, next to the English it comes from.

This file is generated from `packages/i18n` by `bun run --cwd packages/i18n export-review`. Don't edit it by hand. Send corrections as "key: new Hindi" (for example `pack.new.saveBundle: Bundle सेव करो`) and we update `hi.ts` and regenerate.

What to check:

1. Would someone on the floor understand it on first read?
2. Is it the word the plant actually uses? (for example ग्राहक or पार्टी, रद्द or कैंसल)
3. Words kept in English on purpose: bundle, die, dispatch, PO, kg, kg/12ft, serial numbers, codes, numbers, orrn. Tell us if any of these should be Hindi, or if more words should stay English.

Counts: 2008 screen strings in 30 groups, 12 guides with 220 strings.

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

### status (31)

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
| `company.pending` | Waiting for approval | मंज़ूरी बाकी |

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

### nav (40)

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

### auth (88)

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
| `login.showPassword` | Show password | पासवर्ड दिखाएं |
| `totp.title` | Enter your code | अपना कोड डालें |
| `totp.body` | Open your authenticator app and type the 6-digit code for orrn. | अपना authenticator ऐप खोलें और orrn वाला 6 अंकों का कोड लिखें। |
| `totp.code` | 6-digit code | 6 अंकों का कोड |
| `totp.submit` | Verify | जांचें |
| `totp.verifying` | Checking | जांच हो रही है |
| `totp.wrongCode` | That code didn't work. Codes change every 30 seconds, so type the newest one. | यह कोड नहीं चला। कोड हर 30 सेकंड में बदलता है, इसलिए सबसे नया कोड डालें। |
| `totp.codeRequired` | Type all 6 digits. | पूरे 6 अंक लिखें। |
| `totp.trust` | Trust this device for 30 days | इस डिवाइस पर 30 दिन तक भरोसा रखें |
| `totp.useBackup` | Use a backup code instead | इसकी जगह बैकअप कोड इस्तेमाल करें |
| `totp.useApp` | Use the authenticator app instead | इसकी जगह authenticator ऐप इस्तेमाल करें |
| `totp.backupTitle` | Enter a backup code | बैकअप कोड डालें |
| `totp.backupBody` | Type one of the backup codes you saved when you turned on two-factor. Each one works once. | टू-फ़ैक्टर चालू करते समय जो बैकअप कोड सेव किए थे, उनमें से एक लिखें। हर कोड एक बार ही चलता है। |
| `totp.backupCode` | Backup code | बैकअप कोड |
| `totp.backupRequired` | Type a backup code. | बैकअप कोड लिखें। |
| `totp.wrongBackup` | That backup code didn't work. Check it, or use one you haven't used yet. | यह बैकअप कोड नहीं चला। इसे जांचें, या कोई ऐसा कोड डालें जो पहले इस्तेमाल नहीं हुआ। |
| `totp.back` | Back to password | पासवर्ड पर वापस |
| `validation.email` | Enter your email. | अपना ईमेल डालें। |
| `validation.password` | Enter your password. | अपना पासवर्ड डालें। |
| `validation.passwordShort` | Use at least 8 characters. | कम से कम 8 अक्षर रखें। |
| `validation.name` | Enter your name. | अपना नाम डालें। |
| `validation.company` | Enter your company's name. | अपनी कंपनी का नाम डालें। |
| `errors.tooMany` | Too many tries. Wait a minute, then try again. | बहुत बार कोशिश हो गई। एक मिनट रुकें, फिर कोशिश करें। |
| `errors.twoFactorExpired` | That took too long. Sign in again with your password. | बहुत देर हो गई। अपने पासवर्ड से फिर से साइन इन करें। |
| `brand.label` | How orrn works | orrn कैसे काम करता है |
| `brand.holdStep` | Hold | होल्ड |
| `brand.pack` | Weight and pieces in, label out. | वज़न और पीस डालें, लेबल निकालें। |
| `requestAccess.title` | Request access | एक्सेस मांगें |
| `requestAccess.subtitle` | Tell us about your plant and we'll get in touch to set up your company. | अपने प्लांट के बारे में बताएं। आपकी कंपनी सेट करने के लिए हम संपर्क करेंगे। |
| `requestAccess.company` | Company name | कंपनी का नाम |
| `requestAccess.name` | Your name | आपका नाम |
| `requestAccess.workEmail` | Work email | काम का ईमेल |
| `requestAccess.lines` | Extrusion lines | एक्सट्रूज़न लाइनें |
| `requestAccess.slotTitle` | When could we show you orrn? | हम आपको orrn कब दिखा सकते हैं? |
| `requestAccess.slotHint` | Optional. We'll confirm the time by email. | ज़रूरी नहीं। समय हम ईमेल से पक्का करेंगे। |
| `requestAccess.preferredDate` | Preferred date | पसंद की तारीख |
| `requestAccess.preferredTime` | Preferred time | पसंद का समय |
| `requestAccess.notes` | Anything else we should know | और कुछ जो हमें पता होना चाहिए |
| `requestAccess.notesHint` | Optional. Up to {max} characters. | ज़रूरी नहीं। ज़्यादा से ज़्यादा {max} अक्षर। |
| `requestAccess.submit` | Send request | रिक्वेस्ट भेजें |
| `requestAccess.submitting` | Sending | भेज रहे हैं |
| `requestAccess.failed` | The request didn't send. Check the fields and try again. | रिक्वेस्ट नहीं गई। जानकारी जांचें और फिर से कोशिश करें। |
| `requestAccess.successTitle` | Request sent | रिक्वेस्ट भेज दी |
| `requestAccess.successBody` | We have your request. We'll reply to {email}. | आपकी रिक्वेस्ट मिल गई। हम {email} पर जवाब देंगे। |
| `requestAccess.backHome` | Back to home | होम पर वापस |
| `invite.genericTitle` | Join your team on orrn | orrn पर अपनी टीम से जुड़ें |
| `invite.genericBody` | Use the email address your invite was sent to. | वही ईमेल डालें जिस पर आपका इनवाइट आया है। |
| `invite.name` | Your name | आपका नाम |
| `invite.email` | Email | ईमेल |
| `invite.password` | Password | पासवर्ड |
| `invite.passwordHint` | At least 8 characters. | कम से कम 8 अक्षर। |
| `invite.submit` | Create account and join | अकाउंट बनाएं और जुड़ें |
| `invite.submitting` | Joining | जुड़ रहे हैं |
| `invite.signInSubmit` | Sign in and join | साइन इन करें और जुड़ें |
| `invite.existingAccount` | This email already has an account. Sign in to join. | इस ईमेल का अकाउंट पहले से है। जुड़ने के लिए साइन इन करें। |
| `invite.signedInAs` | You're signed in as {email}. | आप {email} से साइन इन हैं। |
| `invite.joinAsMe` | Join with this account | इसी अकाउंट से जुड़ें |
| `invite.otherAccount` | Use another account | दूसरा अकाउंट इस्तेमाल करें |
| `invite.joined` | Joined | जुड़ गए |
| `invite.expiredTitle` | This invite link doesn't work | यह इनवाइट लिंक काम नहीं कर रहा |
| `invite.expired` | This invite link has expired or was already used. Ask your admin for a new one. | यह इनवाइट लिंक पुराना हो गया है या पहले ही इस्तेमाल हो चुका है। अपने एडमिन से नया लिंक मांगें। |
| `invite.wrongEmailTitle` | This invite is for a different email | यह इनवाइट किसी दूसरे ईमेल के लिए है |
| `invite.wrongEmail` | Sign out, then open the link again and use the email the invite was sent to. | साइन आउट करें, फिर लिंक दोबारा खोलें और वही ईमेल डालें जिस पर इनवाइट आया था। |
| `invite.goSignIn` | Go to sign in | साइन इन पर जाएं |
| `continue.title` | Your workspace is ready | आपका वर्कस्पेस तैयार है |
| `continue.body` | Tap Continue to sign in and set your password. | साइन इन करके पासवर्ड बनाने के लिए आगे बढ़ें दबाएं। |
| `continue.button` | Continue | आगे बढ़ें |
| `continue.brokenTitle` | This link no longer works | यह लिंक अब काम नहीं करता |
| `continue.brokenBody` | It was already used or has expired. Ask the person who sent it for a new sign-in link. | यह पहले ही इस्तेमाल हो चुका है या खत्म हो गया है। जिसने भेजा था उनसे नया साइन इन लिंक मांगें। |
| `continue.goSignIn` | Go to sign in | साइन इन पर जाएं |
| `noAccess.title` | Your account isn't in a company yet | आपका अकाउंट अभी किसी कंपनी में नहीं है |
| `noAccess.body` | You're signed in as {email}. | आप {email} से साइन इन हैं। |
| `noAccess.signedInLabel` | Signed in as | इस ईमेल से साइन इन हैं |
| `noAccess.ask` | Ask your admin to invite this email. | अपने एडमिन से इस ईमेल को इनवाइट करने के लिए कहें। |
| `noAccess.copyEmail` | Copy email | ईमेल कॉपी करें |
| `noAccess.switchAccount` | Sign out and use another account | साइन आउट करें और दूसरा अकाउंट इस्तेमाल करें |
| `noAccess.ownPlant` | Setting up orrn for your own plant? | अपने प्लांट के लिए orrn शुरू करना है? |
| `sessionExpired` | Your session ended. Sign in again. | आपका सेशन खत्म हो गया। फिर से साइन इन करें। |
| `signOut` | Sign out | साइन आउट |

### welcome (58)

| Key | English | हिंदी |
|---|---|---|
| `steps.password` | Password | पासवर्ड |
| `steps.twoFactor` | Two-factor | टू-फ़ैक्टर |
| `steps.company` | Company details | कंपनी की जानकारी |
| `steps.done` | Done | हो गया |
| `password.title` | Set your password | अपना पासवर्ड बनाएं |
| `password.body` | You'll use this with your email to sign in. | साइन इन करने के लिए आप ईमेल के साथ यही पासवर्ड डालेंगे। |
| `password.forcedBody` | Your admin gave you a temporary password. Choose your own to continue. | आपके एडमिन ने आपको कुछ समय का पासवर्ड दिया था। आगे बढ़ने के लिए अपना पासवर्ड बनाएं। |
| `password.newPassword` | New password | नया पासवर्ड |
| `password.confirmPassword` | Type it again | फिर से लिखें |
| `password.hint` | At least 8 characters. | कम से कम 8 अक्षर। |
| `password.mismatch` | The two passwords don't match. | दोनों पासवर्ड एक जैसे नहीं हैं। |
| `password.submit` | Save password | पासवर्ड सेव करें |
| `password.submitting` | Saving | सेव हो रहा है |
| `password.alreadySet` | This account already has a password, so we kept it. Use that one to sign in. | इस अकाउंट का पासवर्ड पहले से है, इसलिए वही रखा है। साइन इन के लिए वही डालें। |
| `twoFactor.title` | Turn on two-factor | टू-फ़ैक्टर चालू करें |
| `twoFactor.body` | Scan this QR code with an authenticator app, then type the 6-digit code it shows. | इस QR कोड को authenticator ऐप से स्कैन करें, फिर ऐप में दिख रहा 6 अंकों का कोड लिखें। |
| `twoFactor.confirmBody` | Type your password to get your QR code. | QR कोड पाने के लिए अपना पासवर्ड लिखें। |
| `twoFactor.confirmPassword` | Your password | आपका पासवर्ड |
| `twoFactor.showQr` | Show QR code | QR कोड दिखाएं |
| `twoFactor.wrongPassword` | That password is wrong. Type the password you sign in with. | यह पासवर्ड गलत है। वही पासवर्ड लिखें जिससे आप साइन इन करते हैं। |
| `twoFactor.loading` | Getting your QR code | आपका QR कोड आ रहा है |
| `twoFactor.qrAlt` | QR code for your authenticator app | आपके authenticator ऐप के लिए QR कोड |
| `twoFactor.newQr` | This is a new QR code. A code you added to your app before won't work, so scan this one. | यह नया QR कोड है। ऐप में पहले जोड़ा गया कोड अब काम नहीं करेगा, इसलिए इसे स्कैन करें। |
| `twoFactor.manualKey` | Can't scan it? Type this key in the app instead. | स्कैन नहीं हो रहा? यह key ऐप में लिख दें। |
| `twoFactor.copyKey` | Copy key | key कॉपी करें |
| `twoFactor.code` | 6-digit code | 6 अंकों का कोड |
| `twoFactor.submit` | Turn on two-factor | टू-फ़ैक्टर चालू करें |
| `twoFactor.verifying` | Checking | जांच हो रही है |
| `twoFactor.backupTitle` | Backup codes | बैकअप कोड |
| `twoFactor.backupBody` | Keep these somewhere safe. Each one works once if you lose your phone. | इन्हें संभाल कर रखें। फ़ोन खो जाए तो हर कोड एक बार काम करेगा। |
| `twoFactor.copyCodes` | Copy codes | कोड कॉपी करें |
| `twoFactor.continue` | I saved them, continue | सेव कर लिए, आगे बढ़ें |
| `company.title` | Company details | कंपनी की जानकारी |
| `company.body` | Tell us where your plant is and how to reach you. | बताएं कि आपका प्लांट कहां है और आपसे कैसे संपर्क करें। |
| `company.location` | Location | जगह |
| `company.locationHint` | Town or industrial area, like Pandesara, Surat. | शहर या इंडस्ट्रियल एरिया, जैसे पांडेसरा, सूरत। |
| `company.contact` | Contact phone | संपर्क फ़ोन |
| `company.timezone` | Time zone | टाइम ज़ोन |
| `company.thisDevice` | {zone} (this device) | {zone} (यह डिवाइस) |
| `company.presses` | Number of presses | प्रेस की संख्या |
| `company.pressesMax` | Up to {max} presses. | ज़्यादा से ज़्यादा {max} प्रेस। |
| `company.termsTitle` | The short version of the terms | शर्तें, छोटे में |
| `company.termsUse` | Use orrn for your company's work, in the role you were given. | orrn को अपनी कंपनी के काम के लिए, अपने दिए गए रोल में इस्तेमाल करें। |
| `company.termsPasswords` | Keep your password and authenticator to yourself. | अपना पासवर्ड और authenticator किसी से शेयर न करें। |
| `company.termsData` | Your company's data stays in your company, and every change is logged. | आपकी कंपनी का डेटा आपकी कंपनी में ही रहता है, और हर बदलाव का रिकॉर्ड रहता है। |
| `company.terms` | I agree to the orrn terms of service | मुझे orrn की सेवा शर्तें मंज़ूर हैं |
| `company.termsRequired` | Tick the box to agree before you continue. | आगे बढ़ने से पहले बॉक्स पर टिक करके मंज़ूरी दें। |
| `company.submit` | Save and continue | सेव करें और आगे बढ़ें |
| `company.submitting` | Saving | सेव हो रहा है |
| `done.title` | You're set up | सब तैयार है |
| `done.body` | Your account is ready. | आपका अकाउंट तैयार है। |
| `done.as` | You're in {company} as {role}. | आप {company} में {role} के रूप में हैं। |
| `done.joinedTitle` | Welcome to {company} | {company} में आपका स्वागत है |
| `done.joinedAs` | You're in as {role}. | आप {role} के रूप में जुड़ गए हैं। |
| `done.go` | Go to Today | आज का पेज खोलें |
| `done.goAdmin` | Open Godseye | Godseye खोलें |
| `done.goOther` | Continue | आगे बढ़ें |
| `done.opening` | Opening | खुल रहा है |

### today (77)

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

### pack (131)

| Key | English | हिंदी |
|---|---|---|
| `title` | Pack | पैकिंग |
| `newSession` | New packing session | नया पैकिंग सेशन |
| `newSessionHint` | Choose the die, then enter each bundle's weight and pieces. | Die चुनें, फिर हर bundle का वज़न और पीस डालें। |
| `search` | Search session code or PO | सेशन कोड या PO से खोजें |
| `clearSearch` | Clear search | खोज हटाएं |
| `noMatch` | No sessions match "{query}". Check the code or PO. | "{query}" से कोई सेशन नहीं मिला। कोड या PO जांचें। |
| `listLabel` | Packing sessions | पैकिंग सेशन |
| `loadFailed` | Packing sessions didn't load. Check the connection and try again. | पैकिंग सेशन लोड नहीं हुए। कनेक्शन जांचें और फिर से कोशिश करें। |
| `whenToday` | Today, {time} | आज, {time} |
| `whenYesterday` | Yesterday, {time} | कल, {time} |
| `whenDate` | {date}, {time} | {date}, {time} |
| `unknownPacker` | Not known | पता नहीं |
| `draft.chip` | Not saved | सेव नहीं हुआ |
| `draft.body` | {count} {count:bundle\|bundles} entered in this tab and not saved yet. | इस टैब में डाले गए {count} bundle अभी सेव नहीं {count:हुआ\|हुए}। |
| `draft.resume` | Continue session | सेशन जारी रखें |
| `columns.session` | Session | सेशन |
| `columns.die` | Die | Die |
| `columns.section` | Section | सेक्शन |
| `columns.bundles` | Bundles | Bundle |
| `columns.kg` | kg | kg |
| `columns.packedBy` | Packed by | किसने पैक किया |
| `columns.when` | When | कब |
| `columns.po` | PO | PO |
| `empty` | No packing sessions yet. | अभी कोई पैकिंग सेशन नहीं है। |
| `emptyAction` | Start a packing session | पैकिंग सेशन शुरू करें |
| `new.title` | New packing session | नया पैकिंग सेशन |
| `new.steps.die` | Die and defaults | Die और कट लंबाई |
| `new.steps.bundles` | Bundles | Bundle |
| `new.steps.review` | Review and save | जांचें और सेव करें |
| `new.dieSearch` | Search die code or section | Die कोड या सेक्शन से खोजें |
| `new.recentDies` | Recent | हाल के |
| `new.allDies` | All dies | सारे die |
| `new.diesShowing` | Showing {shown} of {total} dies. Type a code to find the rest. | {total} में से {shown} die दिख रहे हैं। बाकी के लिए कोड टाइप करें। |
| `new.dieRange` | Range {min} to {max} kg/12ft | रेंज {min} से {max} kg/12ft |
| `new.noDies` | No dies match. Check the code, or add the die first. | कोई die नहीं मिला। कोड जांचें, या पहले die जोड़ें। |
| `new.noDiesYet` | No dies yet. Add the die before packing. | अभी कोई die नहीं है। पैकिंग से पहले die जोड़ें। |
| `new.addDie` | Add a die | Die जोड़ें |
| `new.diesFailed` | Dies didn't load. Check the connection and try again. | Die लोड नहीं हुए। कनेक्शन जांचें और फिर से कोशिश करें। |
| `new.chooseDie` | Choose this die | यह die चुनें |
| `new.changeDie` | Change die | Die बदलें |
| `new.chosenDie` | Die | Die |
| `new.dieRequired` | Choose the die for this session. | इस सेशन का die चुनें। |
| `new.cutLength` | Cut length | कट लंबाई |
| `new.cutLengthFeet` | Feet | फ़ुट |
| `new.cutLengthInches` | Inches | इंच |
| `new.cutLengthMm` | Cut length (mm) | कट लंबाई (mm) |
| `new.cutLengthHintInch` | Feet and inches, for example 11 ft 6 in. | फ़ुट और इंच, जैसे 11 ft 6 in. |
| `new.cutLengthHintMm` | In millimetres, for example 3658. | मिलीमीटर में, जैसे 3658. |
| `new.cutLengthRequired` | Enter the cut length. | कट लंबाई डालें। |
| `new.yard` | Yard | यार्ड |
| `new.yardHint` | Where these bundles will be stacked. | ये bundle किस यार्ड में रखे जाएंगे। |
| `new.yardRequired` | Choose the yard these bundles go to. | ये bundle किस यार्ड में जाएंगे, वह चुनें। |
| `new.yardsFailed` | Yards didn't load. Check the connection and try again. | यार्ड लोड नहीं हुए। कनेक्शन जांचें और फिर से कोशिश करें। |
| `new.po` | PO | PO |
| `new.noPo` | No PO | PO नहीं |
| `new.poValue` | PO {po} | PO {po} |
| `new.change` | Change | बदलें |
| `new.defaultsHint` | Every bundle in this session uses this cut length and PO unless you change it on that bundle. | इस सेशन के हर bundle में यही कट लंबाई और PO लगेगा, जब तक आप उस bundle पर इसे न बदलें। |
| `new.weight` | Weight (kg) | वज़न (kg) |
| `new.pieces` | Pieces | पीस |
| `new.weightRequired` | Enter the weight in kg, for example 52.40. | वज़न kg में डालें, जैसे 52.40. |
| `new.piecesRequired` | Enter the pieces as a whole number. | पीस पूरे नंबर में डालें। |
| `new.saveBundle` | Save bundle | Bundle सेव करें |
| `new.differentLengthPo` | Different length or PO | अलग लंबाई या PO |
| `new.lengthForBundle` | Cut length for this bundle | इस bundle की कट लंबाई |
| `new.poForBundle` | PO for this bundle | इस bundle का PO |
| `new.editBundle` | Edit bundle | Bundle बदलें |
| `new.editBundleN` | Edit bundle {n} | Bundle {n} बदलें |
| `new.editingBundle` | Editing bundle {n} | Bundle {n} बदल रहे हैं |
| `new.removeBundle` | Remove bundle | Bundle हटाएं |
| `new.bundleNumber` | Bundle {n} | Bundle {n} |
| `new.liveIncomplete` | Enter weight and pieces to see kg/12ft. | kg/12ft देखने के लिए वज़न और पीस डालें। |
| `new.liveRange` | Die range {min} to {max} | Die रेंज {min} से {max} |
| `new.bundleSaved` | Bundle {n} saved: {kg} kg, {pieces} {pieces:piece\|pieces}, {status}. | Bundle {n} सेव हुआ: {kg} kg, {pieces} पीस, {status}। |
| `new.bundleUpdated` | Bundle {n} updated. | Bundle {n} बदल गया। |
| `new.bundleRemoved` | Bundle {n} removed. | Bundle {n} हट गया। |
| `new.savedBundles` | Bundles in this session | इस सेशन के bundle |
| `new.noBundlesYet` | No bundles yet. Enter the first bundle's weight and pieces. | अभी कोई bundle नहीं है। पहले bundle का वज़न और पीस डालें। |
| `new.maxReached` | This session has {max} bundles, the most one session can hold. Review and save it, then start another. | इस सेशन में {max} bundle हैं, एक सेशन में इससे ज़्यादा नहीं आ सकते। इसे जांचकर सेव करें, फिर नया सेशन शुरू करें। |
| `new.runningTotal` | Running total | अब तक का कुल |
| `new.review` | Review | जांचें |
| `new.totalBundles` | Bundles | Bundle |
| `new.totalPieces` | Pieces | पीस |
| `new.totalKg` | kg | kg |
| `new.outOfRange` | {count} {count:bundle is\|bundles are} outside the die's range. Check {count:it\|them} before saving. | {count} bundle die की रेंज से बाहर {count:है\|हैं}। सेव करने से पहले {count:इसे\|इन्हें} जांचें। |
| `new.backToBundles` | Back to bundles | Bundle पर वापस |
| `new.saveAndPrint` | Save and print labels | सेव करें और लेबल प्रिंट करें |
| `new.saveOnly` | Save session | सेशन सेव करें |
| `new.saved` | Session saved | सेशन सेव हो गया |
| `new.saveFailed` | The session didn't save. Your bundles are still here, so try again. | सेशन सेव नहीं हुआ। आपके bundle अभी भी यहां हैं, फिर से कोशिश करें। |
| `new.saveUnsure` | We couldn't tell if the session saved. Look for it on the Pack page before you try again. | पता नहीं चला कि सेशन सेव हुआ या नहीं। फिर से कोशिश करने से पहले पैकिंग पेज पर उसे देखें। |
| `new.openPack` | Open Pack | पैकिंग खोलें |
| `new.rangeUnknown` | Range not loaded | रेंज लोड नहीं हुई |
| `new.rangeFailed` | The die's range didn't load, so bundles can't be checked against it. | Die की रेंज लोड नहीं हुई, इसलिए bundle की जांच रेंज से नहीं हो सकती। |
| `new.printingProgress` | Printing {done} of {total} | प्रिंट: {total} में से {done} |
| `new.printFailed` | {count} {count:label\|labels} didn't print | {count} लेबल प्रिंट नहीं {count:हुआ\|हुए} |
| `new.retryFailed` | Retry failed labels | फ़ेल हुए लेबल फिर से प्रिंट करें |
| `new.draftKept` | Your unsaved bundles are still here. | आपके बिना सेव किए bundle अभी भी यहां हैं। |
| `new.discardDraft` | Discard unsaved bundles | बिना सेव किए bundle हटा दें |
| `new.discardTitle` | Discard unsaved bundles? | बिना सेव किए bundle हटा दें? |
| `new.discardBody` | The {count} {count:bundle\|bundles} you entered will be cleared. This can't be undone. | आपके डाले {count} bundle हट जाएंगे। यह वापस नहीं होगा। |
| `new.discard` | Discard | हटा दें |
| `new.forbidden` | Your role can't pack bundles. Ask an admin if you need it. | आपका रोल bundle पैक नहीं कर सकता। ज़रूरत हो तो एडमिन से कहें। |
| `detail.title` | Session {code} | सेशन {code} |
| `detail.packedBy` | Packed by {name} | {name} ने पैक किया |
| `detail.printAll` | Print all labels | सारे लेबल प्रिंट करें |
| `detail.reprint` | Reprint | फिर से प्रिंट करें |
| `detail.reprintSerial` | Reprint label for {serial} | {serial} का लेबल फिर से प्रिंट करें |
| `detail.labelsSent` | Labels sent to printer | लेबल प्रिंटर को भेज दिए |
| `detail.labelSent` | Label sent to printer | लेबल प्रिंटर को भेज दिया |
| `detail.viewBundle` | Open bundle {serial} | Bundle {serial} खोलें |
| `detail.facts` | Session details | सेशन की जानकारी |
| `detail.unit` | Length unit | लंबाई की इकाई |
| `detail.unitInch` | Feet and inches | फ़ुट और इंच |
| `detail.unitMm` | Millimetres | मिलीमीटर |
| `detail.packedAt` | Packed | पैक हुआ |
| `detail.mixed` | Mixed | अलग-अलग |
| `detail.rangeColumn` | Die range | Die रेंज |
| `detail.outsideRange` | {count} outside range | {count} रेंज से बाहर |
| `detail.bundlesTitle` | Bundles | Bundle |
| `detail.loadFailed` | This session didn't load. Check the connection and try again. | यह सेशन लोड नहीं हुआ। कनेक्शन जांचें और फिर से कोशिश करें। |
| `detail.notFound` | No packing session at this link. Open it from the Pack list. | इस लिंक पर कोई पैकिंग सेशन नहीं है। पैकिंग सेशन की सूची से खोलें। |
| `print.title` | Labels | लेबल |
| `print.allSent` | {count} {count:label\|labels} sent to printer | {count} लेबल प्रिंटर को भेज {count:दिया\|दिए} |
| `print.errors.notSetUp` | Label printing isn't set up for your company. | आपकी कंपनी के लिए लेबल प्रिंटिंग सेट नहीं है। |
| `print.errors.noPrinter` | No label printer is set up for bundles. Ask a manager. | Bundle के लिए कोई लेबल प्रिंटर सेट नहीं है। मैनेजर से कहें। |
| `print.errors.noTemplate` | The bundle label isn't ready on the printer yet. Ask a manager. | Bundle का लेबल अभी प्रिंटर पर तैयार नहीं है। मैनेजर से कहें। |
| `print.errors.offline` | The printer didn't take the label. Check it is on and connected. | प्रिंटर ने लेबल नहीं लिया। जांचें कि प्रिंटर चालू है और जुड़ा है। |
| `print.errors.forbidden` | Your role can't print labels. | आपका रोल लेबल प्रिंट नहीं कर सकता। |
| `print.errors.network` | No internet connection. Check it and try again. | इंटरनेट नहीं है। कनेक्शन जांचें और फिर से कोशिश करें। |
| `print.errors.generic` | The label didn't print. Try again, or reprint it from the bundle's row. | लेबल प्रिंट नहीं हुआ। फिर से कोशिश करें, या bundle की लाइन से दोबारा प्रिंट करें। |

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

### dispatch (129)

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

### packingList (35)

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

### dies (61)

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
| `form.advancedHint` | Width, thickness, oblique and leg. All optional. | चौड़ाई, मोटाई, oblique और लेग। सब ज़रूरी नहीं। |
| `form.measureHintMm` | In mm. | mm में। |
| `form.measureHintInch` | In inches, like 0.125 for 1/8 in. | इंच में, जैसे 1/8 in के लिए 0.125। |
| `form.width` | Width | चौड़ाई |
| `form.thickness` | Thickness | मोटाई |
| `form.oblique` | Oblique | Oblique |
| `form.leg` | Leg | लेग |
| `form.submit` | Save die | Die सेव करें |
| `form.saved` | Die saved | Die सेव हो गया |
| `form.codeTaken` | This code belongs to a deleted die. Use a different code. | यह कोड एक डिलीट हुए die का है। दूसरा कोड डालें। |
| `form.duplicate` | A die with this series and section code already exists. | इस सीरीज़ और सेक्शन कोड का die पहले से है। |
| `form.fixErrors` | Check the fields marked in red. | लाल निशान वाले खाने जांचें। |
| `form.cantAdd` | Your role can't add dies. Ask an admin if you need it. | आपका रोल die नहीं जोड़ सकता। ज़रूरत हो तो एडमिन से कहें। |

### customers (103)

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

### settings (63)

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
| `data.bundlesBody` | Stock on your shelves from before orrn. Dies not in orrn yet are added for you. | orrn से पहले से रैक पर रखा स्टॉक। जो die orrn में नहीं हैं, वे अपने आप जुड़ जाते हैं। |
| `data.diesBody` | Series, section code and the weight range per 12 ft. | Series, section code और 12 ft का वज़न रेंज। |
| `data.customersBody` | Names, phone numbers, email and GSTIN. | नाम, फ़ोन नंबर, ईमेल और GSTIN। |
| `data.noAccess` | Your role can't import data. Ask an owner or admin if you need it. | आपके रोल से डेटा इम्पोर्ट नहीं होता। ज़रूरत हो तो owner या admin से कहें। |

### imports (122)

| Key | English | हिंदी |
|---|---|---|
| `title.bundles` | Import old bundles | पुराने bundle इम्पोर्ट करें |
| `title.dies` | Import dies | Die इम्पोर्ट करें |
| `title.customers` | Import customers | ग्राहक इम्पोर्ट करें |
| `about.bundles` | Bundles already on your shelves from before orrn. | orrn से पहले से रैक पर रखे bundle। |
| `about.dies` | Your die list, with the weight range per 12 ft. | आपकी die लिस्ट, 12 ft के वज़न रेंज के साथ। |
| `about.customers` | Customer names, phone numbers, email and GSTIN. | ग्राहकों के नाम, फ़ोन नंबर, ईमेल और GSTIN। |
| `drop.title` | Drop a CSV or Excel file here | CSV या Excel फ़ाइल यहां छोड़ें |
| `drop.or` | or | या |
| `drop.choose` | Choose file | फ़ाइल चुनें |
| `drop.types` | CSV or Excel (.csv, .xlsx, .xls) | CSV या Excel (.csv, .xlsx, .xls) |
| `drop.dragging` | Drop to read this file | यह फ़ाइल पढ़ने के लिए छोड़ें |
| `drop.titleTouch` | Choose a CSV or Excel file | CSV या Excel फ़ाइल चुनें |
| `columns.heading` | Columns orrn reads | orrn ये कॉलम पढ़ता है |
| `columns.required` | Needed | ज़रूरी |
| `columns.optional` | Optional | चाहें तो |
| `columns.unitRule` | Put the unit in the column name: Length (mm), Length (in), Length (ft), Weight (kg) or Weight (g). | कॉलम के नाम में यूनिट लिखें: Length (mm), Length (in), Length (ft), Weight (kg) या Weight (g)। |
| `columns.lengthFallbackMm` | A length column with no unit is read in mm, your company setting. | बिना यूनिट वाला length कॉलम mm में पढ़ा जाता है, जो आपकी कंपनी की सेटिंग है। |
| `columns.lengthFallbackInch` | A length column with no unit is read in inches, your company setting. 11 ft 6 in also works. | बिना यूनिट वाला length कॉलम इंच में पढ़ा जाता है, जो आपकी कंपनी की सेटिंग है। 11 ft 6 in भी चलता है। |
| `columns.weightFallback` | A weight column with no unit is read in kg. | बिना यूनिट वाला weight कॉलम kg में पढ़ा जाता है। |
| `columns.sample` | Download sample sheet | सैंपल शीट डाउनलोड करें |
| `legacyDies` | Dies not in orrn yet are added for you, marked legacy. Check their weight range on the Dies page afterwards. | जो die orrn में नहीं हैं, वे legacy निशान के साथ अपने आप जुड़ते हैं। बाद में Dies पेज पर उनका वज़न रेंज जांच लें। |
| `reading` | Reading {name} | {name} पढ़ रहे हैं |
| `checking` | Checking these dies against orrn | ये die orrn से मिला रहे हैं |
| `readFailed` | orrn couldn't read this file. Save it as CSV or Excel (.xlsx) and choose it again. | orrn यह फ़ाइल नहीं पढ़ पाया। इसे CSV या Excel (.xlsx) में सेव करके फिर चुनें। |
| `wrongType` | This is not a CSV or Excel file. Choose a .csv, .xlsx or .xls file. | यह CSV या Excel फ़ाइल नहीं है। .csv, .xlsx या .xls फ़ाइल चुनें। |
| `noRows` | This file has no rows under the header row. Add rows and choose it again. | इस फ़ाइल में हेडर के नीचे कोई लाइन नहीं है। लाइनें जोड़कर फिर चुनें। |
| `tooManyRows` | This file has {count} rows. orrn takes up to {max} at a time. Split it into smaller files. | इस फ़ाइल में {count} लाइनें हैं। orrn एक बार में {max} तक लेता है। इसे छोटी फ़ाइलों में बांटें। |
| `tooBig` | This file is larger than {size}. Split it into smaller files. | यह फ़ाइल {size} से बड़ी है। इसे छोटी फ़ाइलों में बांटें। |
| `missingTitle` | Columns missing | कॉलम नहीं मिले |
| `missingBody` | Add {count:this column\|these columns} to the sheet and choose it again: | शीट में {count:यह कॉलम\|ये कॉलम} जोड़ें और फिर चुनें: |
| `conflictTitle` | Two columns fill the same field | दो कॉलम एक ही चीज़ भरते हैं |
| `conflictBody` | orrn can't tell which one is right. Remove one column from each pair and choose the file again: | orrn नहीं बता सकता कि कौन सा सही है। हर जोड़ी में से एक कॉलम हटाएं और फ़ाइल फिर चुनें: |
| `conflictItem` | {field}: {columns} | {field}: {columns} |
| `chooseAnother` | Choose another file | दूसरी फ़ाइल चुनें |
| `ready` | Ready to import | इम्पोर्ट के लिए तैयार |
| `problems` | Need fixing | ठीक करनी हैं |
| `rows` | {count:row\|rows} | {count:लाइन\|लाइन} |
| `readAs.heading` | How orrn read your columns | orrn ने आपके कॉलम ऐसे पढ़े |
| `readAs.plain` | {field} | {field} |
| `readAs.same` | Used as it is | जैसा है वैसा लिया |
| `readAs.unit` | {field} in {unit} | {field}, {unit} में |
| `readAs.fallback` | {field} in {unit}, from your company setting | {field}, {unit} में, आपकी कंपनी की सेटिंग से |
| `readAs.notUsed` | Not used: {columns} | इस्तेमाल नहीं हुए: {columns} |
| `readAs.badUnit` | Not used, the unit is not clear: {columns}. Name the unit, like Length (mm) or Weight (kg). | इस्तेमाल नहीं हुए, यूनिट साफ़ नहीं है: {columns}। यूनिट लिखें, जैसे Length (mm) या Weight (kg)। |
| `readAs.perTwelve` | {field} in kg per 12 ft | {field}, kg प्रति 12 ft में |
| `unit.mm` | mm | mm |
| `unit.in` | inches | इंच |
| `unit.ft` | feet | फ़ुट |
| `unit.kg` | kg | kg |
| `unit.g` | grams | ग्राम |
| `unit.m` | metres | मीटर |
| `preview.heading` | First rows, as orrn will save them | पहली लाइनें, जैसे orrn सेव करेगा |
| `preview.row` | Row | लाइन |
| `problemList` | Rows with problems | दिक्कत वाली लाइनें |
| `problemMore` | {count} more. Download the rows to see them all. | {count} और। सब देखने के लिए लाइनें डाउनलोड करें। |
| `downloadProblems` | Download rows with problems | दिक्कत वाली लाइनें डाउनलोड करें |
| `problemColumn` | Problem | दिक्कत |
| `existing.title` | {count} {count:die is\|dies are} already in orrn | {count} die पहले से orrn में {count:है\|हैं} |
| `existing.label` | Dies already in orrn | जो die पहले से orrn में हैं |
| `existing.skip` | Leave as they are | जैसे हैं वैसे रहने दें |
| `existing.update` | Update from this sheet | इस शीट से अपडेट करें |
| `existing.help` | Only the columns in this sheet change. Empty cells, and columns the sheet doesn't have, keep what orrn has. | सिर्फ़ इस शीट के कॉलम बदलते हैं। खाली सेल और जो कॉलम शीट में नहीं हैं, उनमें orrn का डेटा वैसा ही रहता है। |
| `nothingReady` | No rows are ready to import. Fix the rows with problems and choose the file again. | कोई लाइन इम्पोर्ट के लिए तैयार नहीं है। दिक्कत वाली लाइनें ठीक करके फ़ाइल फिर चुनें। |
| `saving` | Saving {done} of {total} rows | {total} में से {done} लाइन सेव हुईं |
| `keepOpen` | Keep this open until it finishes. | पूरा होने तक इसे खुला रखें। |
| `done` | Imported | इम्पोर्ट हो गया |
| `newDies` | {count} new {count:die\|dies} added, marked legacy. Check {count:its\|their} weight range on the Dies page. | {count} नई die legacy निशान के साथ {count:जुड़ी\|जुड़ीं}। Dies पेज पर वज़न रेंज जांच लें। |
| `failed.server` | orrn's server ran into a problem. | orrn के सर्वर में दिक्कत आई। |
| `failed.busy` | orrn is busy right now. Wait a moment, then try again. | orrn अभी व्यस्त है। थोड़ी देर रुककर फिर कोशिश करें। |
| `failed.refused` | orrn did not accept these rows. | orrn ने ये लाइनें नहीं लीं। |
| `failed.savedUpTo` | Saved {done} of {total} rows, up to row {row}. | {total} में से {done} लाइन सेव हुईं, लाइन {row} तक। |
| `failed.nothingSaved` | No rows were saved. | कोई लाइन सेव नहीं हुई। |
| `failed.unknown` | orrn can't tell yet if {count} {count:row\|rows} from row {from} to row {to} {count:was\|were} saved. | orrn अभी पक्का नहीं बता सकता कि लाइन {from} से लाइन {to} तक की {count} लाइन सेव हुईं या नहीं। |
| `failed.unknownHelp` | Try again: rows that were already saved are not added twice. | फिर कोशिश करें: जो लाइनें सेव हो चुकी हैं, वे दोबारा नहीं जुड़ेंगी। |
| `failed.refusedRows` | Nothing from row {from} on was saved. | लाइन {from} से आगे कुछ सेव नहीं हुआ। |
| `failed.refusedHelp` | Download the rows not saved, fix them and import that file. Don't import this whole file again. | जो लाइनें सेव नहीं हुईं, उन्हें डाउनलोड करें, ठीक करें और वही फ़ाइल इम्पोर्ट करें। यह पूरी फ़ाइल दोबारा इम्पोर्ट न करें। |
| `confirmClose.title` | Close this import? | यह इम्पोर्ट बंद करें? |
| `confirmClose.unknown` | {count} {count:row is\|rows are} not saved for sure. To finish later, choose this same file again without changing it: rows already saved are skipped. | {count} लाइन पक्का सेव नहीं {count:हुई\|हुईं}। बाद में पूरा करने के लिए यही फ़ाइल बिना बदले फिर चुनें: जो लाइनें सेव हो चुकी हैं, वे छोड़ दी जाएंगी। |
| `confirmClose.refused` | {count} {count:row was\|rows were} not saved. Download {count:it\|them} first, so you can fix {count:it\|them} and import only {count:that row\|those rows}. | {count} लाइन सेव नहीं {count:हुई\|हुईं}। पहले {count:उसे\|उन्हें} डाउनलोड करें, ताकि ठीक करके सिर्फ़ {count:वही लाइन\|वही लाइनें} इम्पोर्ट कर सकें। |
| `confirmClose.keepOpen` | Keep open | खुला रखें |
| `confirmClose.close` | Close anyway | फिर भी बंद करें |
| `already` | {count} {count:row was\|rows were} already in orrn from an earlier import of this sheet, so {count:it was\|they were} not added again. To add {count:it\|them} again after deleting {count:it\|them} in orrn, change a value in the sheet. | {count} लाइन इसी शीट के पिछले इम्पोर्ट से पहले से orrn में {count:थी\|थीं}, इसलिए दोबारा नहीं जोड़ी {count:गई\|गईं}। orrn में डिलीट करने के बाद {count:उसे\|उन्हें} फिर जोड़ना हो तो शीट में कोई एक वैल्यू बदल दें। |
| `doneProblemsHelp` | Fix the downloaded rows and import only that file. Don't import this whole file again. | डाउनलोड की गई लाइनें ठीक करें और सिर्फ़ वही फ़ाइल इम्पोर्ट करें। यह पूरी फ़ाइल दोबारा इम्पोर्ट न करें। |
| `alreadyTitle` | Already imported | पहले से इम्पोर्ट है |
| `diesDone` | {created} new {created:die\|dies}, {updated} updated. | {created} नई die, {updated} अपडेट हुईं। |
| `retry` | Try the rest again | बाकी फिर से भेजें |
| `downloadUnsaved` | Download rows not saved | जो लाइनें सेव नहीं हुईं, डाउनलोड करें |
| `field.dieSeries` | Die series | Die series |
| `field.dieSectionCode` | Section code | Section code |
| `field.quantity` | Pieces | पीस |
| `field.weight` | Weight | वज़न |
| `field.length` | Length | लंबाई |
| `field.poNumber` | PO number | PO नंबर |
| `field.series` | Series | Series |
| `field.sectionCode` | Section code | Section code |
| `field.name` | Name | नाम |
| `field.weightMin` | Min weight | कम से कम वज़न |
| `field.weightMax` | Max weight | ज़्यादा से ज़्यादा वज़न |
| `field.width` | Width | चौड़ाई |
| `field.height` | Height | ऊंचाई |
| `field.thickness` | Thickness | मोटाई |
| `field.oblique` | Oblique | Oblique |
| `field.leg` | Leg | Leg |
| `field.status` | Status | स्टेटस |
| `field.notes` | Notes | नोट |
| `field.phone` | Phone | फ़ोन |
| `field.email` | Email | ईमेल |
| `field.taxId` | GSTIN | GSTIN |
| `reason.blank` | {column} is empty. | {column} खाली है। |
| `reason.notNumber` | {column} is not a plain number. Use a point for decimals, like 45.5. | {column} सादा नंबर नहीं है। दशमलव के लिए पॉइंट लिखें, जैसे 45.5। |
| `reason.notWhole` | {column} must be a whole number. | {column} पूरा नंबर होना चाहिए। |
| `reason.notPositive` | {column} must be more than 0. | {column} 0 से ज़्यादा होना चाहिए। |
| `reason.tooLong` | {column} is longer than {max} characters. | {column} {max} अक्षरों से लंबा है। |
| `reason.badEmail` | {column} is not an email address. | {column} ईमेल पता नहीं है। |
| `reason.badStatus` | {column} must be active or archived. | {column} active या archived होना चाहिए। |
| `reason.rangeOrder` | Max weight is less than min weight. | ज़्यादा से ज़्यादा वज़न, कम से कम वज़न से कम है। |
| `reason.duplicate` | Same die as row {other}. | लाइन {other} वाली die ही है। |
| `reason.deletedDie` | A deleted die already uses this section code. Use a different code for this die. | यह section code एक डिलीट की गई die का है। इस die के लिए दूसरा कोड लिखें। |
| `reason.dieDeleted` | This die was deleted in orrn, so bundles can't be added to it. | यह die orrn में डिलीट हो चुकी है, इसलिए इसमें bundle नहीं जुड़ सकते। |
| `reason.lengthRange` | {column} reads as {length}, too long or too short for a bundle. Check the unit in the column name. | {column} {length} पढ़ा गया, जो bundle के लिए बहुत लंबा या बहुत छोटा है। कॉलम के नाम में यूनिट जांचें। |
| `reason.weightRange` | {column} reads as {weight}, too heavy to be right. Check the unit in the column name. | {column} {weight} पढ़ा गया, जो सही होने के लिए बहुत ज़्यादा है। कॉलम के नाम में यूनिट जांचें। |
| `reason.alreadyImported` | This row (same row number, same values) was already imported from an earlier copy of this file, so it is not added again. | यह लाइन (वही लाइन नंबर, वही वैल्यू) इस फ़ाइल की पहले की कॉपी से इम्पोर्ट हो चुकी है, इसलिए दोबारा नहीं जोड़ी गई। |

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

### admin (240)

| Key | English | हिंदी |
|---|---|---|
| `title` | Godseye | Godseye |
| `overview.title` | Overview | सारांश |
| `overview.subtitle` | Companies, access requests and staff on orrn. | orrn पर कंपनियां, एक्सेस रिक्वेस्ट और स्टाफ़। |
| `overview.kpis` | At a glance | एक नज़र में |
| `overview.active` | Active companies | चालू कंपनियां |
| `overview.activeMeta` | {count} in total | कुल {count} |
| `overview.suspended` | Suspended | रोकी गई |
| `overview.suspendedMeta` | Access paused | एक्सेस रुका हुआ |
| `overview.pending` | Access requests | एक्सेस रिक्वेस्ट |
| `overview.pendingMeta` | Waiting for review | जांच बाकी है |
| `overview.pendingNone` | All reviewed | सब जांच ली गईं |
| `overview.staff` | Staff | स्टाफ़ |
| `overview.staffMeta` | Godseye logins | Godseye लॉगिन |
| `overview.waiting` | Waiting for review | जांच बाकी |
| `overview.waitingEmpty` | No requests waiting. | कोई रिक्वेस्ट बाकी नहीं है। |
| `overview.recent` | Recent companies | हाल की कंपनियां |
| `overview.recentEmpty` | Approved requests become companies here. | मंज़ूर रिक्वेस्ट यहां कंपनी बनकर दिखती हैं। |
| `overview.viewAll` | View all | सब देखें |
| `overview.viewAllRequests` | View all access requests | सब देखें: एक्सेस रिक्वेस्ट |
| `overview.viewAllCompanies` | View all companies | सब देखें: कंपनियां |
| `overview.loadError` | The overview didn't load. Check the connection and try again. | सारांश लोड नहीं हुआ। कनेक्शन देखें और फिर कोशिश करें। |
| `companies.title` | Companies | कंपनियां |
| `companies.subtitle` | {count} {count:company\|companies} on orrn | orrn पर {count} {count:कंपनी\|कंपनियां} |
| `companies.subtitleFiltered` | {count} {count:company matches\|companies match} | {count} {count:कंपनी मिली\|कंपनियां मिलीं} |
| `companies.search` | Search companies | कंपनी खोजें |
| `companies.searchHint` | Name or short name | नाम या छोटा नाम |
| `companies.status` | Status | स्थिति |
| `companies.printingOnly` | Only with label printing | सिर्फ़ लेबल प्रिंटिंग वाली |
| `companies.filterPending` | Waiting | बाकी |
| `companies.columns.company` | Company | कंपनी |
| `companies.columns.status` | Status | स्थिति |
| `companies.columns.printing` | Label printing | लेबल प्रिंटिंग |
| `companies.columns.members` | Members | सदस्य |
| `companies.columns.joined` | Joined | जुड़ी |
| `companies.empty` | No companies yet. Approved access requests show up here. | अभी कोई कंपनी नहीं है। मंज़ूर एक्सेस रिक्वेस्ट यहां दिखती हैं। |
| `companies.emptyFiltered` | No companies match. Try another search or filter. | कोई कंपनी मेल नहीं खाती। दूसरी खोज या फ़िल्टर आज़माएं। |
| `companies.clearFilters` | Clear filters | फ़िल्टर हटाएं |
| `companies.loadError` | Companies didn't load. Check the connection and try again. | कंपनियां लोड नहीं हुईं। कनेक्शन देखें और फिर कोशिश करें। |
| `companies.listLabel` | Companies | कंपनियां |
| `company.back` | Companies | कंपनियां |
| `company.facts` | Company facts | कंपनी की जानकारी |
| `company.status` | Status | स्थिति |
| `company.plan` | Plan | प्लान |
| `company.members` | Members | सदस्य |
| `company.joined` | Joined | जुड़ी |
| `company.noPlan` | No plan | कोई प्लान नहीं |
| `company.notFound` | This company doesn't exist, or it was removed. | यह कंपनी मौजूद नहीं है, या हटा दी गई है। |
| `company.loadError` | This company didn't load. Check the connection and try again. | यह कंपनी लोड नहीं हुई। कनेक्शन देखें और फिर कोशिश करें। |
| `company.suspend` | Suspend | रोकें |
| `company.suspendTitle` | Suspend {company}? | {company} को रोकें? |
| `company.suspendBody` | Everyone at {company} loses access until you reactivate it. Their data stays. | {company} के सभी लोगों का एक्सेस तब तक बंद रहेगा जब तक आप इसे फिर से चालू नहीं करते। उनका डेटा बना रहेगा। |
| `company.suspended` | Company suspended | कंपनी रोक दी गई |
| `company.reactivate` | Reactivate | फिर से चालू करें |
| `company.reactivateTitle` | Reactivate {company}? | {company} को फिर से चालू करें? |
| `company.reactivateBody` | Everyone at {company} can sign in again. | {company} के सभी लोग फिर से साइन इन कर सकेंगे। |
| `company.reactivated` | Company reactivated | कंपनी फिर से चालू हो गई |
| `company.reviewRequest` | Review the request | रिक्वेस्ट देखें |
| `company.sections` | Company sections | कंपनी के हिस्से |
| `company.tabs.plan` | Plan and modules | प्लान और मॉड्यूल |
| `company.tabs.printing` | Printing | प्रिंटिंग |
| `company.tabs.access` | Access | एक्सेस |
| `plan.plan` | Plan | प्लान |
| `plan.plans.starter` | Starter | स्टार्टर |
| `plan.plans.growth` | Growth | ग्रोथ |
| `plan.plans.enterprise` | Enterprise | एंटरप्राइज़ |
| `plan.modules` | Modules | मॉड्यूल |
| `plan.modulesHint` | Untick a module to hide it from the company's menus. | किसी मॉड्यूल का टिक हटाएं तो वह कंपनी के मेन्यू से छिप जाएगा। |
| `plan.modulesNone` | Keep at least one module on. | कम से कम एक मॉड्यूल चालू रखें। |
| `plan.moduleNames.customers` | Customers | कस्टमर |
| `plan.moduleNames.dies` | Dies | डाई |
| `plan.moduleNames.bundles` | Packing and stock | पैकिंग और स्टॉक |
| `plan.moduleNames.dispatches` | Dispatch and packing lists | डिस्पैच और पैकिंग लिस्ट |
| `plan.moduleHints.customers` | Customer list and addresses | कस्टमर लिस्ट और पते |
| `plan.moduleHints.dies` | Die list and weight ranges | डाई लिस्ट और वज़न रेंज |
| `plan.moduleHints.bundles` | Pack, scan, stock and labels | पैक, स्कैन, स्टॉक और लेबल |
| `plan.moduleHints.dispatches` | Dispatches and printed packing lists | डिस्पैच और छपी पैकिंग लिस्ट |
| `plan.save` | Save plan | प्लान सेव करें |
| `plan.saved` | Plan saved | प्लान सेव हो गया |
| `plan.unsaved` | Unsaved changes | बदलाव सेव नहीं हुए |
| `plan.noPlanYet` | No plan saved yet. | अभी कोई प्लान सेव नहीं है। |
| `printing.noneTitle` | Label printing isn't set up | लेबल प्रिंटिंग सेट नहीं है |
| `printing.noneBody` | Set up a print station so {company} can print bundle labels on their own printers. | प्रिंट स्टेशन सेट करें ताकि {company} अपने प्रिंटर पर बंडल लेबल छाप सके। |
| `printing.setUp` | Set up label printing | लेबल प्रिंटिंग सेट करें |
| `printing.inactive` | Only active companies can print labels. Reactivate {company} first. | सिर्फ़ चालू कंपनियां लेबल छाप सकती हैं। पहले {company} को फिर से चालू करें। |
| `printing.waiting` | Only active companies can print labels. Approve the access request for {company} first. | सिर्फ़ चालू कंपनियां लेबल छाप सकती हैं। पहले {company} की एक्सेस रिक्वेस्ट मंज़ूर करें। |
| `printing.addAnother` | Add a print station | एक और प्रिंट स्टेशन जोड़ें |
| `printing.station` | Print station | प्रिंट स्टेशन |
| `printing.address` | Address | पता |
| `printing.version` | Version | वर्ज़न |
| `printing.versionUnknown` | Not reported yet | अभी नहीं बताया |
| `printing.lastSeen` | Last seen | आखिरी बार दिखा |
| `printing.never` | Never | कभी नहीं |
| `printing.setUpOn` | Set up | सेट किया |
| `printing.setUpDay` | Set up {date} | {date} को सेट किया |
| `printing.nameLabel` | Station name | स्टेशन का नाम |
| `printing.nameHint` | 3 to 63 lowercase letters, numbers or hyphens. | 3 से 63 छोटे अंग्रेज़ी अक्षर, अंक या हाइफ़न। |
| `printing.namePreview` | Address: {address} | पता: {address} |
| `printing.nameRequired` | Enter a station name. | स्टेशन का नाम लिखें। |
| `printing.nameLength` | Use 3 to 63 characters. | 3 से 63 अक्षर रखें। |
| `printing.nameFormat` | Use lowercase letters, numbers and hyphens. Start and end with a letter or number. | छोटे अंग्रेज़ी अक्षर, अंक और हाइफ़न लिखें। शुरू और अंत अक्षर या अंक से हो। |
| `printing.nameTaken` | That station name is taken. Try another. | यह स्टेशन नाम पहले से लिया हुआ है। कोई दूसरा आज़माएं। |
| `printing.create` | Set up print station | प्रिंट स्टेशन सेट करें |
| `printing.created` | Print station set up | प्रिंट स्टेशन सेट हो गया |
| `printing.secretsTitle` | Copy these now | इन्हें अभी कॉपी करें |
| `printing.secretsBody` | They are shown only once. The print station needs them to connect. | ये सिर्फ़ एक बार दिखेंगे। प्रिंट स्टेशन को जुड़ने के लिए इनकी ज़रूरत है। |
| `printing.instanceId` | Instance ID | इंस्टेंस ID |
| `printing.sharedSecret` | Shared secret | शेयर्ड सीक्रेट |
| `printing.tunnelToken` | Tunnel token | टनल टोकन |
| `printing.copyValue` | Copy {label} | {label} कॉपी करें |
| `printing.copied` | {label} copied | {label} कॉपी हो गया |
| `printing.copyFailed` | Couldn't copy. Select the text and copy it. | कॉपी नहीं हुआ। टेक्स्ट चुनकर कॉपी करें। |
| `printing.rotateSecret` | Rotate secret | सीक्रेट बदलें |
| `printing.rotateTitle` | Rotate the secret for {address}? | {address} का सीक्रेट बदलें? |
| `printing.rotateBody` | The current secret stops working right away. The print station needs the new one to keep printing. | अभी वाला सीक्रेट तुरंत काम करना बंद कर देगा। प्रिंटिंग चालू रखने के लिए प्रिंट स्टेशन को नया सीक्रेट चाहिए। |
| `printing.rotated` | Secret rotated | सीक्रेट बदल गया |
| `printing.newSecret` | New shared secret | नया शेयर्ड सीक्रेट |
| `printing.installScript` | Install script | इंस्टॉल स्क्रिप्ट |
| `printing.installTitle` | Download the install script | इंस्टॉल स्क्रिप्ट डाउनलोड करें |
| `printing.installBody` | A shell script for a Linux or macOS computer with Docker. It sets up the print station for {address}. | Docker वाले Linux या macOS कंप्यूटर के लिए शेल स्क्रिप्ट। यह {address} के लिए प्रिंट स्टेशन सेट करती है। |
| `printing.installDownload` | Download script | स्क्रिप्ट डाउनलोड करें |
| `printing.installed` | Install script downloaded | इंस्टॉल स्क्रिप्ट डाउनलोड हो गई |
| `printing.downloads` | Downloads | डाउनलोड |
| `printing.downloadsTitle` | Download the print station app | प्रिंट स्टेशन ऐप डाउनलोड करें |
| `printing.downloadsBody` | The app comes set up for {address}. Run it on a computer on the plant network. | ऐप {address} के लिए पहले से सेट है। इसे प्लांट नेटवर्क के किसी कंप्यूटर पर चलाएं। |
| `printing.computer` | Computer | कंप्यूटर |
| `printing.platforms.darwinArm64` | Mac with Apple chip | Apple चिप वाला Mac |
| `printing.platforms.darwinAmd64` | Mac with Intel chip | Intel चिप वाला Mac |
| `printing.platforms.linuxAmd64` | Linux | Linux |
| `printing.platforms.windowsAmd64` | Windows | Windows |
| `printing.download` | Download app | ऐप डाउनलोड करें |
| `printing.downloadStarted` | Download started | डाउनलोड शुरू हो गया |
| `printing.turnOff` | Turn off label printing | लेबल प्रिंटिंग बंद करें |
| `printing.turnOffShort` | Turn off | बंद करें |
| `printing.turnOffTitle` | Turn off {address}? | {address} बंद करें? |
| `printing.turnOffBody` | Labels stop printing at {company} until you set up a new print station. | नया प्रिंट स्टेशन सेट होने तक {company} में लेबल नहीं छपेंगे। |
| `printing.turnedOff` | Label printing turned off | लेबल प्रिंटिंग बंद हो गई |
| `printing.history` | Turned off earlier | पहले बंद किए गए |
| `printing.loadError` | Print stations didn't load. Check the connection and try again. | प्रिंट स्टेशन लोड नहीं हुए। कनेक्शन देखें और फिर कोशिश करें। |
| `printing.stationsLabel` | Print stations | प्रिंट स्टेशन |
| `access.impersonate` | Impersonate | कंपनी के रूप में खोलें |
| `access.title` | Open {company} as support | {company} को सपोर्ट के रूप में खोलें |
| `access.body` | You see orrn as their owner would. Every change is recorded with your name. | आप orrn को उनके मालिक की तरह देखेंगे। हर बदलाव आपके नाम से दर्ज होगा। |
| `access.reasonLabel` | Reason (optional) | वजह (ज़रूरी नहीं) |
| `access.reasonHint` | Shown in the session list below. | नीचे सेशन लिस्ट में दिखेगी। |
| `access.durationLabel` | Session length (minutes) | सेशन कितनी देर (मिनट) |
| `access.started` | Support session started | सपोर्ट सेशन शुरू हुआ |
| `access.inactive` | Only active companies can be opened. Reactivate {company} first. | सिर्फ़ चालू कंपनियां खोली जा सकती हैं। पहले {company} को फिर से चालू करें। |
| `access.waiting` | Only active companies can be opened. Approve the access request for {company} first. | सिर्फ़ चालू कंपनियां खोली जा सकती हैं। पहले {company} की एक्सेस रिक्वेस्ट मंज़ूर करें। |
| `access.inside` | You are inside {company} as support. Stop that session first. | आप सपोर्ट के रूप में {company} के अंदर हैं। पहले वह सेशन बंद करें। |
| `access.restricted` | Your role can't open companies as support. | आपका रोल कंपनियों को सपोर्ट के रूप में नहीं खोल सकता। |
| `access.banner` | Viewing {company} as orrn support | {company} को orrn सपोर्ट के रूप में देख रहे हैं |
| `access.stop` | Stop impersonating | सपोर्ट व्यू बंद करें |
| `access.stopFailed` | Couldn't stop the support session. Check the connection and try again. | सपोर्ट सेशन बंद नहीं हुआ। कनेक्शन देखें और फिर कोशिश करें। |
| `access.expires` | Ends at {time} | {time} पर खत्म होगा |
| `access.endsSoon` | Ends at {time}, in under 5 minutes | {time} पर खत्म होगा, 5 मिनट से कम बचे |
| `access.sessions` | Support sessions | सपोर्ट सेशन |
| `access.sessionsEmpty` | No support sessions yet. | अभी कोई सपोर्ट सेशन नहीं। |
| `access.staff` | Staff | स्टाफ़ |
| `access.reason` | Reason | वजह |
| `access.startedAt` | Started | शुरू हुआ |
| `access.ends` | Ends | खत्म |
| `access.state.active` | Active | चालू |
| `access.state.ended` | Ended | खत्म |
| `access.state.stopped` | Stopped | बंद किया |
| `access.noReason` | No reason given | कोई वजह नहीं दी |
| `access.resume` | Resume | फिर से खोलें |
| `access.stopSession` | Stop | बंद करें |
| `access.actions` | Actions | कार्रवाई |
| `access.stopped` | Support session stopped | सपोर्ट सेशन बंद हुआ |
| `access.unknownStaff` | Former staff | पुराना स्टाफ़ |
| `access.staffYou` | {name} (you) | {name} (आप) |
| `requests.title` | Access requests | एक्सेस रिक्वेस्ट |
| `requests.waiting` | {count} waiting | {count} बाकी |
| `requests.none` | Nothing waiting | कुछ बाकी नहीं |
| `requests.empty` | No requests waiting. | कोई रिक्वेस्ट बाकी नहीं है। |
| `requests.emptyBody` | New requests from the website show up here. | वेबसाइट से आई नई रिक्वेस्ट यहां दिखेंगी। |
| `requests.from` | From {name} | {name} की ओर से |
| `requests.received` | Received {date} | आई: {date} |
| `requests.noNotes` | No notes | कोई नोट नहीं |
| `requests.approve` | Approve | मंज़ूर करें |
| `requests.approveTitle` | Approve {company}? | {company} को मंज़ूर करें? |
| `requests.approveBody` | This creates the company and emails a sign-in link to {email}. If the email can't be sent, you get the details to send yourself. | इससे कंपनी बनेगी और {email} पर साइन इन लिंक ईमेल होगा। ईमेल न जा पाए तो खुद भेजने के लिए डिटेल मिल जाएंगी। |
| `requests.approved` | Request approved | रिक्वेस्ट मंज़ूर हो गई |
| `requests.reject` | Reject | नामंज़ूर करें |
| `requests.rejectTitle` | Reject {company}? | {company} को नामंज़ूर करें? |
| `requests.rejectBody` | The request is closed. {email} is not emailed. | रिक्वेस्ट बंद हो जाएगी। {email} को ईमेल नहीं जाएगा। |
| `requests.rejected` | Request rejected | रिक्वेस्ट नामंज़ूर हो गई |
| `requests.alreadyHandled` | Someone already handled this request. The list is up to date now. | यह रिक्वेस्ट पहले ही निपटा दी गई है। लिस्ट अब ताज़ा है। |
| `requests.loadError` | Requests didn't load. Check the connection and try again. | रिक्वेस्ट लोड नहीं हुईं। कनेक्शन देखें और फिर कोशिश करें। |
| `requests.listLabel` | Waiting requests | बाकी रिक्वेस्ट |
| `requests.approvedSent` | Approved. Sign-in email sent to {email}. | मंज़ूर हो गई। साइन इन ईमेल {email} पर गया। |
| `requests.approvedNoLink` | Approved, but no sign-in link was made. Use Get sign-in details below to try again. | मंज़ूर हो गई, पर साइन इन लिंक नहीं बना। नीचे "साइन इन डिटेल लें" से फिर कोशिश करें। |
| `requests.showEmail` | Show email | ईमेल देखें |
| `requests.awaitingTitle` | Approved, password not set yet | मंज़ूर, पासवर्ड अभी नहीं बना |
| `requests.awaitingBody` | If the email did not arrive or the link stopped working, get a fresh sign-in link and send it yourself. | ईमेल न पहुंचा हो या लिंक काम न कर रहा हो, तो नया साइन इन लिंक लेकर खुद भेजें। |
| `requests.awaitingLabel` | Approved owners without a password | बिना पासवर्ड वाले मंज़ूर मालिक |
| `requests.getDetails` | Get sign-in details | साइन इन डिटेल लें |
| `requests.hasPassword` | This owner already signs in with a password; ask them to use Forgot password. | यह मालिक पहले से पासवर्ड से साइन इन करते हैं; उनसे "पासवर्ड भूल गए" इस्तेमाल करने को कहें। |
| `requests.approvedHasPassword` | Approved. This owner already signs in with a password; ask them to use Forgot password. | मंज़ूर हो गई। यह मालिक पहले से पासवर्ड से साइन इन करते हैं; उनसे "पासवर्ड भूल गए" इस्तेमाल करने को कहें। |
| `requests.approvedAskAdmin` | Approved. Your role cannot send sign-in links: ask an admin to get the sign-in details below. | मंज़ूर हो गई। आपका रोल साइन इन लिंक नहीं भेज सकता: किसी एडमिन से नीचे की साइन इन डिटेल लेने को कहें। |
| `requests.details.sentTitle` | Sign-in email sent | साइन इन ईमेल चला गया |
| `requests.details.notSentTitle` | Email could not be sent | ईमेल नहीं जा सका |
| `requests.details.body` | Send this to {name} on WhatsApp or from your own email. The link works once and expires {date}. | यह {name} को WhatsApp पर या अपने ईमेल से भेजें। लिंक एक बार चलता है और {date} को खत्म हो जाएगा। |
| `requests.details.sent` | The email went to {email}. | ईमेल {email} पर गया। |
| `requests.details.notSent` | The email did not go out. Send the details below yourself. | ईमेल नहीं गया। नीचे की डिटेल खुद भेजें। |
| `requests.details.reason` | Reason: {reason} | वजह: {reason} |
| `requests.details.to` | To | किसको |
| `requests.details.subject` | Subject | विषय |
| `requests.details.link` | Sign-in link | साइन इन लिंक |
| `requests.details.message` | Message | संदेश |
| `requests.details.copyMessage` | Copy message | संदेश कॉपी करें |
| `staff.title` | Staff | स्टाफ़ |
| `staff.subtitle` | People who can sign in to Godseye. There is no public sign-up. | जो लोग Godseye में साइन इन कर सकते हैं। यहां कोई खुला साइन अप नहीं है। |
| `staff.add` | Add staff | स्टाफ़ जोड़ें |
| `staff.addTitle` | Add a staff account | स्टाफ़ अकाउंट जोड़ें |
| `staff.name` | Name | नाम |
| `staff.email` | Email | ईमेल |
| `staff.password` | Temporary password | अस्थायी पासवर्ड |
| `staff.passwordHint` | At least 12 characters. Share it in person or on a call. | कम से कम 12 अक्षर। इसे मिलकर या कॉल पर बताएं। |
| `staff.passwordShort` | Use at least 12 characters. | कम से कम 12 अक्षर रखें। |
| `staff.emailTaken` | An account with this email already exists. | इस ईमेल से पहले से एक अकाउंट है। |
| `staff.role` | Role | रोल |
| `staff.roleHints.super_admin` | Everything, including removing staff. | सब कुछ, स्टाफ़ हटाना भी। |
| `staff.roleHints.admin` | Companies, requests, printing, support sessions and adding staff. | कंपनियां, रिक्वेस्ट, प्रिंटिंग, सपोर्ट सेशन और स्टाफ़ जोड़ना। |
| `staff.roleHints.support` | Companies and requests. No support sessions or printing. | कंपनियां और रिक्वेस्ट। सपोर्ट सेशन या प्रिंटिंग नहीं। |
| `staff.create` | Add account | अकाउंट जोड़ें |
| `staff.created` | Staff account added | स्टाफ़ अकाउंट जुड़ गया |
| `staff.you` | You | आप |
| `staff.added` | Added | जोड़ा गया |
| `staff.roleFor` | Role for {name} | {name} का रोल |
| `staff.roleChanged` | Role changed | रोल बदल गया |
| `staff.remove` | Remove | हटाएं |
| `staff.removeLabel` | Remove {name} | {name} को हटाएं |
| `staff.removeTitle` | Remove {name}? | {name} को हटाएं? |
| `staff.removeBody` | {email} can no longer sign in to Godseye. | {email} अब Godseye में साइन इन नहीं कर पाएगा। |
| `staff.removed` | Staff access removed | स्टाफ़ एक्सेस हटा दिया गया |
| `staff.actions` | Actions | कार्रवाई |
| `staff.empty` | No staff yet. | अभी कोई स्टाफ़ नहीं। |
| `staff.loadError` | Staff didn't load. Check the connection and try again. | स्टाफ़ लोड नहीं हुआ। कनेक्शन देखें और फिर कोशिश करें। |
| `staff.listLabel` | Staff accounts | स्टाफ़ अकाउंट |

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

### approvals (59)

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
